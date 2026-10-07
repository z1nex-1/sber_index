import json
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

INK, INK3, ACCENT, PAPER, RULE = "#1d1b17", "#8a8374", "#b3261e", "#f8f5ee", "#cfc6b2"
METHOD_NAMES = {
    "kmeans": "k-средних", "gmm": "Гауссова смесь", "ward": "Уорд", "spectral": "Спектральная по сети",
    "leiden": "Leiden", "attributed_spectral": "Спектральная: признаки + сеть", "sefnac": "SEFNAC", "dmon": "DMoN",
}
RULE_NAMES = {
    "cosine": "профили", "residual_corr": "корреляция", "lagged_corr": "лаг", "dtw": "DTW",
    "road": "дороги", "hybrid": "гибрид", "multiplex": "мультиплекс",
}


def _style():
    import matplotlib as mpl
    from matplotlib import font_manager

    for f in Path("report/fonts").glob("*.ttf"):
        font_manager.fontManager.addfont(str(f))
    mpl.rcParams.update({
        "font.family": "PT Sans", "font.size": 9, "axes.edgecolor": INK3, "axes.labelcolor": INK,
        "xtick.color": INK3, "ytick.color": INK3, "axes.spines.top": False, "axes.spines.right": False,
        "figure.facecolor": "white", "axes.facecolor": "white", "svg.fonttype": "none",
        "axes.grid": True, "grid.color": "#ece6d8", "grid.linewidth": 0.6,
    })


def rank_matrix(res, ax):
    r = pd.read_csv(res / "ranking.csv")
    methods = [m for m in METHOD_NAMES if m in set(r.method)]
    ks = sorted(r.k.unique())
    M = np.full((len(methods), len(ks)), np.nan)
    for i, m in enumerate(methods):
        for j, k in enumerate(ks):
            v = r[(r.method == m) & (r.k == k)].kemeny_rank
            if len(v):
                M[i, j] = v.min()
    from matplotlib.colors import LinearSegmentedColormap

    cmap = LinearSegmentedColormap.from_list("ink", [INK, "#efe8d8"])
    ax.imshow(np.clip(M, 1, 12), cmap=cmap, vmin=1, vmax=12, aspect="auto")
    for i in range(len(methods)):
        for j in range(len(ks)):
            if np.isfinite(M[i, j]):
                ax.text(j, i, int(M[i, j]), ha="center", va="center", fontsize=8, color=PAPER if M[i, j] <= 5 else INK)
            else:
                ax.text(j, i, "—", ha="center", va="center", fontsize=8, color=INK3)
    ax.set_xticks(range(len(ks)), [f"k={k}" for k in ks])
    ax.set_yticks(range(len(methods)), [METHOD_NAMES[m] for m in methods])
    ax.grid(False)
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)


def cross_mq(res, ax, k):
    g = pd.read_csv(res / "grid.csv")
    rk = pd.read_csv(res / "ranking.csv").set_index("key")
    graphs = list(RULE_NAMES)
    rows = []
    for m in METHOD_NAMES:
        c = g[(g.method == m) & (g.k == k)]
        if not len(c):
            continue
        c = c.assign(rank=c.key.map(rk.kemeny_rank)).sort_values("rank", na_position="last")
        rows.append(c.iloc[0])
    M = np.array([[row[f"MQ@{gr}"] for gr in graphs] for row in rows])
    ax.imshow(M, cmap="Greys", aspect="auto", vmin=0, vmax=0.8)
    for i, row in enumerate(rows):
        for j, gr in enumerate(graphs):
            own = row.rule == gr
            ax.text(j, i, f"{M[i, j]:.2f}".replace(".", ","), ha="center", va="center", fontsize=7.5,
                    color=PAPER if M[i, j] > 0.45 else INK, fontweight="bold" if own else "normal")
            if own:
                ax.add_patch(__import__("matplotlib").patches.Rectangle((j - 0.5, i - 0.5), 1, 1, fill=False, ec=ACCENT, lw=1.6))
    ax.set_xticks(range(len(graphs)), [RULE_NAMES[x] for x in graphs])
    ax.set_yticks(range(len(rows)), [f"{METHOD_NAMES[r.method]} ({RULE_NAMES.get(r.rule, 'без сети')})" for r in rows])
    ax.grid(False)
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)


def stability(res, ax, final):
    s = pd.read_csv(res / "stability.csv")
    parts = s.key.str.split("|", expand=True)
    s["method"], s["rule"], s["k"] = parts[0], parts[1], parts[2].astype(int)
    f = s[(s.method == final["method"]) & (s.rule == final["rule"])].sort_values("k")
    ax.plot(f.k, f.ari_boot_mean, color=INK, lw=2, marker="o", ms=4, label="спектральная: признаки + гибрид")
    ax.fill_between(f.k, f.ari_boot_q10, f.ari_boot_mean, color=RULE, alpha=0.6, lw=0)
    o = s[~((s.method == final["method"]) & (s.rule == final["rule"]))]
    ax.scatter(o.k, o.ari_boot_mean, s=14, color=INK3, zorder=3, label="другие кандидаты из тройки лидеров")
    ax.axvline(final["k"], color=ACCENT, lw=1, ls="--")
    ax.set_xlabel("число типов k")
    ax.set_ylabel("ARI на подвыборках 80%")
    ax.set_ylim(0.3, 1.0)
    ax.legend(frameon=False, loc="lower left", fontsize=8)


def null_hist(res, ax):
    d = json.loads((res / "dynamics.json").read_text(encoding="utf-8"))
    ax.hist(d["null_samples"], bins=12, color=RULE, edgecolor="white")
    ax.axvline(d["persistent"], color=ACCENT, lw=2)
    ax.text(d["persistent"] - 0.5, ax.get_ylim()[1] * 0.92, f"наблюдается: {d['persistent']}", ha="right", color=ACCENT, fontsize=8)
    ax.set_xlabel("устойчивых смен типа при перемешанных месяцах")
    ax.set_ylabel("перестановок")
    ax.grid(axis="x", visible=False)


def sensitivity(res, axes):
    s = pd.read_csv(res / "graph_sensitivity.csv")
    for rule, grp in s.groupby("rule", sort=False):
        grp = grp.sort_values("knn")
        style = dict(color=INK if rule == "hybrid" else INK3, lw=2 if rule == "hybrid" else 1, marker="o", ms=3)
        axes[0].plot(grp.knn, grp.MQ, **style)
        axes[1].plot(grp.knn, grp.same_region, **style)
        axes[0].annotate(RULE_NAMES[rule], (grp.knn.iloc[-1], grp.MQ.iloc[-1]), xytext=(4, 0), textcoords="offset points", fontsize=8, va="center")
        axes[1].annotate(RULE_NAMES[rule], (grp.knn.iloc[-1], grp.same_region.iloc[-1]), xytext=(4, 0), textcoords="offset points", fontsize=8, va="center")
    axes[0].set_title("модулярность итоговых типов", fontsize=9, loc="left")
    axes[1].set_title("доля связей внутри региона", fontsize=9, loc="left")
    for ax in axes:
        ax.set_xlabel("соседей у узла, k в kNN")
        ax.set_xlim(right=ax.get_xlim()[1] + 6)


def type_profiles(res, ax, cfg):
    from .data import load_consumption
    from .features import build_snapshots, rhythm
    from .data import load_market_access

    wide = load_consumption(cfg)
    snaps = build_snapshots(wide, load_market_access(cfg), cfg)
    t = pd.read_csv(res / "types.csv").set_index("territory_id").type.reindex(snaps.ids)
    raw = snaps.raw
    sh = raw[[c for c in raw if c.startswith("share:")]].groupby(level=0).mean().loc[snaps.ids]
    rel = sh / sh.median() - 1
    rel.columns = [c.removeprefix("share:") for c in rel.columns]
    rel["траты на жителя"] = np.exp(raw["level"].groupby(level=0).mean().loc[snaps.ids]) - 1
    M = rel.groupby(t.to_numpy()).median()
    names = [v["short"] for v in yaml.safe_load(open("configs/types.yaml", encoding="utf-8"))["types"].values()]
    V = M.to_numpy()
    ax.imshow(np.clip(V, -1, 1), cmap="RdBu_r", vmin=-1, vmax=1, aspect="auto")
    for i in range(V.shape[0]):
        for j in range(V.shape[1]):
            ax.text(j, i, f"{V[i, j]:+.0%}".replace("-", "−"), ha="center", va="center", fontsize=7.5,
                    color="white" if abs(V[i, j]) > 0.6 else INK)
    ax.set_xticks(range(V.shape[1]), M.columns, rotation=20, ha="right")
    ax.set_yticks(range(V.shape[0]), names)
    ax.grid(False)
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)


def build(cfg, res="outputs", out="report/fig"):
    import matplotlib.pyplot as plt

    _style()
    res, out = Path(res), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    fin = cfg["final"]

    def save(name, draw, size, ncols=1):
        fig, ax = plt.subplots(1, ncols, figsize=size, constrained_layout=True)
        draw(ax)
        fig.savefig(out / f"{name}.svg")
        plt.close(fig)

    save("rank_matrix", lambda ax: rank_matrix(res, ax), (6.6, 3.2))
    save("cross_mq", lambda ax: cross_mq(res, ax, fin["k"]), (6.6, 3.0))
    save("stability", lambda ax: stability(res, ax, fin), (6.2, 2.8))
    save("null", lambda ax: null_hist(res, ax), (5.2, 2.4))
    save("sensitivity", lambda ax: sensitivity(res, ax), (6.6, 2.6), ncols=2)
    save("profiles", lambda ax: type_profiles(res, ax, cfg), (6.6, 3.0))
