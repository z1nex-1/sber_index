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


def dtw_similarity(R, t, window, band, candidates):
    """DTW по ряду общих трат относительно страны, только для пар-кандидатов.

    Полный DTW для 2 млн пар не нужен: кандидаты — ближайшие по корреляции,
    DTW уточняет порядок с учётом сдвигов до band месяцев (Sakoe–Chiba).
    Сходство exp(-d / медиана d).
    """
    lo = max(0, t - window + 1)
    x = R[:, lo : t + 1, -1]
    x = (x - x.mean(1, keepdims=True)) / (x.std(1, keepdims=True) + 1e-9)
    n, L = x.shape
    C = x @ x.T / L
    np.fill_diagonal(C, -np.inf)
    nb = np.argpartition(-C, candidates, axis=1)[:, :candidates]
    a = np.repeat(np.arange(n), candidates)
    b = nb.ravel()
    xa, xb = x[a], x[b]
    D = np.full((len(a), L + 1, L + 1), np.inf)
    D[:, 0, 0] = 0.0
    for i in range(1, L + 1):
        for j in range(max(1, i - band), min(L, i + band) + 1):
            cost = (xa[:, i - 1] - xb[:, j - 1]) ** 2
            D[:, i, j] = cost + np.minimum(np.minimum(D[:, i - 1, j], D[:, i, j - 1]), D[:, i - 1, j - 1])
    d = np.sqrt(D[:, L, L])
    S = np.full((n, n), -np.inf)
    S[a, b] = np.exp(-d / np.median(d))
    return np.maximum(S, S.T)


def normalized(A):
    deg = np.asarray(A.sum(1)).ravel()
    inv = sp.diags(1 / np.sqrt(np.maximum(deg, 1e-12)))
    return inv @ A @ inv


def road_similarity(dist, scale_km):
    S = np.exp(-dist / scale_km)
    S[~np.isfinite(dist)] = 0.0
    return S


def build_graph(rule, snaps, t, cfg, R=None, road_S=None):
    """Граф месяца t; при t=None — граф по профилю за весь период и по всему ряду."""
    g = cfg["graph"]
    k = g["k"]
    static = t is None
    X = snaps.X.mean(0) if static else snaps.X[t]
    if rule == "cosine":
        return knn_graph(cosine_similarity(X), k)
    if rule == "road":
        return knn_graph(road_S, k)
    if rule == "hybrid":
        a = g["hybrid_alpha"]
        S = a * (cosine_similarity(X) + 1) / 2 + (1 - a) * road_S
        return knn_graph(S, k)
    if rule == "multiplex":
        layers = [build_graph(r, snaps, t, cfg, R, road_S) for r in g["multiplex_layers"]]
        A = sum(normalized(L) for L in layers if L is not None) / len(layers)
        return sp.csr_matrix(A)
    rt = R[1].index(snaps.months[-1 if static else t])
    window = len(R[1]) if static else g["corr_window"]
    if rule == "residual_corr":
        S = residual_corr(R[0], rt, window)
        return None if S is None else knn_graph(S, k)
    if rule == "lagged_corr":
        S, _ = lagged_corr(R[0], rt, window, g["lag_max"])
        return None if S is None else knn_graph(S, k)
    if rule == "dtw":
        S = dtw_similarity(R[0], rt, window, g["dtw_band"], g["dtw_candidates"])
        return knn_graph(S, k)
    raise ValueError(rule)


def graph_properties(A, regions, dist):
    """Свойства сети, не зависящие от разбиения."""
    import igraph as ig
    from scipy.sparse.csgraph import connected_components

    U = sp.triu(A, 1).tocoo()
    km = dist[U.row, U.col]
    deg = np.diff(A.tocsr().indptr)
    g = ig.Graph(n=A.shape[0], edges=list(zip(U.row.tolist(), U.col.tolist())))
    return {
        "edges": int(U.nnz),
        "degree": float(deg.mean()),
        "degree_max": int(deg.max()),
        "clustering": float(g.transitivity_avglocal_undirected(mode="zero")),
        "components": int(connected_components(A, directed=False)[0]),
        "same_region": float((regions[U.row] == regions[U.col]).mean()),
        "median_km": float(np.median(km[np.isfinite(km)])),
        "region_assortativity": float(g.assortativity_nominal(pd.factorize(regions)[0].tolist(), directed=False)),
    }
