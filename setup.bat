@echo off
setlocal EnableDelayedExpansion
title SmartQA -- Setup (2 Agents)

echo.
echo ============================================================
echo   SmartQA -- Setup: 2 separate agents, 1 shared backend
echo ============================================================
echo.
echo   Backend (shared)              -- port 8001
echo   Requirement Validation Agent  -- port 3001
echo   Test Case Generation Agent    -- port 3002
echo.
echo   Database: SQLite (built-in)
echo   LLM:      Ollama (local, open-source)
echo.

:: -- Check Python -----------------------------------------
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install from https://python.org
    pause & exit /b 1
)
echo [OK] Python found

:: -- Check Node ---------------------------------------------
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)
echo [OK] Node.js found

:: -- Check Ollama -------------------------------------------
ollama --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Ollama not found. Install from https://ollama.com/download
    pause & exit /b 1
)
echo [OK] Ollama found

echo.
echo ============================================================
echo   Step 1 -- Pull Ollama models
echo ============================================================
ollama list 2>nul | findstr /i "qwen3" >nul
if errorlevel 1 (
    echo Pulling qwen3:8b -- Agent 1 ^(~5.2 GB^)...
    ollama pull qwen3:8b
) else (
    echo [OK] qwen3:8b already available
)
ollama list 2>nul | findstr /i "deepseek-r1" >nul
if errorlevel 1 (
    echo Pulling deepseek-r1:8b -- Agent 2 ^(~5.2 GB^)...
    ollama pull deepseek-r1:8b
) else (
    echo [OK] deepseek-r1:8b already available
)
ollama list 2>nul | findstr /i "nomic-embed-text" >nul
if errorlevel 1 (
    echo Pulling nomic-embed-text -- embeddings ^(~274 MB^)...
    ollama pull nomic-embed-text
) else (
    echo [OK] nomic-embed-text already available
)

echo.
echo ============================================================
echo   Step 2 -- Backend (shared by both agents)
echo ============================================================
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...

    python -c "import sys; sys.exit(0 if 'WindowsApps' in sys.executable else 1)" >nul 2>&1
    if not errorlevel 1 (
        echo.
        echo [WARNING] You're using the Microsoft Store version of Python.
        echo            This frequently fails to create virtual environments
        echo            due to Store app sandboxing of ensurepip. If venv
        echo            creation fails below, install Python from
        echo            https://python.org instead ^(not the Store listing^).
        echo.
    )

    python -m venv .venv
    if errorlevel 1 (
        echo [SETUP] Standard venv creation failed -- trying workaround
        echo         ^(create without pip, then bootstrap pip manually^)...
        rmdir /s /q .venv >nul 2>&1
        python -m venv .venv --without-pip
        if errorlevel 1 (
            echo.
            echo [ERROR] Could not create a virtual environment. Please
            echo         install Python from https://python.org ^(not the
            echo         Microsoft Store^), check "Add Python to PATH", and
            echo         re-run this script.
            echo.
            pause & exit /b 1
        )
        call :bootstrap_pip
        if errorlevel 1 (
            pause & exit /b 1
        )
    )
)

:: Verify pip is actually present, regardless of how the venv was created.
.venv\Scripts\python.exe -m pip --version >nul 2>&1
if errorlevel 1 (
    echo [SETUP] pip is missing from this virtual environment -- bootstrapping...
    call :bootstrap_pip
    if errorlevel 1 (
        pause & exit /b 1
    )
)

:: Detect a contaminated (non-isolated) venv before installing -- if it can
:: see system-wide packages, pip will report conflicts with unrelated tools
:: this project never uses (langchain, llama-index, etc).
findstr /C:"include-system-site-packages = true" .venv\pyvenv.cfg >nul 2>&1
if not errorlevel 1 (
    echo [SETUP] Detected a non-isolated virtual environment. Rebuilding...
    rmdir /s /q .venv
    python -m venv .venv
    if errorlevel 1 (
        python -m venv .venv --without-pip
        call :bootstrap_pip
    )
)

:: Use the venv's own interpreter explicitly -- avoids any PATH-resolution
:: ambiguity that could route python/pip calls to a different (e.g. global
:: Windows Store) Python installation instead of this project's venv.
echo Installing Python packages...
.venv\Scripts\python.exe -m pip install --isolated -r requirements.txt -q --no-warn-script-location
if errorlevel 1 (
    echo.
    echo [ERROR] pip install failed.
    echo.
    echo If the error above mentions "rustup", "maturin", "Rust toolchain",
    echo or "pydantic-core", this is a known Python 3.13 wheel-availability
    echo issue. Re-run setup.bat once more ^(pip sometimes succeeds on retry
    echo after the failed attempt clears its cache^), or check your internet
    echo connection if it mentions a PyPI timeout ^(corporate proxy/firewall
    echo blocking pypi.org is common on AVD-style machines^).
    echo.
    pause & exit /b 1
)
.venv\Scripts\python.exe -c "import fastapi, uvicorn, pydantic_settings, sqlalchemy, numpy" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] pip reported success but core packages still fail to import.
    echo         Try: fix_backend_deps.bat
    echo.
    pause & exit /b 1
)
echo [OK] Backend packages installed and verified

if not exist ".env" (
    copy .env.example .env >nul
    echo [OK] Created backend\.env
)

echo.
echo ============================================================
echo   Step 3 -- Requirement Validation Agent (port 3001)
echo ============================================================
cd /d "%~dp0requirement-agent"
echo Installing npm packages...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed for requirement-agent
    pause & exit /b 1
)
if not exist ".env.local" (
    echo NEXT_PUBLIC_API_URL=http://localhost:8001> .env.local
)
echo [OK] Requirement Validation Agent ready

echo.
echo ============================================================
echo   Step 4 -- Test Case Generation Agent (port 3002)
echo ============================================================
cd /d "%~dp0testcase-agent"
echo Installing npm packages...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed for testcase-agent
    pause & exit /b 1
)
if not exist ".env.local" (
    echo NEXT_PUBLIC_API_URL=http://localhost:8001> .env.local
)
echo [OK] Test Case Generation Agent ready

echo.
echo ============================================================
echo   Setup complete!
echo ============================================================
echo.
echo   Run start_all.bat to launch both agents + backend
echo.
pause
exit /b 0

:: ============================================================
:: Subroutine: bootstrap_pip -- see run_backend.bat for full
:: explanation. Installs pip into backend\.venv when it was
:: created without it (--without-pip workaround path).
:: ============================================================
:bootstrap_pip
echo [SETUP] Bootstrapping pip into the venv...

.venv\Scripts\python.exe -m ensurepip --default-pip >nul 2>&1
.venv\Scripts\python.exe -m pip --version >nul 2>&1
if not errorlevel 1 (
    echo [OK] pip bootstrapped via ensurepip ^(no internet needed^).
    exit /b 0
)

echo [SETUP] ensurepip unavailable -- trying to download get-pip.py...
del get-pip.py >nul 2>&1
curl -s --connect-timeout 10 -o get-pip.py https://bootstrap.pypa.io/get-pip.py >nul 2>&1

if not exist "get-pip.py" (
    call :bootstrap_pip_failed
    exit /b 1
)

for %%F in (get-pip.py) do set GETPIP_SIZE=%%~zF
if !GETPIP_SIZE! LSS 1000 (
    del get-pip.py >nul 2>&1
    call :bootstrap_pip_failed
    exit /b 1
)

.venv\Scripts\python.exe get-pip.py --quiet
del get-pip.py >nul 2>&1
.venv\Scripts\python.exe -m pip --version >nul 2>&1
if errorlevel 1 (
    call :bootstrap_pip_failed
    exit /b 1
)

echo [OK] pip bootstrapped via get-pip.py download.
exit /b 0

:bootstrap_pip_failed
echo.
echo [ERROR] Could not bootstrap pip into the virtual environment.
echo         This usually means either:
echo           1^) Your network blocks bootstrap.pypa.io ^(common on
echo              corporate VPN/proxy setups like TCS AVD^), or
echo           2^) This Python build is missing the ensurepip module.
echo.
echo         FIX: Install the official Python from
echo         https://python.org/downloads ^(NOT the Microsoft Store
echo         listing^) which includes a working pip out of the box,
echo         check "Add Python to PATH" during install, delete the
echo         backend\.venv folder, restart this terminal, and
echo         re-run this script.
echo.
echo         If you're on a corporate network and python.org is also
echo         blocked, ask your IT team for an offline pip wheel or a
echo         proxy exception for bootstrap.pypa.io and pypi.org.
echo.
exit /b 1
