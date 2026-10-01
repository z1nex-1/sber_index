from dataclasses import dataclass

import numpy as np
import pandas as pd

from .data import TOTAL

OTHER = "Прочее"


@dataclass
class Snapshots:
    ids: pd.Index
    months: list
    X: np.ndarray
    names: list
    raw: pd.DataFrame
    series: pd.DataFrame


def clr(shares):
    logs = np.log(shares)
    return logs - logs.mean(axis=-1, keepdims=True)


def rhythm(wide):
    """Сезонная амплитуда, летний сдвиг и волатильность трат относительно страны.

    r_t = log(трат МО) - медиана log по стране в месяце t; сезонный профиль —
    среднее r по одноимённым месяцам двух лет, волатильность — СКО остатка
    после вычитания профиля и линейного тренда.
    """
    logs = np.log(wide[TOTAL])
    r = (logs - logs.groupby(level=1).transform("median")).unstack()
    r = r.sub(r.mean(1), axis=0)
    cal = np.array([int(m[5:]) for m in r.columns])
    profile = r.T.groupby(cal).mean().T
    t = np.arange(r.shape[1]) - (r.shape[1] - 1) / 2
    slope = (r * t).sum(1) / (t**2).sum()
    rest = r - profile[cal].to_numpy() - np.outer(slope, t)
    return pd.DataFrame(
        {
            "amplitude": profile.std(1),
            "summer": profile[[6, 7, 8]].mean(1) - profile.mean(1),
            "volatility": rest.std(1),
        }
    )


def build_snapshots(wide, market_access, cfg):
    fc = cfg["features"]
    cats = fc["categories"]
    w = fc["smoothing_window"]

    cols = cats + [TOTAL]
    rolled = (
        wide[cols]
        .groupby(level=0, group_keys=False)
        .apply(lambda g: g.rolling(w, min_periods=w).sum())
        .dropna()
    )
    shares = rolled[cats].div(rolled[TOTAL], axis=0)
    shares[OTHER] = 1.0 - shares.sum(axis=1)
    shares = shares.clip(lower=fc["share_floor"])
    shares = shares.div(shares.sum(axis=1), axis=0)

    log_total = np.log(rolled[TOTAL] / w)
    level = log_total - log_total.groupby(level=1).transform("median")

    ids = rolled.index.get_level_values(0).unique()
    months = sorted(rolled.index.get_level_values(1).unique())
    share_names = list(shares.columns)

    S = shares.to_numpy().reshape(len(ids), len(months), -1).transpose(1, 0, 2)
    L = level.to_numpy().reshape(len(ids), len(months)).T[..., None]
    blocks = [("structure", clr(S), [f"clr:{c}" for c in share_names]), ("level", L, ["level"])]

    if fc.get("use_rhythm", True):
        rh = rhythm(wide).loc[ids]
        blocks.append(("rhythm", np.broadcast_to(rh.to_numpy()[None], (len(months), len(ids), rh.shape[1])).copy(), list(rh.columns)))

    if fc.get("use_market_access", True):
        ma = np.log1p(market_access.reindex(ids).fillna(market_access.min()).to_numpy())
        blocks.append(("market_access", np.broadcast_to(ma[None, :, None], L.shape).copy(), ["market_access"]))

    parts, names = [], []
    for key, B, bn in blocks:
        flat = B.reshape(-1, B.shape[-1])
        z = (B - flat.mean(0)) / (flat.std(0) + 1e-9)
        parts.append(z * fc["weights"][key] / np.sqrt(B.shape[-1]))
        names += bn
    X = np.concatenate(parts, axis=-1)

    raw = pd.concat([shares.add_prefix("share:"), level.rename("level")], axis=1)
    series = np.log(wide[TOTAL]).unstack().loc[ids]
    return Snapshots(ids=ids, months=months, X=X, names=names, raw=raw, series=series)
