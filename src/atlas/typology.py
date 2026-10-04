import numpy as np


def order_by_level(labels, level):
    """Номера типов по убыванию медианного уровня трат: 0 — самые высокие расходы."""
    k = labels.max() + 1
    med = np.array([np.median(level[labels == c]) for c in range(k)])
    remap = np.empty(k, dtype=int)
    remap[np.argsort(-med)] = np.arange(k)
    return remap[labels]


def twins(profile, n):
    Z = profile / np.linalg.norm(profile, axis=1, keepdims=True)
    S = Z @ Z.T
    np.fill_diagonal(S, -np.inf)
    idx = np.argsort(-S, axis=1)[:, :n]
    return idx, np.take_along_axis(S, idx, axis=1)
