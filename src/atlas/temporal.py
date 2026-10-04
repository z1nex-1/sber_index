import numpy as np
import pandas as pd
from sklearn.metrics import normalized_mutual_info_score

from .graphs import build_graph


def monthly_graphs(ctx, rule):
    return [build_graph(rule, ctx.snaps, t, ctx.cfg, ctx.R, ctx.road_S).tocsr() for t in range(len(ctx.snaps.months))]


def multislice_leiden(graphs, omega, resolution, seed):
    """Мультислойный Leiden (Mucha и др., 2010): узел связан сам с собой в соседних месяцах весом omega."""
    import igraph as ig
    import leidenalg as la
    import scipy.sparse as sp

    layers = []
    for A in graphs:
        U = sp.triu(A, 1).tocoo()
        g = ig.Graph(n=A.shape[0], edges=list(zip(U.row.tolist(), U.col.tolist())), edge_attrs={"weight": U.data.tolist()})
        g.vs["id"] = list(range(A.shape[0]))
        layers.append(g)
    membership, _ = la.find_partition_temporal(
        layers, la.RBConfigurationVertexPartition, interslice_weight=omega,
        weights="weight", resolution_parameter=resolution, seed=seed,
    )
    return np.array(membership)


def jaccard(a, b):
    return len(a & b) / len(a | b) if a or b else 0.0


def track_events(labels, theta):
    """События жизни кластеров между соседними срезами (Greene, Doyle, Cunningham, 2010).

    Кластер среза t+1 продолжает кластер среза t, если их Жаккар не ниже theta.
    Один предшественник у нескольких — распад, несколько предшественников у одного — слияние,
    нет предшественника — появление, нет преемника — исчезновение.
    """
    rows = []
    for t in range(len(labels) - 1):
        prev = {c: set(np.where(labels[t] == c)[0]) for c in np.unique(labels[t])}
        nxt = {c: set(np.where(labels[t + 1] == c)[0]) for c in np.unique(labels[t + 1])}
        links = [(a, b, jaccard(prev[a], nxt[b])) for a in prev for b in nxt]
        links = [x for x in links if x[2] >= theta]
        succ = pd.Series([a for a, _, _ in links]).value_counts()
        pred = pd.Series([b for _, b, _ in links]).value_counts()
        for a in prev:
            if a not in succ:
                rows.append({"t": t + 1, "event": "исчезновение", "from": a, "to": None, "size": len(prev[a])})
            elif succ[a] > 1:
                rows.append({"t": t + 1, "event": "распад", "from": a, "to": None, "size": len(prev[a])})
        for b in nxt:
            if b not in pred:
                rows.append({"t": t + 1, "event": "появление", "from": None, "to": b, "size": len(nxt[b])})
            elif pred[b] > 1:
                rows.append({"t": t + 1, "event": "слияние", "from": None, "to": b, "size": len(nxt[b])})
        for a, b, j in links:
            if succ[a] == 1 and pred[b] == 1:
                rows.append({"t": t + 1, "event": "продолжение", "from": a, "to": b, "size": len(nxt[b]), "jaccard": j})
    return pd.DataFrame(rows)


def centroids(X, labels):
    return np.array([X[labels == c].mean(0) for c in range(labels.max() + 1)])


def neighbour_share(graphs, labels, k):
    """F_t[i, c] — доля веса связей МО i в месяце t, приходящаяся на соседей типа c."""
    H = np.eye(k)[labels]
    out = []
    for A in graphs:
        deg = np.asarray(A.sum(1)).ravel()
        out.append((A @ H) / np.maximum(deg, 1e-12)[:, None])
    return np.array(out)


def emissions(Xt, centers, tau, F=None, lam=0.0):
    """log p(наблюдение | тип c) = -||x_t - m_c||^2 / tau + lam * F_t[i, c]: признаки плюс соседи по сети."""
    e = -((Xt[..., None, :] - centers) ** 2).sum(-1) / tau
    return e if F is None else e + lam * F


def fit_lambda(X, A_share, centers, tau, labels, grid):
    """Вес сетевой части, при котором разбиение по профилю лучше всего воспроизводит итоговые типы."""
    acc = [(emissions(X, centers, tau, A_share, lam).argmax(1) == labels).mean() for lam in grid]
    return float(grid[int(np.argmax(acc))]), float(max(acc))


def viterbi_types(emit, p_switch):
    """Помесячный тип как путь скрытой марковской модели.

    emit[t, i, c] — логарифм правдоподобия типа c для МО i в месяце t; переход: остаться
    с вероятностью 1 - p_switch, сменить тип — p_switch / (k - 1). Декодирование Витерби
    отделяет устойчивую смену типа от разового отклонения: на один выброс путь не переключается.
    """
    T, N, k = emit.shape
    stay, move = np.log(1 - p_switch), np.log(p_switch / (k - 1))
    trans = np.full((k, k), move)
    np.fill_diagonal(trans, stay)
    score = emit[0].copy()
    back = np.zeros((T, N, k), dtype=np.int8)
    for t in range(1, T):
        cand = score[:, :, None] + trans[None]
        back[t] = cand.argmax(1)
        score = cand.max(1) + emit[t]
    path = np.zeros((T, N), dtype=int)
    path[-1] = score.argmax(1)
    for t in range(T - 1, 0, -1):
        path[t - 1] = back[t, np.arange(N), path[t]]
    return path


def persistent_changes(path, min_run):
    """МО, у которых тип сменился и новый держится не меньше min_run месяцев до конца периода."""
    T, N = path.shape
    rows = []
    for i in range(N):
        p = path[:, i]
        cut = np.where(p[1:] != p[:-1])[0]
        if len(cut) and T - (cut[-1] + 1) >= min_run:
            rows.append({"i": i, "from": int(p[0]), "to": int(p[-1]), "t": int(cut[-1] + 1), "switches": len(cut)})
    return pd.DataFrame(rows, columns=["i", "from", "to", "t", "switches"])


def block_null(emit, p_switch, block, min_run, B, seed):
    """Сколько «устойчивых смен» дало бы случайное перемешивание месяцев блоками по block.

    Блоки сохраняют автокорреляцию от скользящего окна, но разрушают реальный порядок во времени.
    """
    rng = np.random.default_rng(seed)
    T = emit.shape[0]
    starts = np.arange(0, T, block)
    out = []
    for _ in range(B):
        order = np.concatenate([np.arange(s, min(s + block, T)) for s in rng.permutation(starts)])
        out.append(len(persistent_changes(viterbi_types(emit[order], p_switch), min_run)))
    return np.array(out)


def switch_stats(path, static):
    return {
        "switch_rate": float((path[1:] != path[:-1]).mean()),
        "ever_changed": float((path != static[None]).any(0).mean()),
        "off_type_share": float((path != static[None]).mean()),
    }


def slice_agreement(labels, static):
    return [normalized_mutual_info_score(static, lab) for lab in labels]
