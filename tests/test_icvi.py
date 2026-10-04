import numpy as np
import scipy.sparse as sp

from atlas.icvi import feature_indices, graph_indices, modularity, s_dbw


def blobs(seed=0, n=60):
    rng = np.random.default_rng(seed)
    X = np.concatenate([rng.normal(c, 0.3, (n, 2)) for c in ([0, 0], [4, 0], [0, 4])])
    return X, np.repeat(np.arange(3), n)


def cliques(sizes, bridge=0.0):
    n = sum(sizes)
    A = np.zeros((n, n))
    start = 0
    for s in sizes:
        A[start:start + s, start:start + s] = 1
        start += s
    if bridge:
        A[0, n - 1] = A[n - 1, 0] = bridge
    np.fill_diagonal(A, 0)
    return sp.csr_matrix(A), np.repeat(np.arange(len(sizes)), sizes)


def test_feature_indices_prefer_true_partition():
    X, y = blobs()
    rnd = np.random.default_rng(1).permutation(y)
    good, bad = feature_indices(X, y), feature_indices(X, rnd)
    assert good["SW"] > 0.7 > bad["SW"]
    assert good["CH"] > bad["CH"]
    assert s_dbw(X, y) < s_dbw(X, rnd)


def test_disconnected_cliques_are_isolated():
    A, y = cliques([5, 5, 5])
    g = graph_indices(A, y)
    assert g["AVI"] == 1.0
    assert g["AVU"] == 0.0
    assert np.isclose(g["MQ"], 1 - 3 * (1 / 3) ** 2)


def test_bridge_lowers_isolation():
    A, y = cliques([5, 5], bridge=1.0)
    g = graph_indices(A, y)
    assert g["AVI"] < 1.0 and g["AVU"] > 0.0


def test_modularity_of_single_cluster_is_zero():
    A, _ = cliques([4, 4], bridge=1.0)
    assert np.isclose(modularity(A, np.zeros(8, dtype=int)), 0.0)
