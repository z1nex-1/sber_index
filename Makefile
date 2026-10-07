PY ?= .venv/bin/python
RUN = PYTHONPATH=src $(PY) -m atlas

.PHONY: all setup data run site figures test serve report

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

figures:
	$(RUN) figures

test:
	$(PY) -m pytest -q

serve:
	$(PY) -m http.server 8765 --directory site

report: figures
	typst compile --root . --font-path report/fonts report/report.typ report/report.pdf
