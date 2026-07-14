#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "============================================================"
echo "  SmartQA -- Fix backend dependency install errors"
echo "============================================================"
echo ""
echo "  This re-syncs your existing .venv against the latest"
echo "  requirements.txt, which fixes:"
echo "    - 'test case generation failed' (numpy/chromadb conflict)"
echo "    - pydantic-core build errors on Python 3.13 (needs Rust)"
echo "    - '__firstlineno__' crash on startup (old sqlalchemy on Python 3.13)"
echo "    - 'the greenlet library is required' crash (missing greenlet on Python 3.13)"
echo "    - pandas Python 3.13 wheel unavailability"
echo ""

cd "$SCRIPT_DIR/backend"

if [ ! -f ".venv/bin/activate" ]; then
    echo "[ERROR] No .venv found. Run setup.sh first."
    exit 1
fi

source .venv/bin/activate
echo "Re-installing backend dependencies from requirements.txt..."
pip install -r requirements.txt --quiet

echo ""
echo "[OK] Fix applied. Restart the backend (./run_backend.sh) to pick it up."
echo ""
