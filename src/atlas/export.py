import json
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from .data import TOTAL, load_consumption, load_dictionary, load_market_access, load_road_distances
from .features import OTHER, build_snapshots
from .graphs import build_graph, category_residuals, road_similarity
from .typology import fit_typology, twins

N_TWINS = 6
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


def export_site(cfg, out_dir, with_geometry=True):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    types_cfg = yaml.safe_load(open("configs/types.yaml", encoding="utf-8"))
    k = types_cfg["k"]

    wide = load_consumption(cfg)
    ma = load_market_access(cfg)
    snaps = build_snapshots(wide, ma, cfg)
    ids = snaps.ids
    info = load_dictionary(cfg, ids)
    polys = _load_polygons(cfg)
    inner = polys.set_index("territory_id").geometry.representative_point().reindex(ids)
    missing = info["lat"].isna()
    info.loc[missing, "lat"] = inner[missing].y
    info.loc[missing, "lon"] = inner[missing].x
    ty = fit_typology(snaps, k, cfg["seed"])
    tw, tw_sim = twins(ty.profile, N_TWINS)

    dist = load_road_distances(cfg, ids)
    road_S = road_similarity(dist, cfg["graph"]["road_scale_km"])
    R = category_residuals(wide, ids, cfg["features"]["categories"])
    A = build_graph("hybrid", snaps, len(snaps.months) - 1, cfg, R, road_S).tocsr()

    cats = cfg["features"]["categories"] + [OTHER]
    shares = snaps.raw[[f"share:{c}" for c in cats]]
    last12 = [m for m in snaps.months if m.startswith("2024")]
    mean_shares = shares[shares.index.get_level_values(1).isin(last12)].groupby(level=0).mean().loc[ids]
    total = wide[TOTAL].unstack().loc[ids]
    all_months = list(total.columns)

    records = []
    for i, tid in enumerate(ids):
        row = A.getrow(i)
        nb = row.indices[np.argsort(-row.data)][:N_NEIGHBOURS]
        r = info.loc[tid]
        records.append(
            {
                "id": int(tid),
                "n": _display_name(r),
                "f": r["full_name"],
                "k": r["mo_type"],
                "r": r["region_name"],
                "rc": int(r["region_code"]),
                "c": r["center"] if isinstance(r["center"], str) else "",
                "t": int(ty.static[i]),
                "tm": "".join(map(str, ty.monthly[:, i])),
                "sh": [round(float(v), 4) for v in mean_shares.iloc[i]],
                "s": [int(v) for v in total.iloc[i]],
                "ma": round(float(ma.get(tid, np.nan)), 1) if tid in ma.index else None,
                "tw": [int(ids[j]) for j in tw[i]],
                "tws": [round(float(v), 3) for v in tw_sim[i]],
                "nb": [int(ids[j]) for j in nb],
                "lat": round(float(r["lat"]), 4),
                "lon": round(float(r["lon"]), 4),
            }
        )

    national = {
        "s": [int(v) for v in total.median().round()],
        "sh": [round(float(v), 4) for v in mean_shares.median()],
    }
    types = []
    for t in range(k):
        members = ty.static == t
        tc = types_cfg["types"][t]
        types.append(
            {
                "id": t,
                **tc,
                "n": int(members.sum()),
                "sh": [round(float(v), 4) for v in mean_shares[members].median()],
                "s": [int(v) for v in total[members].median().round()],
                "stay": round(float((ty.monthly[:, members] == t).mean()), 3),
            }
        )

    transitions = []
    for a, b in zip(range(len(snaps.months) - 1), range(1, len(snaps.months))):
        m = pd.crosstab(ty.monthly[a], ty.monthly[b]).reindex(index=range(k), columns=range(k), fill_value=0)
        transitions.append(m.to_numpy().tolist())

    meta = {
        "months": all_months,
        "snapshot_months": snaps.months,
        "categories": cats,
        "n_mo": len(ids),
        "types": types,
        "national": national,
        "transitions": transitions,
        "graph": {"rule": "hybrid", "k": cfg["graph"]["k"], "edges": int(A.nnz // 2)},
    }
    json.dump(meta, open(out / "meta.json", "w", encoding="utf-8"), ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    json.dump(records, open(out / "mo.json", "w", encoding="utf-8"), ensure_ascii=False, allow_nan=False, separators=(",", ":"))

    rows, cols = A.nonzero()
    upper = rows < cols
    edges = np.stack([rows[upper], cols[upper], np.round(A.data[upper] * 1000)], 1).astype(int).tolist()
    json.dump(edges, open(out / "edges.json", "w"), separators=(",", ":"))

    if with_geometry:
        (out / "mo.topojson").write_text(_geometry(cfg, polys, set(int(i) for i in ids)))
