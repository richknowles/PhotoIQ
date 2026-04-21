#!/bin/bash
# PhotoIQ — start server
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Setting up virtual environment..."
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
  echo "Done."
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

echo ""
echo "  PhotoIQ is running at http://${HOST}:${PORT}"
echo "  On your network: http://$(hostname -I | awk '{print $1}'):${PORT}"
echo "  Press Ctrl+C to stop."
echo ""

.venv/bin/uvicorn backend.main:app --host "$HOST" --port "$PORT" --reload
