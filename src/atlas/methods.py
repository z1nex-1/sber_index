import numpy as np
import scipy.sparse as sp
from sklearn.cluster import AgglomerativeClustering, KMeans, SpectralClustering
from sklearn.mixture import GaussianMixture

from .graphs import normalized

FAMILY = {
    "kmeans": "признаки",
    "gmm": "признаки",
    "ward": "признаки",
    "spectral": "граф",
    "leiden": "граф",
    "attributed_spectral": "признаки + граф",
    "sefnac": "признаки + граф",
    "dmon": "признаки + граф",
}
USES_GRAPH = {m for m, f in FAMILY.items() if f != "признаки"}


def kmeans(X, A, k, seed):
    return KMeans(k, n_init=20, random_state=seed).fit_predict(X)


def gmm(X, A, k, seed):
    return GaussianMixture(k, covariance_type="full", n_init=3, random_state=seed).fit(X).predict(X)


def ward(X, A, k, seed):
    return AgglomerativeClustering(k, linkage="ward").fit_predict(X)


def spectral(X, A, k, seed):
    return SpectralClustering(k, affinity="precomputed", assign_labels="cluster_qr", random_state=seed).fit_predict(A)


def leiden(X, A, k, seed, iters=40):
    """Leiden с модулярностью RB; разрешение подбирается бисекцией, чтобы получить k сообществ."""
    import igraph as ig
    import leidenalg as la

    U = sp.triu(A, 1).tocoo()
    g = ig.Graph(n=A.shape[0], edges=list(zip(U.row.tolist(), U.col.tolist())), edge_attrs={"weight": U.data.tolist()})
    lo, hi = -4.0, 2.0
    best = None
    for _ in range(iters):
        mid = (lo + hi) / 2
        part = la.find_partition(g, la.RBConfigurationVertexPartition, weights="weight",
                                 resolution_parameter=10**mid, seed=seed)
        labels = np.array(part.membership)
        big = np.bincount(labels) >= max(5, A.shape[0] // 200)
        n = int(big.sum())
        if best is None or abs(n - k) < abs(best[0] - k):
            best = (n, labels, big)
        if n == k:
            break
        lo, hi = (mid, hi) if n < k else (lo, mid)
    return _absorb_small(best[1], best[2], A)


def _absorb_small(labels, big, A):
    """Мелкие сообщества присоединяются к соседнему крупному по сумме весов связей."""
    labels = labels.copy()
    A = A.tocsr()
    for _ in range(10):
        small = ~big[labels]
        if not small.any():
            break
        for i in np.where(small)[0]:
            row = A.getrow(i)
            w = np.bincount(labels[row.indices], weights=row.data, minlength=len(big)) * big
            if w.max() > 0:
                labels[i] = w.argmax()
    return np.unique(labels, return_inverse=True)[1]


def feature_kernel(X, nn=15):
    """Гауссово ядро с локальным масштабом (Zelnik-Manor, Perona, 2004): sigma_i — расстояние до nn-го соседа.

    С общим масштабом плотное ядро типичных МО склеивается в один кластер, а спектральный метод
    отделяет только выбросы.
    """
    D = np.sqrt(np.maximum(((X[:, None, :] - X[None, :, :]) ** 2).sum(-1), 0))
    sig = np.sort(D, axis=1)[:, nn]
    return np.exp(-(D**2) / np.outer(sig, sig))


def attributed_spectral(X, A, k, seed, gamma=0.5):
    """Спектральная кластеризация на смеси ядра признаков и нормированной смежности.

    Обе части приведены к одинаковой средней степени, gamma — доля признаков.
    """
    K = feature_kernel(X)
    np.fill_diagonal(K, 0)
    N = normalized(A).toarray()
    W = gamma * K / K.sum(1).mean() + (1 - gamma) * N / N.sum(1).mean()
    return SpectralClustering(k, affinity="precomputed", assign_labels="cluster_qr", random_state=seed).fit_predict(W)


def sefnac(X, A, k, seed=None):
    """Последовательное извлечение сообществ по критерию восстановления данных.

    По мотивам SEFNAC (Shalileh, Mirkin, 2020): признаки Y ~ s c^T, связи P ~ lambda s s^T,
    вклад сообщества G(S) = rho * |S| * ||c||^2 + xi * lambda^2 * |S|^2, где c — среднее Y по S,
    lambda — средняя связь внутри S, rho и xi — обратные полные разбросы Y и P.
    Сообщество растёт от самой удалённой от центра точки, пока вклад увеличивается;
    затем его вклад вычитается из данных. Неизвлечённые узлы относятся к ближайшему центру.
    """
    Y = X - X.mean(0)
    P = A.toarray() if sp.issparse(A) else A.copy()
    P = P - P[~np.eye(len(P), dtype=bool)].mean()
    np.fill_diagonal(P, 0)
    rho, xi = 1 / (Y**2).sum(), 1 / (P**2).sum()
    n = len(Y)
    free = np.ones(n, dtype=bool)
    labels = np.full(n, -1)
    centers = []
    for c in range(k):
        if free.sum() < 2:
            break
        cand = np.where(free)[0]
        start = cand[np.argmax((Y[cand] ** 2).sum(1))]
        inS = np.zeros(n, dtype=bool)
        inS[start] = True
        sumY, size, sumP = Y[start].copy(), 1, 0.0
        pS = P[:, start].copy()
        score = rho * (sumY @ sumY)
        while True:
            m = size + 1
            newY = sumY[None, :] + Y
            newP = sumP + 2 * pS
            g = rho * (newY**2).sum(1) / m + xi * newP**2 / m**2
            g[~free | inS] = -np.inf
            j = int(np.argmax(g))
            if g[j] <= score:
                break
            inS[j] = True
            sumY, size, sumP = newY[j], m, newP[j]
            pS += P[:, j]
            score = g[j]
        idx = np.where(inS)[0]
        cvec, lam = sumY / size, sumP / size**2
        Y[idx] -= cvec
        P[np.ix_(idx, idx)] -= lam
        labels[idx] = c
        free[idx] = False
        centers.append(X[idx].mean(0))
    rest = labels < 0
    if rest.any():
        C = np.array(centers)
        labels[rest] = ((X[rest, None, :] - C[None]) ** 2).sum(-1).argmin(1)
    return np.unique(labels, return_inverse=True)[1]


def dmon(X, A, k, seed):
    from .dmon import fit_dmon

    return fit_dmon(X, A, k, seed)


METHODS = {
    "kmeans": kmeans,
    "gmm": gmm,
    "ward": ward,
    "spectral": spectral,
    "leiden": leiden,
    "attributed_spectral": attributed_spectral,
    "sefnac": sefnac,
    "dmon": dmon,
}
