import argparse

from .data import load_config


def main():
    p = argparse.ArgumentParser(prog="atlas")
    p.add_argument("command", choices=["fetch", "run", "export"])
    p.add_argument("--config", default="configs/default.yaml")
    p.add_argument("--out", default="site/data")
    p.add_argument("--no-geometry", action="store_true")
    p.add_argument("--no-verify-tls", action="store_true")
    a = p.parse_args()
    if a.command == "fetch":
        from .fetch import fetch

        fetch(verify_tls=not a.no_verify_tls)
        return
    cfg = load_config(a.config)
    if a.command == "run":
        from .pipeline import run

        run(cfg)
    if a.command == "export":
        from .export import export_site

        export_site(cfg, a.out, with_geometry=not a.no_geometry)


if __name__ == "__main__":
    main()
