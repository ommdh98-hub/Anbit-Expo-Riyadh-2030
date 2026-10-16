#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python || ! -d frontend/.next ]]; then
  echo 'Run bash scripts/setup.sh first.'
  exit 1
fi
# Demo data in backend/data/demo.db, apart from the operational backend/anbit.db.
# Set ANBIT_DB_PATH to use another database file.
export ANBIT_DB_PATH="${ANBIT_DB_PATH:-$PWD/backend/data/demo.db}"
PYTHONPATH=backend .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
npm --prefix frontend run start &
FRONTEND_PID=$!
trap 'kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true' EXIT INT TERM
printf 'Anbit: http://127.0.0.1:3000\nAPI: http://127.0.0.1:8000/docs\n'
wait
