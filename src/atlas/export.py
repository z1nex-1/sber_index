import json
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from .data import TOTAL, load_dictionary, load_market_access
from .features import OTHER
from .typology import twins

N_TWINS = 6
MO_KINDS = {
    "городской округ": "го",
    "муниципальный район": "мр",
    "муниципальный округ": "мо",
    "внутригородская территория города федерального значения": "вт",
}
N_NEIGHBOURS = 8


FEDERAL_CITIES = {77: "Москва", 78: "Санкт-Петербург", 92: "Севастополь"}


def _load_polygons(cfg):
    import geopandas as gpd

    g = gpd.read_file(Path(cfg["data"]["dictionary"]).with_name("t_dict_municipal_districts_poly.gpkg"))
    g["territory_id"] = g["territory_id"].astype(int)
    g["year_to"] = g["year_to"].astype(int)
    return g.sort_values("year_to").drop_duplicates("territory_id", keep="last")


def _display_name(row):
    city = FEDERAL_CITIES.get(int(row["region_code"]))
    if city and str(row["mo_type"]).startswith("внутригородская"):
        return f"{row['name']} ({city})"
    return row["name"]


def _geometry(cfg, g, ids_with_data):
    import topojson
    from shapely.geometry import MultiPolygon, Polygon
    from shapely.geometry.polygon import orient

    d = load_dictionary(cfg)
    g = g.join(d[["region_code"]], on="territory_id")

    # d3-geo reads rings as spherical polygons and expects clockwise exteriors;
    # slivers are dropped because simplification can collapse and flip them.
    def clockwise(geom):
        parts = [geom] if isinstance(geom, Polygon) else list(getattr(geom, "geoms", []))
        parts = [orient(p, sign=-1.0) for p in parts if isinstance(p, Polygon) and p.area > 2e-5]
        return parts[0] if len(parts) == 1 else MultiPolygon(parts)

    g = g.assign(
        geometry=g.geometry.apply(clockwise),
        d=g.territory_id.isin(ids_with_data).astype(int),
        rc=g.region_code.fillna(0).astype(int),
    )[["territory_id", "d", "rc", "geometry"]].rename(columns={"territory_id": "id"})
    topo = topojson.Topology(g, object_name="mo", prequantize=4e5, toposimplify=0.004, presimplify=False)
    return topo.to_json()


def economic_space(profile, seed):
    from sklearn.manifold import TSNE

    xy = TSNE(2, perplexity=40, init="pca", random_state=seed).fit_transform(profile)
    xy -= xy.min(0)
    return xy / xy.max()


def _records(df, cols, digits=4):
    return [{c: (round(float(v), digits) if isinstance(v, (float, np.floating)) and np.isfinite(v) else
                 None if isinstance(v, (float, np.floating)) else v) for c, v in zip(cols, row)} for row in df[cols].itertuples(index=False)]


def _clean(obj):
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    if isinstance(obj, float) and not np.isfinite(obj):
        return None
    return obj


def _load_results(res):
    res = Path(res)
    grid = pd.read_csv(res / "ranking.csv").set_index("key")
    runs = pd.read_csv(res / "grid.csv").set_index("key")
    return {
        "types": pd.read_csv(res / "types.csv").set_index("territory_id").type,
        "monthly": np.load(res / "monthly_types.npy"),
        "runs": runs.join(grid[["borda_rank", "copeland_rank", "kemeny_rank"]]),
        "concordance": pd.read_csv(res / "concordance.csv", index_col=0).iloc[:, 0],
        "stability": pd.read_csv(res / "stability.csv").set_index("key"),
        "ablation": pd.read_csv(res / "ablation.csv"),
        "sensitivity": pd.read_csv(res / "graph_sensitivity.csv"),
        "dynamics": json.loads((res / "dynamics.json").read_text(encoding="utf-8")),
        "interp": json.loads((res / "interpretation.json").read_text(encoding="utf-8")),
        "changes": pd.read_csv(res / "changes.csv"),
        "boundary": pd.read_csv(res / "boundary.csv").set_index("territory_id").model_type,
    }


def export_site(cfg, out_dir, with_geometry=True, results="outputs"):
    from .experiments import prepare
    from .graphs import graph_properties
    from .icvi import graph_indices

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    types_cfg = yaml.safe_load(open("configs/types.yaml", encoding="utf-8"))
    k = types_cfg["k"]
    R = _load_results(results)

    ctx = prepare(cfg)
    snaps, ids, wide, dist = ctx.snaps, ctx.snaps.ids, ctx.wide, ctx.dist
    static = R["types"].reindex(ids).to_numpy()
    monthly = R["monthly"]
    if static.max() + 1 != k:
        raise SystemExit(f"в configs/types.yaml {k} типов, а в модели {static.max() + 1}: обновите описания типов")
    ma = load_market_access(cfg)
    info = load_dictionary(cfg, ids)
    polys = _load_polygons(cfg)
    inner = polys.set_index("territory_id").geometry.representative_point().reindex(ids)
    missing = info["lat"].isna()
    info.loc[missing, "lat"] = inner[missing].y
    info.loc[missing, "lon"] = inner[missing].x
    tw, tw_sim = twins(ctx.X, N_TWINS)
    fin = cfg["final"]
    A = ctx.graphs[fin["rule"]]
    layout = economic_space(ctx.X, cfg["seed"])

    cats = cfg["features"]["categories"] + [OTHER]
    shares = snaps.raw[[f"share:{c}" for c in cats]]
    last12 = [m for m in snaps.months if m.startswith("2024")]
    mean_shares = shares[shares.index.get_level_values(1).isin(last12)].groupby(level=0).mean().loc[ids]
    total = wide[TOTAL].unstack().loc[ids]
    all_months = list(total.columns)
    changed = set(R["changes"].territory_id)

    records = []
    for i, tid in enumerate(ids):
        row = A.getrow(i)
        nb = row.indices[np.argsort(-row.data)][:N_NEIGHBOURS]
        r = info.loc[tid]
        records.append(
            {
                "id": int(tid),
                "n": _display_name(r),
                "k": MO_KINDS.get(r["mo_type"], ""),
                "r": r["region_name"],
                "rc": int(r["region_code"]),
                "c": r["center"] if isinstance(r["center"], str) else "",
                "t": int(static[i]),
                "tm": "".join(map(str, monthly[:, i])),
                "ch": int(tid in changed),
                "bd": int(R["boundary"][tid]) if tid in R["boundary"].index else None,
                "sh": [round(float(v), 4) for v in mean_shares.iloc[i]],
                "s": [int(v) for v in total.iloc[i]],
                "ma": round(float(ma.get(tid, np.nan)), 1) if tid in ma.index else None,
                "tw": [int(ids[j]) for j in tw[i]],
                "tws": [round(float(v), 3) for v in tw_sim[i]],
                "nb": [int(ids[j]) for j in nb],
                "lat": round(float(r["lat"]), 4),
                "lon": round(float(r["lon"]), 4),
                "xy": [round(float(v), 4) for v in layout[i]],
            }
        )

    national = {
        "s": [int(v) for v in total.median().round()],
        "sh": [round(float(v), 4) for v in mean_shares.median()],
    }
    fca = {row["type"]: row for row in R["interp"]["fca"]}
    types = []
    for t in range(k):
        members = static == t
        f = fca.get(t, {})
        types.append(
            {
                "id": t,
                **types_cfg["types"][t],
                "n": int(members.sum()),
                "sh": [round(float(v), 4) for v in mean_shares[members].median()],
                "s": [int(v) for v in total[members].median().round()],
                "stay": round(float((monthly[:, members] == t).mean()), 3),
                "fca": {"attrs": f.get("generator", []), "intent": f.get("intent", []), "extent": f.get("extent", 0),
                        "precision": round(f.get("precision", 0), 3), "recall": round(f.get("recall", 0), 3)},
            }
        )

    regions = info["region_code"].to_numpy()
    rules = {}
    for rule, G in ctx.graphs.items():
        props = graph_properties(G, regions, dist)
        U = G.tocoo()
        props["cross_type"] = float((static[U.row] != static[U.col]).mean())
        rules[rule] = {key: round(float(v), 3) for key, v in {**props, **graph_indices(G, static)}.items()}

    runs = R["runs"].reset_index()
    cols = ["key", "method", "family", "rule", "k", "min_share", "SW", "CH", "S_Dbw", "AVI", "AVU", "MQ",
            "borda_rank", "copeland_rank", "kemeny_rank"]
    fin_key = f"{fin['method']}|{fin['rule']}|{fin['k']}"
    meta = {
        "months": all_months,
        "snapshot_months": snaps.months,
        "categories": cats,
        "n_mo": len(ids),
        "types": types,
        "national": national,
        "graph": {"k": cfg["graph"]["k"], "default": fin["rule"], "rules": rules},
        "model": {**fin, "key": fin_key, "stability": R["stability"].loc[fin_key].round(3).to_dict()},
        "grid": _records(runs, cols),
        "concordance": {int(kk): round(float(v), 3) for kk, v in R["concordance"].items()},
        "stability": _records(R["stability"].reset_index(), ["key", "ari_boot_mean", "ari_boot_q10", "ari_seed_mean"], 3),
        "ablation": _records(R["ablation"], list(R["ablation"].columns), 3),
        "dynamics": R["dynamics"],
        "validation": R["interp"]["validation"],
        "join_count": R["interp"]["join_count_road"],
        "within_region": R["interp"]["within_region"],
    }
    json.dump(_clean(meta), open(out / "meta.json", "w", encoding="utf-8"), ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    json.dump(records, open(out / "mo.json", "w", encoding="utf-8"), ensure_ascii=False, allow_nan=False, separators=(",", ":"))

    for rule, G in ctx.graphs.items():
        rows, cols_ = G.nonzero()
        upper = rows < cols_
        edges = np.stack([rows[upper], cols_[upper]], 1).astype(int).ravel().tolist()
        json.dump(edges, open(out / f"edges-{rule}.json", "w"), separators=(",", ":"))

    if with_geometry:
        (out / "mo.topo.json").write_text(_geometry(cfg, polys, set(int(i) for i in ids)))
