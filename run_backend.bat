@echo off
setlocal EnableDelayedExpansion
title SmartQA -- Backend (shared) :8001

echo.
echo ============================================================
echo   SmartQA Backend (shared by both agents)
echo   Port: 8001
echo ============================================================
echo.

:: -- Start Ollama if not already running --------------------
curl -s http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo Starting Ollama...
    start "Ollama LLM Server" cmd /k "ollama serve"
    timeout /t 5 /nobreak >nul
) else (
    echo [OK] Ollama already running
)

cd /d "%~dp0backend"

:: -- Self-heal: create venv if missing ------------------------
:: NOTE: from here on, we deliberately avoid `call activate.bat` + bare
:: `python`/`pip` commands and call ".venv\Scripts\python.exe" directly
:: throughout. This removes any PATH-resolution ambiguity that could
:: otherwise route commands to an unrelated global Python install.
if not exist ".venv\Scripts\python.exe" (
    echo [SETUP] No virtual environment found -- creating one now...
    python --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python not found. Install Python 3.11+ from https://python.org
        echo         and make sure "Add Python to PATH" was checked during install.
        pause & exit /b 1
    )

    :: Detect Windows Store Python -- its bundled ensurepip is sandboxed and
    :: frequently fails with "Command ... ensurepip ... returned non-zero
    :: exit status 1" when creating a venv.
    python -c "import sys; sys.exit(0 if 'WindowsApps' in sys.executable else 1)" >nul 2>&1
    if not errorlevel 1 (
        echo.
        echo [WARNING] You're using the Microsoft Store version of Python.
        echo            This version frequently fails to create virtual
        echo            environments due to Store app sandboxing.
        echo.
        echo            RECOMMENDED FIX: Install the official Python from
        echo            https://python.org/downloads ^(NOT the Microsoft
        echo            Store listing^), check "Add Python to PATH" during
        echo            install, restart this terminal, and re-run this script.
        echo.
        echo            Attempting a workaround for now...
        echo.
    )

    python -m venv .venv
    if errorlevel 1 (
        echo.
        echo [SETUP] Standard venv creation failed -- trying a workaround:
        echo         creating the venv without pip, then bootstrapping
        echo         pip manually...
        echo.
        rmdir /s /q .venv >nul 2>&1
        python -m venv .venv --without-pip
        if errorlevel 1 (
            echo.
            echo [ERROR] Could not create a virtual environment at all.
            echo         Please install Python from https://python.org
            echo         ^(not the Microsoft Store^), check "Add Python to
            echo         PATH", restart this terminal, and try again.
            echo.
            pause & exit /b 1
        )
        call :bootstrap_pip
        if errorlevel 1 (
            pause & exit /b 1
        )
    )
)

:: -- Self-heal: pip itself might be missing even if python.exe exists -
:: (e.g. a previous run created the venv with --without-pip and the
:: bootstrap step was interrupted, or failed silently). Check explicitly
:: before doing anything else, and bootstrap it now if needed.
.venv\Scripts\python.exe -m pip --version >nul 2>&1
if errorlevel 1 (
    echo [SETUP] pip is missing from this virtual environment -- bootstrapping...
    call :bootstrap_pip
    if errorlevel 1 (
        pause & exit /b 1
    )
)

:: -- Self-heal: verify the venv is actually ISOLATED ----------
:: If a previous run left a contaminated venv (pyvenv.cfg has
:: include-system-site-packages = true), pip install will "succeed" while
:: resolving against packages never declared in requirements.txt -- e.g.
:: langchain-community, llama-index-* showing up in conflict warnings.
findstr /C:"include-system-site-packages = true" .venv\pyvenv.cfg >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [SETUP] Detected a non-isolated virtual environment. Rebuilding...
    echo.
    rmdir /s /q .venv
    python -m venv .venv
    if errorlevel 1 (
        python -m venv .venv --without-pip
        call :bootstrap_pip
    )
)

:: -- Self-heal: verify core packages are actually IMPORTABLE --
:: (not just that the `uvicorn` command exists on PATH -- a partial/failed
:: pip install can leave the launcher script in place while the actual
:: packages are missing, causing "ModuleNotFoundError" at runtime.)
.venv\Scripts\python.exe -c "import fastapi, uvicorn, pydantic_settings, sqlalchemy, numpy" >nul 2>&1
if errorlevel 1 (
    echo [SETUP] Backend dependencies missing or incomplete -- installing now,
    echo         this happens once and takes 1-3 minutes...
    .venv\Scripts\python.exe -m pip install --isolated -r requirements.txt -q --no-warn-script-location
    if errorlevel 1 (
        echo.
        echo [ERROR] pip install failed.
        echo.
        echo If the error above mentions "rustup", "maturin", "Rust toolchain",
        echo or "pydantic-core", this is a known Python 3.13 wheel issue --
        echo it should already be fixed in this version's requirements.txt.
        echo Try: fix_backend_deps.bat  ^(from the smartqa2 root folder^)
        echo.
        echo If the error mentions "Meson", "Unknown compiler(s)", "vswhere.exe",
        echo or numpy trying to build from source, this version's
        echo requirements.txt should already avoid it -- numpy 2.x has
        echo prebuilt Windows wheels for Python 3.13. If you still see this,
        echo your requirements.txt may be out of date -- re-download the
        echo latest project zip and try again.
        echo.
        echo If the error mentions "hnswlib", "chroma-hnswlib", or
        echo "Microsoft Visual C++ 14.0 or greater is required", your
        echo requirements.txt is an OLD version that still depends on
        echo chromadb. The current version uses a pure-Python vector store
        echo with no compiled dependencies -- re-download the latest project
        echo zip, which removes chromadb entirely.
        echo.
        echo If the error mentions a connection/timeout, your network may be
        echo blocking pypi.org -- check with your IT team about proxy settings
        echo on this machine ^(common on corporate AVDs^).
        echo.
        pause & exit /b 1
    )
    .venv\Scripts\python.exe -c "import fastapi, uvicorn, pydantic_settings, sqlalchemy, numpy" >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [ERROR] Dependencies still missing after install. Try running:
        echo         fix_backend_deps.bat
        echo         from the smartqa2 root folder, then restart this script.
        echo.
        pause & exit /b 1
    )
    echo [OK] Dependencies installed and verified.
)

if not exist ".env" (
    copy .env.example .env >nul
    echo [OK] Created backend\.env
)

findstr /C:"OLLAMA_BASE_URL=http://localhost:11434" .env >nul 2>nul
if not errorlevel 1 (
    echo.
    echo [NOTE] Your backend\.env has OLLAMA_BASE_URL=http://localhost:11434
    echo        On Windows this can cause "Ollama not reachable" errors due
    echo        to an IPv6-first DNS quirk, even when Ollama is running fine.
    echo        Recommended: change that line to
    echo            OLLAMA_BASE_URL=http://127.0.0.1:11434
    echo        in backend\.env, then restart this script.
    echo.
)

echo.
echo Backend starting at http://localhost:8001
echo API docs:            http://localhost:8001/docs
echo.
echo Press Ctrl+C to stop.
echo.
echo If you see "TypeError: Can't replace canonical symbol for
echo '__firstlineno__'" or "the greenlet library is required" below,
echo your venv has stale dependencies -- run fix_backend_deps.bat and restart.
echo.
.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8001 --host 127.0.0.1
pause
exit /b 0

:: ============================================================
:: Subroutine: bootstrap_pip
:: Installs pip into .venv when the venv was created without it
:: (the --without-pip workaround path). Tries two methods in order:
::   1. ensurepip -- works fully offline, bundled in the Python stdlib.
::      This is the PREFERRED path and usually all that's needed.
::   2. get-pip.py download -- only attempted if ensurepip fails/is
::      unavailable. Network access is verified explicitly at each step
::      rather than trusting curl's exit code alone, because some Windows
::      curl builds report success (errorlevel 0) even when a download
::      was silently blocked by a corporate proxy/firewall -- which is
::      what previously caused "No module named pip" when get-pip.py ran
::      against an empty or missing file.
:: Returns errorlevel 0 on success, 1 on failure (caller should check
:: `if errorlevel 1` immediately after `call :bootstrap_pip`).
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
