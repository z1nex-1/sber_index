import time
from dataclasses import dataclass

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.metrics import adjusted_rand_score

from .data import load_consumption, load_dictionary, load_market_access, load_road_distances
from .features import build_snapshots
from .graphs import SOURCES, build_graph, category_residuals, graph_properties, road_similarity
from .icvi import FEATURE_INDICES, GRAPH_INDICES, HIGHER_IS_BETTER, feature_indices, graph_indices
from .methods import FAMILY, METHODS, USES_GRAPH
from .rank import aggregate, kendall_w, oriented


@dataclass
class Context:
    cfg: dict
    wide: pd.DataFrame
    snaps: object
    X: np.ndarray
    info: pd.DataFrame
    dist: np.ndarray
    road_S: np.ndarray
    R: tuple
    graphs: dict


def prepare(cfg, snaps=None):
    wide = load_consumption(cfg)
    snaps = snaps or build_snapshots(wide, load_market_access(cfg), cfg)
    ids = snaps.ids
    dist = load_road_distances(cfg, ids)
    road_S = road_similarity(dist, cfg["graph"]["road_scale_km"])
    R = category_residuals(wide, ids, cfg["features"]["categories"])
    ctx = Context(cfg, wide, snaps, snaps.X.mean(0), load_dictionary(cfg, ids), dist, road_S, R, {})
    ctx.graphs = {r: build_graph(r, snaps, None, cfg, R, road_S).tocsr() for r in cfg["graph"]["rules"]}
    return ctx


def _run(method, rule, k, X, A, seed):
    t0 = time.time()
    labels = METHODS[method](X, A, k, seed)
    return method, rule, k, labels, time.time() - t0


def run_grid(ctx, n_jobs=-1):
    cl = ctx.cfg["clustering"]
    ks = range(cl["k_range"][0], cl["k_range"][1] + 1)
    jobs = []
    for m in cl["methods"]:
        rules = cl["graph_rules"] if m in USES_GRAPH else [None]
        for rule in rules:
            A = ctx.graphs[rule or cl["graph_rules"][0]]
            jobs += [(m, rule, k, ctx.X, A, ctx.cfg["seed"]) for k in ks]
    done = Parallel(n_jobs=n_jobs, verbose=0)(delayed(_run)(*j) for j in jobs)

    rows, labels = [], {}
    for method, rule, k, lab, sec in done:
        key = f"{method}|{rule or '-'}|{k}"
        labels[key] = lab
        row = {"key": key, "method": method, "family": FAMILY[method], "rule": rule or "-", "k": k,
               "clusters": len(np.unique(lab)), "min_share": np.bincount(lab).min() / len(lab), "seconds": sec}
        row.update(feature_indices(ctx.X, lab))
        for g, A in ctx.graphs.items():
            for name, v in graph_indices(A, lab).items():
                row[f"{name}@{g}"] = v
        rows.append(row)
    runs = pd.DataFrame(rows).set_index("key")
    return with_fair_graph_indices(runs, list(ctx.graphs)), labels


def with_fair_graph_indices(runs, graphs):
    """Графовые индексы усредняются только по сетям, независимым от данных, на которых обучался метод.

    Метод, оптимизирующий модулярность своей сети, на ней же всегда выигрывает; признаковые
    и атрибутированные методы по той же причине не оцениваются на сетях из тех же признаков.
    """
    runs = runs.copy()
    fair = np.array([[not (run_sources(m, r) & SOURCES[g]) for g in graphs] for m, r in zip(runs.method, runs.rule)])
    for name in GRAPH_INDICES:
        runs[name] = runs[[f"{name}@{g}" for g in graphs]].where(fair).mean(1)
    return runs


def run_sources(method, rule):
    src = set(SOURCES[rule]) if rule != "-" else set()
    if FAMILY[method] != "граф":
        src.add("features")
    return src


def rank_runs(runs, min_share):
    """Рейтинг внутри каждого k: сравнивать разные k по SW и CH нельзя — оба смещены к малым k."""
    ok = runs[(runs.min_share >= min_share) & (runs.clusters >= 2)]
    parts, concord = [], {}
    for k, grp in ok.groupby("k"):
        S = oriented(grp, HIGHER_IS_BETTER)
        parts.append(grp.join(aggregate(S)))
        concord[k] = kendall_w(S)
    return pd.concat(parts).sort_values(["k", "kemeny_rank"]), pd.Series(concord, name="kendall_w")


def bootstrap_stability(ctx, key, labels, B, frac, seed):
    method, rule, k = key.split("|")
    k = int(k)
    A = ctx.graphs[rule] if rule != "-" else ctx.graphs[ctx.cfg["clustering"]["graph_rules"][0]]
    rng = np.random.default_rng(seed)
    n = len(labels)

    def one(b):
        idx = np.sort(rng.choice(n, int(frac * n), replace=False)) if b >= 0 else np.arange(n)
        sub = METHODS[method](ctx.X[idx], A[idx][:, idx], k, seed + b + 1)
        return adjusted_rand_score(labels[idx], sub)

    subsample = [one(b) for b in range(B)]
    seeds = [adjusted_rand_score(labels, METHODS[method](ctx.X, A, k, seed + 100 + s)) for s in range(5)]
    return {"key": key, "ari_boot_mean": float(np.mean(subsample)), "ari_boot_q10": float(np.quantile(subsample, 0.1)),
            "ari_seed_mean": float(np.mean(seeds))}


def graph_sensitivity(ctx, labels, rules, ks):
    rows = []
    regions = ctx.info.region_code.to_numpy()
    cfg = {**ctx.cfg, "graph": dict(ctx.cfg["graph"])}
    for rule in rules:
        for k in ks:
            cfg["graph"]["k"] = k
            A = build_graph(rule, ctx.snaps, None, cfg, ctx.R, ctx.road_S).tocsr()
            rows.append({"rule": rule, "knn": k, **graph_properties(A, regions, ctx.dist), **graph_indices(A, labels)})
    return pd.DataFrame(rows)


ABLATIONS = {
    "структура": {"use_rhythm": False, "use_market_access": False, "weights": {"level": 0.0}},
    "структура + уровень": {"use_rhythm": False, "use_market_access": False},
    "структура + уровень + ритм": {"use_rhythm": True, "use_market_access": False},
    "+ доступность рынков": {"use_rhythm": True, "use_market_access": True},
    "без сглаживания": {"smoothing_window": 1},
}


def ablation(cfg, method, k, reference):
    wide = load_consumption(cfg)
    ma = load_market_access(cfg)
    rows = []
    for name, patch in ABLATIONS.items():
        fc = {**cfg["features"], **{k2: v for k2, v in patch.items() if k2 != "weights"}}
        fc["weights"] = {**cfg["features"]["weights"], **patch.get("weights", {})}
        snaps = build_snapshots(wide, ma, {**cfg, "features": fc})
        X = snaps.X.mean(0)
        lab = METHODS[method](X, None, k, cfg["seed"])
        rows.append({"variant": name, "features": X.shape[1], "ari_to_final": adjusted_rand_score(reference, lab),
                     **feature_indices(X, lab)})
    return pd.DataFrame(rows)
