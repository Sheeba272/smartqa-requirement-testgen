#!/usr/bin/env bash
echo "Stopping SmartQA services..."
pkill -f "uvicorn main:app" 2>/dev/null && echo "  Backend stopped" || echo "  Backend was not running"
pkill -f "next dev -p 3000" 2>/dev/null && echo "  Requirement Agent stopped" || echo "  Requirement Agent was not running"
pkill -f "next dev -p 3001" 2>/dev/null && echo "  Test Case Agent stopped" || echo "  Test Case Agent was not running"
pkill -f "ollama serve" 2>/dev/null && echo "  Ollama stopped" || echo "  Ollama was not running"
echo "Done."
