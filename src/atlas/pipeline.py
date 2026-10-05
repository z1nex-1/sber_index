import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.metrics import adjusted_rand_score

from .data import load_market_access
from .experiments import ablation, bootstrap_stability, graph_sensitivity, prepare, rank_runs, run_grid
from .external import load_external
from .features import rhythm
from .graphs import graph_properties
from .icvi import feature_indices, graph_indices
from .interpret import describe_types, external_validation, formal_context, join_count, within_region
from .methods import METHODS
from .temporal import (block_null, centroids, emissions, fit_lambda, monthly_graphs, multislice_leiden,
                       neighbour_share, persistent_changes, slice_agreement, switch_stats, track_events,
                       viterbi_types)
from .typology import order_by_level


def _log(msg, t0):
    print(f"[{time.time() - t0:6.0f} с] {msg}", flush=True)


def _json(obj, path):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=1, default=float), encoding="utf-8")


def run(cfg, out="outputs"):
    t0 = time.time()
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    ctx = prepare(cfg)
    ids = ctx.snaps.ids
    level = ctx.snaps.raw["level"].groupby(level=0).mean().loc[ids].to_numpy()
    _log(f"данные: {len(ids)} МО, {len(ctx.snaps.months)} месячных срезов, {ctx.X.shape[1]} признаков", t0)

    graphs = pd.DataFrame({r: graph_properties(A, ctx.info.region_code.to_numpy(), ctx.dist) for r, A in ctx.graphs.items()}).T
    graphs.to_csv(out / "graphs.csv")

    runs, labels = run_grid(ctx)
    ranked, concord = rank_runs(runs, cfg["clustering"]["min_share"])
    runs.to_csv(out / "grid.csv")
    ranked.to_csv(out / "ranking.csv")
    concord.to_csv(out / "concordance.csv")
    np.savez_compressed(out / "partitions.npz", **{k.replace("|", "__"): v for k, v in labels.items()})
    _log(f"сетка: {len(runs)} разбиений, допустимых {len(ranked)}", t0)

    fin = cfg["final"]
    final_key = f"{fin['method']}|{fin['rule']}|{fin['k']}"
    top = ranked[ranked.kemeny_rank <= 3].index.tolist()
    keys = list(dict.fromkeys([final_key] + top))
    cl = cfg["clustering"]
    stab = Parallel(n_jobs=-1)(delayed(bootstrap_stability)(ctx, k, labels[k], cl["bootstrap"], cl["bootstrap_frac"], cfg["seed"])
                               for k in keys)
    pd.DataFrame(stab).set_index("key").to_csv(out / "stability.csv")
    _log(f"устойчивость: {len(keys)} кандидатов", t0)

    lab = order_by_level(labels[final_key], level)
    pd.DataFrame({"territory_id": ids, "type": lab}).to_csv(out / "types.csv", index=False)

    ic = cfg["interpretation"]
    graph_sensitivity(ctx, lab, ic["sensitivity_rules"], ic["sensitivity_knn"]).to_csv(out / "graph_sensitivity.csv", index=False)
    ablation(cfg, fin, lab).to_csv(out / "ablation.csv", index=False)
    _log("чувствительность сети и абляция признаков", t0)

    tc = cfg["temporal"]
    k = fin["k"]
    C = centroids(ctx.X, lab)
    tau = float(np.median(((ctx.X[:, None] - C[None]) ** 2).sum(-1).min(1)))
    G = monthly_graphs(ctx, tc["rule"])
    F = neighbour_share(G, lab, k)
    F0 = neighbour_share([ctx.graphs[fin["rule"]]], lab, k)[0]
    lam, acc = fit_lambda(ctx.X, F0, C, tau, lab, np.linspace(*tc["lambda_grid"]))
    E = emissions(ctx.snaps.X, C, tau, F, lam)
    path = viterbi_types(E, tc["p_switch"])
    raw_path = emissions(ctx.snaps.X, C, tau, F, lam).argmax(-1)
    changes = persistent_changes(path, tc["min_run"])
    changes.insert(0, "territory_id", ids[changes.i.to_numpy()] if len(changes) else [])
    changes["month"] = [ctx.snaps.months[t] for t in changes.t]
    changes.drop(columns="i").to_csv(out / "changes.csv", index=False)
    null = block_null(E, tc["p_switch"], tc["null_block"], tc["min_run"], tc["null_samples"], cfg["seed"])
    np.save(out / "monthly_types.npy", path)
    sens = []
    for ps in [0.01, 0.03, 0.1]:
        p = viterbi_types(E, ps)
        nl = block_null(E, ps, tc["null_block"], tc["min_run"], 20, cfg["seed"])
        sens.append({"p_switch": ps, "persistent": len(persistent_changes(p, tc["min_run"])),
                     "null_mean": float(nl.mean()), "null_sd": float(nl.std()), **switch_stats(p, lab)})
    ms = []
    for om in tc["multislice_omega"]:
        M = multislice_leiden(G, om, tc["multislice_resolution"], cfg["seed"])
        ev = track_events(M, tc["match_threshold"])
        counts = ev.event.value_counts().to_dict() if len(ev) else {}
        ms.append({"omega": om, "communities_min": int(min(len(np.unique(m)) for m in M)),
                   "communities_max": int(max(len(np.unique(m)) for m in M)),
                   "nmi_to_types": float(np.mean(slice_agreement(M, lab))), **counts})
    dyn = {
        "lambda": lam, "lambda_accuracy": acc, "tau": tau,
        "raw": switch_stats(raw_path, lab), "hmm": switch_stats(path, lab),
        "persistent": len(changes), "null_mean": float(null.mean()), "null_sd": float(null.std()),
        "null_p": float((null >= len(changes)).mean()),
        "null_samples": null.astype(int).tolist(),
        "p_switch_sensitivity": sens, "multislice": ms,
    }
    _json(dyn, out / "dynamics.json")
    _log(f"динамика: устойчиво сменили тип {len(changes)} МО, в нуле {null.mean():.1f}", t0)

    raw = ctx.snaps.raw
    shares = raw[[c for c in raw if c.startswith("share:")]].groupby(level=0).mean().loc[ids]
    I = formal_context(shares, pd.Series(level, index=ids), rhythm(ctx.wide).loc[ids])
    fca = describe_types(I, lab, ic["fca_max_attrs"], ic["fca_min_precision"], ic["fca_min_extent"])
    ext = load_external(cfg, ids)
    ma = load_market_access(cfg).reindex(ids)
    valid = external_validation(lab, ext, ctx.info, ma)
    interp = {
        "fca": fca.to_dict("records"),
        "context_attributes": len(I.columns),
        "validation": valid.to_dict("records"),
        "join_count_road": join_count(ctx.graphs["road"], lab),
        "join_count_hybrid": join_count(ctx.graphs["hybrid"], lab),
        "within_region": within_region(lab, ctx.info.region_code),
        "final_indices": {**feature_indices(ctx.X, lab), **{f"{n}@{g}": v for g, A in ctx.graphs.items()
                                                             for n, v in graph_indices(A, lab).items()}},
    }
    _json(interp, out / "interpretation.json")
    ext.assign(market_access=ma.to_numpy()).to_csv(out / "external.csv")
    _log("интерпретация: FCA и внешняя проверка", t0)
    return lab
