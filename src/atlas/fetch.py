import hashlib
import shutil
import ssl
import subprocess
import urllib.request
import zipfile
from pathlib import Path

SOURCES = [
    (
        "https://www.sberbank.com/common/img/uploaded/files/pdf/sberindex/hackathonlicence.zip",
        "data/raw/hackathonlicence.zip",
        "a9f932ff4096a7df797d1547987937f34d3995ac445b4748177114488d12b010",
    ),
    (
        "https://www.sberbank.com/common/files/t_dict_municipal.rar",
        "data/raw/t_dict_municipal.rar",
        "319ed22684b77716641bc15b61f7325adc44e9fc47e9be2973d88412d27d21f5",
    ),
    (
        "https://rosstat.gov.ru/storage/mediabank/BUL_MO_2024.xlsx",
        "data/external/BUL_MO_2024.xlsx",
        "c831e1b408a6a21e061074f0b3a5a04c2e3bb4f8eabae6c72edff55185e921bd",
    ),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url, dest, verify_tls):
    # у sberbank.com цепочка на сертификате Минцифры, которого нет в большинстве систем;
    # без проверки TLS файл всё равно сверяется по sha256
    ctx = ssl.create_default_context() if verify_tls else ssl._create_unverified_context()
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, context=ctx, timeout=300) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def extract(path):
    raw = path.parent
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.endswith(".parquet"):
                    target = raw / "hackathonlicence" / Path(name).name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(name))
    elif path.suffix == ".rar":
        subprocess.run(["bsdtar", "-xf", str(path), "-C", str(raw)], check=True)


def fetch(verify_tls=True):
    for url, dest, digest in SOURCES:
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists() or sha256(dest) != digest:
            print(f"загрузка {url}")
            download(url, dest, verify_tls)
        got = sha256(dest)
        if got != digest:
            raise SystemExit(f"{dest}: контрольная сумма {got} не совпадает с ожидаемой {digest}")
        extract(dest)
        print(f"{dest}: ok")
