#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "============================================================"
echo "  SmartQA -- Fix 'test case generation failed' error"
echo "============================================================"
echo ""
echo "  This patches an existing installation where chromadb crashes"
echo "  due to numpy 2.x incompatibility (np.float_ removed)."
echo ""

cd "$SCRIPT_DIR/backend"

if [ ! -d ".venv" ]; then
    echo "[ERROR] No .venv found. Run setup.sh first."
    exit 1
fi

source .venv/bin/activate
echo "Downgrading numpy to a chromadb-compatible version..."
pip install "numpy<2.0" --quiet

echo ""
echo "[OK] Fix applied. Restart the backend (./run_backend.sh) to pick it up."
echo ""
