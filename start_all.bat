@echo off
setlocal EnableDelayedExpansion
title SmartQA -- Starting 2 Agents

echo.
echo ============================================================
echo   SmartQA -- Starting all services
echo ============================================================
echo.

:: ── 1. Ollama -- only start if not already running ──────────
echo [1/4] Checking Ollama...
curl -s http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo       Starting Ollama...
    start "Ollama LLM Server" cmd /k "ollama serve"
    timeout /t 5 /nobreak >nul
) else (
    echo [OK]  Ollama already running -- skipping
)

:: ── 2. Shared Backend ───────────────────────────────────────
echo [2/4] Starting shared FastAPI backend on port 8001...
start "SmartQA Backend :8001" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn main:app --reload --port 8001 --host 127.0.0.1"
timeout /t 4 /nobreak >nul

:: ── 3. Requirement Validation Agent ──────────────────────────
echo [3/4] Starting Requirement Validation Agent on port 3000...
start "Requirement Validation Agent :3000" cmd /k "cd /d %~dp0requirement-agent && npm run dev"
timeout /t 2 /nobreak >nul

:: ── 4. Test Case Generation Agent ────────────────────────────
echo [4/4] Starting Test Case Generation Agent on port 3001...
start "Test Case Generation Agent :3001" cmd /k "cd /d %~dp0testcase-agent && npm run dev"

echo.
echo ============================================================
echo   All services starting...
echo ============================================================
echo.
echo   Requirement Validation Agent  --  http://localhost:3000
echo   Test Case Generation Agent    --  http://localhost:3001
echo   Shared API docs                --  http://localhost:8001/docs
echo   Ollama                         --  http://localhost:11434
echo.
echo   Each service has its own terminal window.
echo   Close those windows to stop the services.
echo.
echo   WORKFLOW:
echo   1. Open Requirement Agent (3000) -- paste a user story, validate
echo   2. Click "Copy ID" on a validated requirement
echo   3. Open Test Case Agent (3001) -- paste the ID, generate test cases
echo.
timeout /t 15 /nobreak >nul
start http://localhost:3000
timeout /t 2 /nobreak >nul
start http://localhost:3001
