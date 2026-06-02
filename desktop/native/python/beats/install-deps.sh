#!/usr/bin/env bash
# Beat analysis venv under desktop/ — isolated from repo-root .venv and web app.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$DESKTOP_ROOT"
PY="${PYTHON_BOOTSTRAP:-python3}"
VENV="$DESKTOP_ROOT/.venv-beats"
if ! test -d "$VENV"; then
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/pip" install -U pip
"$VENV/bin/pip" install 'setuptools>=69,<76' wheel
"$VENV/bin/pip" install cython "numpy>=1.19,<1.24" scipy
"$VENV/bin/pip" install madmom==0.16.1 --no-build-isolation
echo "OK: beats venv at $VENV"
echo "    Launch Electron with BARBRO_PYTHON=$VENV/bin/python3 (or add to shell profile)"
echo "    NOTE: section-border analysis lives in its own auto-managed venv;"
echo "          no manual install needed for that one."
