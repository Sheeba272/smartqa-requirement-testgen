#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "============================================================"
echo "  SmartQA Backend (shared by both agents)"
echo "  Port: 8001"
echo "============================================================"
echo ""

if ! curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "Starting Ollama..."
    ollama serve > /tmp/ollama.log 2>&1 &
    sleep 4
else
    echo "[OK] Ollama already running"
fi

cd "$SCRIPT_DIR/backend"

# ── Self-heal: create venv if missing ──────────────────────────
if [ ! -f ".venv/bin/activate" ]; then
    echo "[SETUP] No virtual environment found -- creating one now..."
    PY=$(command -v python3 || command -v python || true)
    if [ -z "$PY" ]; then
        echo "[ERROR] Python not found. Install Python 3.11+ from https://python.org"
        exit 1
    fi
    $PY -m venv .venv
fi

source .venv/bin/activate

# ── Self-heal: verify uvicorn is actually installed ────────────
if ! command -v uvicorn >/dev/null 2>&1; then
    echo "[SETUP] Installing backend dependencies -- this happens once,"
    echo "        takes 1-3 minutes..."
    pip install -r requirements.txt --quiet
    echo "[OK] Dependencies installed."
fi

[ ! -f ".env" ] && cp .env.example .env && echo "[OK] Created backend/.env"

if grep -q "OLLAMA_BASE_URL=http://localhost:11434" .env 2>/dev/null; then
    echo ""
    echo "[NOTE] Your backend/.env has OLLAMA_BASE_URL=http://localhost:11434"
    echo "       On Windows this can cause 'Ollama not reachable' errors due"
    echo "       to an IPv6-first DNS quirk, even when Ollama is running fine."
    echo "       Recommended: change that line to"
    echo "           OLLAMA_BASE_URL=http://127.0.0.1:11434"
    echo "       in backend/.env, then restart this script."
    echo ""
fi

echo ""
echo "Backend starting at http://localhost:8001"
echo "API docs:            http://localhost:8001/docs"
echo ""
uvicorn main:app --reload --port 8001 --host 0.0.0.0
