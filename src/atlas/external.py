import re

import pandas as pd

BULLETIN = "data/external/BUL_MO_2024.xlsx"
MONO_SHEETS = {"Таб_5.1": "сложное", "Таб_5.2": "риски", "Таб_5.3": "стабильное"}


def _norm(s):
    s = str(s).lower().replace("ё", "е")
    s = re.sub(r"\b(город|г|городской|муниципальный|округ|район|образование|-)\b", " ", s)
    return re.sub(r"[^а-я0-9]+", " ", s).split()


def _key(region, name):
    return (int(region), " ".join(_norm(name)))


def _dictionary(path):
    d = pd.read_excel(path, dtype={"oktmo": str})
    d = d.sort_values("year_to").drop_duplicates("territory_id", keep="last")
    d["okt8"] = d.oktmo.str.replace("-", "").str[:8]
    return d.set_index("territory_id")


def load_population(dict_path, bulletin=BULLETIN):
    p = pd.read_excel(bulletin, "Численность_по_МО", header=None, skiprows=7, dtype={0: str})
    p.columns = ["code", "name", "pop", "urban", "rural"]
    p["code"] = p.code.str.replace(" ", "")
    p = p[p.code.str.len() == 10]
    p["okt8"] = p.code.str[:8]
    p["nkey"] = [(c[:2], " ".join(_norm(n))) for c, n in zip(p.code, p.name)]
    d = _dictionary(dict_path)
    # часть районов в 2023–2024 стали муниципальными округами с новыми кодами — тогда ищем по названию в регионе
    by_code = p.drop_duplicates("okt8").set_index("okt8")[["pop", "urban"]]
    by_name = p.drop_duplicates("nkey").set_index("nkey")[["pop", "urban"]]
    keys = [(o[:2], " ".join(_norm(n))) for o, n in zip(d.okt8, d.municipal_district_name)]
    out = by_code.reindex(d.okt8).set_axis(d.index)
    alt = by_name.reindex(pd.Index(keys, tupleize_cols=False)).set_axis(d.index)
    out = out.fillna(alt).apply(pd.to_numeric, errors="coerce")
    out["urban_share"] = out.urban / out["pop"]
    return out[["pop", "urban_share"]]


def _region_rows(sheet, bulletin):
    """Строки таблиц бюллетеня по районам: регион идёт отдельной строкой перед своими МО."""
    t = pd.read_excel(bulletin, sheet, header=None, dtype=str)
    region, rows = None, []
    for name in t[1].dropna():
        if re.search(r"(област|край|республик|автономн|город федерального|москва|санкт-петербург|севастополь)", name.lower()) \
                and not re.search(r"(район|округ\b.*муницип|городской округ)", name.lower()):
            region = name
            continue
        rows.append((region, name))
    return rows


def load_north(dict_path, bulletin=BULLETIN):
    """Районы Крайнего Севера и приравненные местности (табл. 3 бюллетеня) — сопоставление по названию внутри региона."""
    d = _dictionary(dict_path)
    by_name = {}
    for tid, r in d.iterrows():
        by_name.setdefault((" ".join(_norm(r.region_name)), " ".join(_norm(r.municipal_district_name))), tid)
    flag = pd.Series(False, index=d.index)
    for region, name in _region_rows("Таб_3", bulletin):
        tid = by_name.get((" ".join(_norm(region)), " ".join(_norm(name))))
        if tid is not None:
            flag[tid] = True
    return flag


def load_monotowns(dict_path, bulletin=BULLETIN):
    d = _dictionary(dict_path)
    code = {}
    for sheet, status in MONO_SHEETS.items():
        t = pd.read_excel(bulletin, sheet, header=None, dtype=str)
        t = t[t[1].notna() & t[0].notna()]
        for c in t[0]:
            c = c.split(".")[0].zfill(10)
            code.setdefault(c[:8], status)
    return d.okt8.map(code)


def load_external(cfg, ids):
    path = cfg["data"]["dictionary"]
    ext = load_population(path)
    ext["north"] = load_north(path)
    ext["mono"] = load_monotowns(path)
    return ext.reindex(ids)
