#!/usr/bin/env bash
# Idempotent install for BarBro beat analysis (madmom + deps).
# From repo root: bash src/lib/server/analysis/python/install-deps.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
cd "$ROOT"
PY="${PYTHON_BOOTSTRAP:-python3}"
if ! test -d .venv; then
  "$PY" -m venv .venv
fi
.venv/bin/pip install -U pip
.venv/bin/pip install 'setuptools>=69,<76' wheel
.venv/bin/pip install cython "numpy>=1.19,<1.24" scipy
.venv/bin/pip install madmom==0.16.1 --no-build-isolation
echo "OK: use PYTHON=\"$ROOT/.venv/bin/python3\" npm run dev"
