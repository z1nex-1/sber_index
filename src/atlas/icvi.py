"""Внутренние индексы качества кластеризации.

SW, CH, S_Dbw считаются по признакам узлов, AVI, AVU, MQ — по взвешенному графу.
S_Dbw — по Halkidi, Vazirgiannis (2001). AVI и AVU — средняя изолированность
кластеров и средняя связанность пар кластеров по Biswas, Biswas (2017,
Expert Systems with Applications 70). MQ — модулярность Ньюмана.
"""

import numpy as np
import scipy.sparse as sp
from sklearn.metrics import calinski_harabasz_score, silhouette_score

HIGHER_IS_BETTER = {"SW": True, "CH": True, "S_Dbw": False, "AVI": True, "AVU": False, "MQ": True}


def s_dbw(X, labels):
    ks = np.unique(labels)
    k = len(ks)
    centers = np.array([X[labels == c].mean(0) for c in ks])
    sig = np.array([X[labels == c].var(0) for c in ks])
    norm_sig = np.linalg.norm(sig, axis=1)
    scat = norm_sig.mean() / np.linalg.norm(X.var(0))
    stdev = np.sqrt(norm_sig.sum()) / k

    def density(point, members):
        return np.sum(np.linalg.norm(members - point, axis=1) <= stdev)

    dens_c = [density(centers[i], X[labels == ks[i]]) for i in range(k)]
    total = 0.0
    for i in range(k):
        for j in range(k):
            if i == j:
                continue
            members = X[(labels == ks[i]) | (labels == ks[j])]
            mid = (centers[i] + centers[j]) / 2
            denom = max(dens_c[i], dens_c[j])
            total += density(mid, members) / denom if denom > 0 else 0.0
    return scat + total / (k * (k - 1))


def _block_weights(W, labels):
    ks, inv = np.unique(labels, return_inverse=True)
    H = sp.csr_matrix((np.ones(len(labels)), (np.arange(len(labels)), inv)), shape=(len(labels), len(ks)))
    B = (H.T @ W @ H).toarray()
    return B


def isolability_unifiability(W, labels):
    B = _block_weights(sp.csr_matrix(W), labels)
    inner = np.diag(B) / 2
    between = B.copy()
    np.fill_diagonal(between, 0)
    cut = between.sum(1)
    iso = inner / np.maximum(inner + cut, 1e-12)
    k = len(inner)
    uni = [
        between[i, j] / max(inner[i] + inner[j] + between[i, j], 1e-12)
        for i in range(k)
        for j in range(i + 1, k)
    ]
    return float(iso.mean()), float(np.mean(uni)) if uni else 0.0


def modularity(W, labels):
    W = sp.csr_matrix(W)
    m2 = W.sum()
    deg = np.asarray(W.sum(1)).ravel()
    B = _block_weights(W, labels)
    ks, inv = np.unique(labels, return_inverse=True)
    dc = np.bincount(inv, weights=deg)
    return float(np.trace(B) / m2 - np.sum((dc / m2) ** 2))


FEATURE_INDICES = ["SW", "CH", "S_Dbw"]
GRAPH_INDICES = ["AVI", "AVU", "MQ"]


def feature_indices(X, labels, sample=None, seed=0):
    if len(np.unique(labels)) < 2:
        return dict.fromkeys(FEATURE_INDICES, np.nan)
    return {
        "SW": float(silhouette_score(X, labels, sample_size=sample, random_state=seed)),
        "CH": float(calinski_harabasz_score(X, labels)),
        "S_Dbw": float(s_dbw(X, labels)),
    }


def graph_indices(W, labels):
    if len(np.unique(labels)) < 2:
        return dict.fromkeys(GRAPH_INDICES, np.nan)
    avi, avu = isolability_unifiability(W, labels)
    return {"AVI": avi, "AVU": avu, "MQ": modularity(W, labels)}


def all_indices(X, W, labels, sample=None, seed=0):
    return {**feature_indices(X, labels, sample, seed), **graph_indices(W, labels)}
