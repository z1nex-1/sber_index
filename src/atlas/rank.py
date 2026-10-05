"""Сведение рейтингов по нескольким индексам: Борда, Коупленд, локальный оптимум Кемени."""
import numpy as np
import pandas as pd


def oriented(df, higher_is_better):
    return pd.DataFrame({c: df[c] if hib else -df[c] for c, hib in higher_is_better.items()}, index=df.index)


def borda(S):
    return S.rank(axis=0, method="average").sum(axis=1) - len(S.columns)


def majority(S):
    """M[a, b] — число индексов, по которым a строго лучше b."""
    V = S.to_numpy()
    return (V[:, None, :] > V[None, :, :]).sum(-1)


def copeland(S):
    M = majority(S)
    return pd.Series(np.sign(M - M.T).sum(axis=1), index=S.index)


def kemeny_local(S, start):
    """Порядок, в котором ни одна соседняя пара не противоречит большинству индексов.

    Ищется перестановками соседей от стартового порядка (например, по Борда);
    это локальный минимум расстояния Кемени по соседним транспозициям.
    """
    M = majority(S)
    pos = {x: i for i, x in enumerate(S.index)}
    order = [pos[x] for x in start]
    changed = True
    while changed:
        changed = False
        for i in range(len(order) - 1):
            a, b = order[i], order[i + 1]
            if M[b, a] > M[a, b]:
                order[i], order[i + 1] = b, a
                changed = True
    ranks = np.empty(len(order), dtype=int)
    ranks[order] = np.arange(len(order))
    return pd.Series(ranks, index=S.index)


def kendall_w(S):
    """Коэффициент конкордации Кендалла: насколько индексы согласны между собой (0 — нет, 1 — полностью)."""
    R = S.rank(axis=0).to_numpy()
    n, m = R.shape
    s = ((R.sum(axis=1) - m * (n + 1) / 2) ** 2).sum()
    return float(12 * s / (m**2 * (n**3 - n)))


def aggregate(S):
    b = borda(S)
    out = pd.DataFrame({"borda": b, "copeland": copeland(S)})
    out["kemeny"] = kemeny_local(S, b.sort_values(ascending=False).index)
    out["borda_rank"] = b.rank(ascending=False, method="min").astype(int)
    out["copeland_rank"] = out.copeland.rank(ascending=False, method="min").astype(int)
    out["kemeny_rank"] = out.kemeny + 1
    return out
