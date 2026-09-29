import argparse

from .data import load_config
from .export import export_site


def main():
    p = argparse.ArgumentParser(prog="atlas")
    p.add_argument("command", choices=["export"])
    p.add_argument("--config", default="configs/default.yaml")
    p.add_argument("--out", default="site/data")
    p.add_argument("--no-geometry", action="store_true")
    a = p.parse_args()
    cfg = load_config(a.config)
    if a.command == "export":
        export_site(cfg, a.out, with_geometry=not a.no_geometry)


if __name__ == "__main__":
    main()
