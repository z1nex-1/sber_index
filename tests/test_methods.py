import numpy as np
import scipy.sparse as sp
from sklearn.metrics import adjusted_rand_score

from atlas.features import clr
from atlas.methods import attributed_spectral, leiden, sefnac


def planted(seed=0, n=40, k=3):
    rng = np.random.default_rng(seed)
    y = np.repeat(np.arange(k), n)
    X = rng.normal(0, 1, (n * k, 4)) + np.eye(k, 4)[y] * 3
    P = np.where(y[:, None] == y[None, :], 0.3, 0.02)
    A = np.triu(rng.random(P.shape) < P, 1)
    A = (A | A.T).astype(float)
    return X, sp.csr_matrix(A), y


def test_clr_rows_sum_to_zero():
    s = np.array([[0.2, 0.3, 0.5], [0.1, 0.1, 0.8]])
    assert np.allclose(clr(s).sum(1), 0)


def test_methods_recover_planted_partition():
    X, A, y = planted()
    for f in (attributed_spectral, sefnac, leiden):
        assert adjusted_rand_score(y, f(X, A, 3, 0)) > 0.8, f.__name__
