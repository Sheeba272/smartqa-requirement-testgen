@echo off
setlocal EnableDelayedExpansion
title SmartQA -- Test Case Generation Agent :3002

echo.
echo ============================================================
echo   Test Case Generation Agent (Agent 2)
echo   Port: 3002
echo ============================================================
echo.
echo   NOTE: make sure run_backend.bat is running first
echo   (this agent calls the shared backend at :8001)
echo.

cd /d "%~dp0testcase-agent"

node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install Node.js v20+ from https://nodejs.org
    pause & exit /b 1
)

set NEED_INSTALL=0
if not exist "node_modules" set NEED_INSTALL=1
if not exist "node_modules\.package-lock.json" set NEED_INSTALL=1

if !NEED_INSTALL! == 1 (
    echo [SETUP] Installing npm packages -- this happens once per change,
    echo         takes 1-2 minutes...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check your internet connection and try again.
        pause & exit /b 1
    )
) else (
    call npm ls --depth=0 >nul 2>npm_check.log
    findstr /C:"missing" npm_check.log >nul 2>&1
    if not errorlevel 1 (
        echo [SETUP] Detected missing dependencies -- syncing npm packages...
        call npm install
    )
    del npm_check.log >nul 2>&1
)

if not exist ".env.local" (
    echo NEXT_PUBLIC_API_URL=http://localhost:8001> .env.local
    echo [OK] Created .env.local
)

:: ── Self-heal: clear the .next build cache ───────────────────
:: Prevents stale "Module not found" errors after manual file replacement
:: (see run_requirement_agent.bat for full explanation).
if exist ".next" (
    echo [SETUP] Clearing .next build cache to avoid stale-module errors...
    rmdir /s /q ".next" >nul 2>&1
)

echo.
curl -s -m 2 http://localhost:8001/health >nul 2>&1
if errorlevel 1 (
    echo ============================================================
    echo   [WARNING] Backend not reachable at http://localhost:8001
    echo ============================================================
    echo.
    echo   This agent needs the shared backend running first, or
    echo   "Generate test cases" will fail with a connection error.
    echo.
    echo   Open a SEPARATE terminal window and run:
    echo       run_backend.bat
    echo.
    echo   This agent will keep starting below -- the backend check
    echo   will run again automatically when you click "Generate".
    echo.
) else (
    echo [OK] Backend is reachable at :8001
)
echo.
echo Test Case Generation Agent starting at http://localhost:3002
echo.
call npm run dev
pause
