#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/requirement-agent"

echo ""
echo "============================================================"
echo "  Requirement Validation Agent (Agent 1)"
echo "  Port: 3000"
echo "============================================================"
echo ""
echo "  NOTE: make sure run_backend.sh is running first"
echo "  (this agent calls the shared backend at :8001)"
echo ""

command -v node >/dev/null 2>&1 || { echo "[ERROR] Node.js not found. Install from https://nodejs.org"; exit 1; }

NEED_INSTALL=0
[ ! -d "node_modules" ] && NEED_INSTALL=1
[ ! -f "node_modules/.package-lock.json" ] && NEED_INSTALL=1

if [ "$NEED_INSTALL" = "1" ]; then
    echo "[SETUP] Installing npm packages -- this happens once per change..."
    npm install
else
    # Quick integrity check against package.json drift
    if npm ls --depth=0 2>&1 | grep -q "missing"; then
        echo "[SETUP] Detected missing dependencies -- syncing npm packages..."
        npm install
    fi
fi

[ ! -f ".env.local" ] && echo "NEXT_PUBLIC_API_URL=http://localhost:8001" > .env.local

echo ""
if curl -s -m 2 http://localhost:8001/health >/dev/null 2>&1; then
    echo "[OK] Backend is reachable at :8001"
else
    echo "============================================================"
    echo "  [WARNING] Backend not reachable at http://localhost:8001"
    echo "============================================================"
    echo ""
    echo "  This agent needs the shared backend running first, or"
    echo "  'Run Agent 1 - Validate' will fail with a connection error."
    echo ""
    echo "  Open a SEPARATE terminal window and run:"
    echo "      ./run_backend.sh"
    echo ""
    echo "  This agent will keep starting below -- the backend check"
    echo "  will run again automatically when you submit a requirement."
    echo ""
fi
echo ""
echo "Requirement Validation Agent starting at http://localhost:3000"
echo ""
npm run dev
