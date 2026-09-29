from dataclasses import dataclass

import numpy as np
from sklearn.cluster import KMeans


@dataclass
class Typology:
    static: np.ndarray
    monthly: np.ndarray
    centers: np.ndarray
    profile: np.ndarray


def fit_typology(snaps, k, seed):
    profile = snaps.X.mean(0)
    km = KMeans(k, n_init=50, random_state=seed).fit(profile)
    order = np.argsort(-km.cluster_centers_[:, snaps.names.index("level")])
    remap = np.empty(k, dtype=int)
    remap[order] = np.arange(k)
    centers = km.cluster_centers_[order]
    static = remap[km.labels_]
    d = ((snaps.X[:, :, None, :] - centers[None, None]) ** 2).sum(-1)
    monthly = d.argmin(-1)
    return Typology(static=static, monthly=monthly, centers=centers, profile=profile)


def twins(profile, n):
    Z = profile / np.linalg.norm(profile, axis=1, keepdims=True)
    S = Z @ Z.T
    np.fill_diagonal(S, -np.inf)
    idx = np.argsort(-S, axis=1)[:, :n]
    return idx, np.take_along_axis(S, idx, axis=1)
