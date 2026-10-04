from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import normalized_mutual_info_score


QUANTILES = {"≥ q90": 0.9, "≥ q75": 0.75, "≥ q25": 0.25, "≤ q75": 0.75, "≤ q25": 0.25, "≤ q10": 0.1}


def formal_context(shares, level, rhythm_df):
    """Бинарный контекст «МО × признак» с порядковым шкалированием каждого числового признака:
    пороги по 10, 25, 75 и 90-му процентилям в обе стороны (интерпорядковая шкала). Признаки
    вложены, поэтому понятия описывают и направление, и силу отклонения, а пара «≥ q25» и «≤ q75» —
    середину распределения."""
    num = pd.concat([shares.rename(columns=lambda c: c.removeprefix("share:")), level.rename("траты на жителя"),
                     rhythm_df.rename(columns={"amplitude": "сезонность", "summer": "летний пик", "volatility": "волатильность"})], axis=1)
    ctx = {}
    for c in num:
        for name, q in QUANTILES.items():
            thr = num[c].quantile(q)
            ctx[f"{c} {name}"] = num[c] >= thr if name.startswith("≥") else num[c] <= thr
    return pd.DataFrame(ctx)


def extent(I, attrs):
    return I[list(attrs)].all(1).to_numpy() if attrs else np.ones(len(I), dtype=bool)


def intent(I, objs):
    return [a for a in I.columns if I.loc[objs, a].all()] if objs.any() else list(I.columns)


def delta_stability(I, A, B):
    """Δ-мера устойчивости понятия (Buzmakov, Kuznetsov, Napoli, 2014): на сколько объектов
    сократится объём при добавлении любого нового признака. Большое Δ — понятие не держится
    на нескольких случайных МО."""
    size = A.sum()
    drops = [size - (A & I[b].to_numpy()).sum() for b in I.columns if b not in B]
    return int(min(drops)) if drops else int(size)


def describe_types(I, labels, max_attrs=3, min_precision=0.5, min_extent=10):
    """Для каждого типа — формальное понятие (B', B''), чей объём лучше всего совпадает с типом по F1."""
    rows = []
    for t in np.unique(labels):
        T = labels == t
        best = None
        for r in range(1, max_attrs + 1):
            for B in combinations(I.columns, r):
                A = extent(I, B)
                hit = (A & T).sum()
                if hit == 0 or A.sum() < min_extent:
                    continue
                prec, rec = hit / A.sum(), hit / T.sum()
                f1 = 2 * prec * rec / (prec + rec)
                if prec >= min_precision and (best is None or f1 > best[0]):
                    best = (f1, B, prec, rec)
        if best is None:
            rows.append({"type": int(t), "intent": [], "f1": 0.0})
            continue
        f1, B, prec, rec = best
        A = extent(I, B)
        closed = intent(I, pd.Series(A, index=I.index))
        rows.append({"type": int(t), "generator": list(B), "intent": closed, "extent": int(A.sum()),
                     "precision": float(prec), "recall": float(rec), "f1": float(f1),
                     "delta": delta_stability(I, extent(I, closed), closed)})
    return pd.DataFrame(rows)


def cramers_v(a, b):
    tab = pd.crosstab(a, b)
    chi2 = stats.chi2_contingency(tab)[0]
    n = tab.to_numpy().sum()
    return float(np.sqrt(chi2 / (n * (min(tab.shape) - 1)))), float(stats.chi2_contingency(tab)[1])


def eta_squared(values, labels):
    ok = values.notna().to_numpy()
    v, g = values.to_numpy()[ok], labels[ok]
    grand = v.mean()
    between = sum(len(v[g == c]) * (v[g == c].mean() - grand) ** 2 for c in np.unique(g))
    return float(between / ((v - grand) ** 2).sum())


def external_validation(labels, ext, info, market_access):
    """Связь типов с переменными, которые в кластеризации не участвовали."""
    rows = []
    for name, v in [("численность населения, log", np.log(ext["pop"])), ("доля городского населения", ext.urban_share),
                    ("индекс доступности рынков, log", np.log(market_access))]:
        ok = v.notna().to_numpy()
        h, p = stats.kruskal(*[v[ok & (labels == c)] for c in np.unique(labels)])
        rows.append({"variable": name, "measure": "η²", "value": eta_squared(v, labels), "test": "Краскел — Уоллис", "p": float(p)})
    for name, v in [("Крайний Север", ext.north.astype(bool)), ("моногород", ext.mono.notna()),
                    ("вид МО", info.mo_type), ("регион", info.region_code)]:
        cv, p = cramers_v(labels, v.to_numpy())
        rows.append({"variable": name, "measure": "V Крамера", "value": cv, "test": "χ²", "p": p})
    rows.append({"variable": "регион", "measure": "NMI", "value": float(normalized_mutual_info_score(info.region_code, labels)),
                 "test": "", "p": np.nan})
    return pd.DataFrame(rows)


def join_count(A, labels, B=200, seed=0):
    """Доля связей между МО одного типа в сети и её значение при случайной перестановке типов.

    Аналог Moran's I для категориального признака: z > 0 — типы образуют пространственные группы.
    """
    import scipy.sparse as sp

    U = sp.triu(A, 1).tocoo()
    same = (labels[U.row] == labels[U.col]).mean()
    rng = np.random.default_rng(seed)
    null = np.array([(p[U.row] == p[U.col]).mean() for p in (rng.permutation(labels) for _ in range(B))])
    return {"same_type_share": float(same), "null_mean": float(null.mean()), "z": float((same - null.mean()) / null.std())}


def within_region(labels, regions):
    """Сколько регионов содержат МО разных типов — типы не сводятся к регионам."""
    s = pd.Series(labels).groupby(np.asarray(regions)).nunique()
    return {"regions": int(len(s)), "multi_type": int((s > 1).sum()), "mean_types": float(s.mean())}
