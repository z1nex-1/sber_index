PY ?= .venv/bin/python
RUN = PYTHONPATH=src $(PY) -m atlas

.PHONY: all setup data run site test serve report

all: data run site

setup:
	python3 -m venv .venv
	$(PY) -m pip install -r requirements-dmon.txt -r requirements-dev.txt

data:
	$(RUN) fetch

run:
	$(RUN) run

site:
	$(RUN) export

test:
	$(PY) -m pytest -q

serve:
	$(PY) -m http.server 8765 --directory site

report:
	typst compile --root . report/report.typ report/report.pdf
