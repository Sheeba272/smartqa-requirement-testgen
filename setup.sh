#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "============================================================"
echo "  SmartQA Setup -- 2 separate agents, 1 shared backend"
echo "============================================================"
echo ""
echo "  Backend (shared)              -> port 8001"
echo "  Requirement Validation Agent  -> port 3000"
echo "  Test Case Generation Agent    -> port 3001"
echo ""

PY=$(command -v python3 || command -v python || true)
[ -z "$PY" ] && err "Python 3.11+ required"
ok "$($PY --version 2>&1)"

command -v node >/dev/null 2>&1 || err "Node.js 20+ required"
ok "Node.js $(node --version)"

if ! command -v ollama >/dev/null 2>&1; then
    warn "Ollama not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install ollama
    else
        curl -fsSL https://ollama.com/install.sh | sh
    fi
fi
ok "Ollama ready"

echo ""
echo "============================================================"
echo "  Step 1 -- Pull Ollama models"
echo "============================================================"
if ! curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
    ollama serve &
    sleep 4
fi
ollama pull llama3.1
ollama pull nomic-embed-text
ok "Ollama models ready"

echo ""
echo "============================================================"
echo "  Step 2 -- Backend (shared)"
echo "============================================================"
cd "$SCRIPT_DIR/backend"
if [ ! -d ".venv" ]; then
    $PY -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt --quiet
ok "Backend packages installed"
[ ! -f ".env" ] && cp .env.example .env && ok "Created backend/.env"

echo ""
echo "============================================================"
echo "  Step 3 -- Requirement Validation Agent (port 3000)"
echo "============================================================"
cd "$SCRIPT_DIR/requirement-agent"
npm install
[ ! -f ".env.local" ] && echo "NEXT_PUBLIC_API_URL=http://localhost:8001" > .env.local
ok "Requirement Validation Agent ready"

echo ""
echo "============================================================"
echo "  Step 4 -- Test Case Generation Agent (port 3001)"
echo "============================================================"
cd "$SCRIPT_DIR/testcase-agent"
npm install
[ ! -f ".env.local" ] && echo "NEXT_PUBLIC_API_URL=http://localhost:8001" > .env.local
ok "Test Case Generation Agent ready"

echo ""
echo "============================================================"
echo "  Setup complete! Run: ./start_all.sh"
echo "============================================================"
