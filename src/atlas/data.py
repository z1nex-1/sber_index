from pathlib import Path

import numpy as np
import pandas as pd

TOTAL = "Все категории"


def load_config(path):
    import yaml

    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_consumption(cfg):
    raw = Path(cfg["data"]["raw_dir"])
    c = pd.read_parquet(raw / "consumption.parquet")
    wide = c.pivot_table(index=["territory_id", "date"], columns="category", values="value")
    wide.columns.name = None
    months = wide.reset_index().groupby("territory_id")["date"].nunique()
    keep = months[months >= cfg["data"]["min_months"]].index
    wide = wide.loc[wide.index.get_level_values(0).isin(keep)]
    return wide.dropna().sort_index()


def load_dictionary(cfg, ids=None):
    d = pd.read_excel(cfg["data"]["dictionary"])
    d = d.sort_values("year_to").drop_duplicates("territory_id", keep="last").set_index("territory_id")
    cols = [
        "municipal_district_name_short",
        "municipal_district_name",
        "municipal_district_type",
        "municipal_district_status",
        "municipal_district_center",
        "region_code",
        "region_name",
        "municipal_district_center_lat",
        "municipal_district_center_lon",
    ]
    d = d[cols].rename(
        columns={
            "municipal_district_name_short": "name",
            "municipal_district_name": "full_name",
            "municipal_district_type": "mo_type",
            "municipal_district_status": "status",
            "municipal_district_center": "center",
            "municipal_district_center_lat": "lat",
            "municipal_district_center_lon": "lon",
        }
    )
    return d if ids is None else d.reindex(ids)


def load_market_access(cfg):
    raw = Path(cfg["data"]["raw_dir"])
    return pd.read_parquet(raw / "market_access.parquet").set_index("territory_id")["market_access"]


def load_road_distances(cfg, ids):
    raw = Path(cfg["data"]["raw_dir"])
    e = pd.read_parquet(raw / "connection.parquet", filters=[("type", "==", "highway")])
    ids = pd.Index(ids)
    e = e[e.territory_id_x.isin(ids) & e.territory_id_y.isin(ids)]
    pos = pd.Series(np.arange(len(ids)), index=ids)
    n = len(ids)
    dist = np.full((n, n), np.inf)
    i, j = pos[e.territory_id_x].to_numpy(), pos[e.territory_id_y].to_numpy()
    dist[i, j] = e.distance.to_numpy()
    dist[j, i] = e.distance.to_numpy()
    np.fill_diagonal(dist, 0.0)
    return dist
