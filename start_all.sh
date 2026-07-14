#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

echo ""
echo "============================================================"
echo -e "  ${CYAN}SmartQA${NC} -- Starting 2 agents + shared backend"
echo "============================================================"
echo ""

cleanup() {
    echo ""
    echo "Stopping all services..."
    kill $OLLAMA_PID $BACKEND_PID $REQ_PID $TC_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

# 1. Ollama
echo -e "${GREEN}[1/4]${NC} Ollama..."
if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "      already running -- skipping"
    OLLAMA_PID=""
else
    ollama serve > /tmp/ollama.log 2>&1 &
    OLLAMA_PID=$!
    sleep 3
fi

# 2. Shared backend
echo -e "${GREEN}[2/4]${NC} Shared backend on :8001..."
cd "$SCRIPT_DIR/backend"
source .venv/bin/activate
uvicorn main:app --reload --port 8001 --host 0.0.0.0 > /tmp/smartqa_backend.log 2>&1 &
BACKEND_PID=$!
sleep 3

# 3. Requirement Validation Agent
echo -e "${GREEN}[3/4]${NC} Requirement Validation Agent on :3000..."
cd "$SCRIPT_DIR/requirement-agent"
npm run dev > /tmp/smartqa_req_agent.log 2>&1 &
REQ_PID=$!

# 4. Test Case Generation Agent
echo -e "${GREEN}[4/4]${NC} Test Case Generation Agent on :3001..."
cd "$SCRIPT_DIR/testcase-agent"
npm run dev > /tmp/smartqa_tc_agent.log 2>&1 &
TC_PID=$!

echo ""
echo "============================================================"
echo -e "  ${GREEN}All services started!${NC}"
echo "============================================================"
echo ""
echo -e "  ${CYAN}Requirement Validation Agent${NC}  ->  http://localhost:3000"
echo -e "  ${CYAN}Test Case Generation Agent${NC}    ->  http://localhost:3001"
echo -e "  ${CYAN}Shared API docs${NC}               ->  http://localhost:8001/docs"
echo ""
echo "  WORKFLOW:"
echo "  1. Open Requirement Agent (3000) -- paste story, validate"
echo "  2. Click 'Copy ID' on a validated requirement"
echo "  3. Open Test Case Agent (3001) -- paste ID, generate test cases"
echo ""
echo "  Press Ctrl+C to stop all services"
echo ""

sleep 10
if command -v open >/dev/null 2>&1; then
    open http://localhost:3000
    sleep 1
    open http://localhost:3001
elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:3000
    sleep 1
    xdg-open http://localhost:3001
fi

echo "--- Backend logs (Ctrl+C to stop) ---"
tail -f /tmp/smartqa_backend.log
