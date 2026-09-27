import numpy as np
import pandas as pd
import scipy.sparse as sp

from .data import TOTAL


def knn_graph(S, k):
    S = S.copy()
    np.fill_diagonal(S, -np.inf)
    idx = np.argpartition(-S, k, axis=1)[:, :k]
    rows = np.repeat(np.arange(len(S)), k)
    cols = idx.ravel()
    w = np.maximum(S[rows, cols], 0)
    A = sp.csr_matrix((w, (rows, cols)), shape=S.shape)
    A = A.maximum(A.T)
    A.eliminate_zeros()
    return A


def cosine_similarity(X):
    Z = X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-12)
    return Z @ Z.T


def category_residuals(wide, ids, categories):
    cols = categories + [TOTAL]
    logs = np.log(wide[cols].clip(lower=1))
    resid = logs - logs.groupby(level=1).transform("median")
    resid = resid.loc[ids]
    months = sorted(resid.index.get_level_values(1).unique())
    R = resid.to_numpy().reshape(len(ids), len(months), len(cols))
    return R, months


def _window_z(R, t, window, min_len):
    lo = max(0, t - window + 1)
    if t - lo + 1 < min_len:
        return None
    seg = R[:, lo : t + 1, :]
    seg = seg - seg.mean(1, keepdims=True)
    seg = seg / (seg.std(1, keepdims=True) + 1e-9)
    return seg


def residual_corr(R, t, window, min_len=6):
    seg = _window_z(R, t, window, min_len)
    if seg is None:
        return None
    n, L, c = seg.shape
    flat = seg.transpose(0, 2, 1).reshape(n, c * L)
    return flat @ flat.T / (c * L)


def lagged_corr(R, t, window, lag_max, min_len=6):
    seg = _window_z(R, t, window, min_len + lag_max)
    if seg is None:
        return None, None
    n, L, c = seg.shape
    best = np.full((n, n), -np.inf)
    lead = np.zeros((n, n), dtype=np.int8)
    for lag in range(-lag_max, lag_max + 1):
        a = seg[:, max(0, lag) : L + min(0, lag), :]
        b = seg[:, max(0, -lag) : L - max(0, lag), :]
        m = a.shape[1]
        fa = a.transpose(0, 2, 1).reshape(n, -1)
        fb = b.transpose(0, 2, 1).reshape(n, -1)
        C = fa @ fb.T / (c * m)
        upd = C > best
        best[upd] = C[upd]
        lead[upd] = lag
    best = (best + best.T) / 2
    return best, lead


def road_similarity(dist, scale_km):
    S = np.exp(-dist / scale_km)
    S[~np.isfinite(dist)] = 0.0
    return S


def build_graph(rule, snaps, t, cfg, R=None, road_S=None):
    g = cfg["graph"]
    k = g["k"]
    X = snaps.X[t]
    if rule == "cosine":
        return knn_graph(cosine_similarity(X), k)
    if rule == "road":
        return knn_graph(road_S, k)
    tm = snaps.months[t]
    rt = R[1].index(tm)
    if rule == "residual_corr":
        S = residual_corr(R[0], rt, g["corr_window"])
        return None if S is None else knn_graph(S, k)
    if rule == "lagged_corr":
        S, _ = lagged_corr(R[0], rt, g["corr_window"], g["lag_max"])
        return None if S is None else knn_graph(S, k)
    if rule == "hybrid":
        a = g["hybrid_alpha"]
        S = a * (cosine_similarity(X) + 1) / 2 + (1 - a) * road_S
        return knn_graph(S, k)
    raise ValueError(rule)
