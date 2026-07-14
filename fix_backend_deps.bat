@echo off
setlocal EnableDelayedExpansion
echo.
echo ============================================================
echo   SmartQA -- Fix backend dependency install errors
echo ============================================================
echo.
echo   This re-syncs your existing .venv against the latest
echo   requirements.txt, which fixes:
echo     - "test case generation failed" (stale/corrupted vector store data)
echo     - pydantic-core build errors on Python 3.13 (needs Rust)
echo     - "__firstlineno__" crash on startup (old sqlalchemy on Python 3.13)
echo     - "the greenlet library is required" crash (missing greenlet on Python 3.13)
echo     - pandas Python 3.13 wheel unavailability
echo     - langchain/llama-index dependency conflicts (non-isolated venv)
echo     - "No module named pip" (incomplete venv bootstrap)
echo.

cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] No .venv found. Run setup.bat first.
    pause & exit /b 1
)

:: Verify pip itself is present before anything else.
.venv\Scripts\python.exe -m pip --version >nul 2>&1
if errorlevel 1 (
    echo [SETUP] pip is missing from this virtual environment -- bootstrapping...
    call :bootstrap_pip
    if errorlevel 1 (
        pause & exit /b 1
    )
)

:: Detect a contaminated (non-isolated) venv -- if it can see system-wide
:: packages, pip will report conflicts with tools this project never uses
:: (langchain, llama-index, etc). Rebuild clean rather than limping along.
findstr /C:"include-system-site-packages = true" .venv\pyvenv.cfg >nul 2>&1
if not errorlevel 1 (
    echo [SETUP] Detected a non-isolated virtual environment. Rebuilding...
    rmdir /s /q .venv
    python -m venv .venv
    if errorlevel 1 (
        python -m venv .venv --without-pip
        call :bootstrap_pip
        if errorlevel 1 (
            pause & exit /b 1
        )
    )
)

echo Re-installing backend dependencies from requirements.txt...
.venv\Scripts\python.exe -m pip install --isolated -r requirements.txt -q --no-warn-script-location
if errorlevel 1 (
    echo.
    echo [ERROR] Install still failing. Most likely cause: an old pydantic
    echo         is cached, or the venv itself is corrupted. Try a full reset:
    echo.
    echo           rmdir /s /q .venv
    echo           cd ..
    echo           setup.bat
    echo.
    echo         If the error mentions a connection timeout, your network
    echo         may be blocking pypi.org -- check with IT about proxy
    echo         settings on this machine.
    echo.
    pause & exit /b 1
)

echo Verifying core packages are importable...
.venv\Scripts\python.exe -c "import fastapi, uvicorn, pydantic_settings, sqlalchemy, httpx, openai, numpy" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] pip reported success but a core package still fails to
    echo         import. This usually means a version conflict between
    echo         packages. Try the full reset:
    echo.
    echo           rmdir /s /q .venv
    echo           cd ..
    echo           setup.bat
    echo.
    pause & exit /b 1
)

echo.
echo [OK] Fix applied and verified. Restart the backend (run_backend.bat) to pick it up.
echo.
pause
exit /b 0

:: ============================================================
:: Subroutine: bootstrap_pip -- see run_backend.bat for full
:: explanation.
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
echo         listing^), check "Add Python to PATH" during install,
echo         delete the backend\.venv folder, restart this terminal,
echo         and re-run setup.bat.
echo.
exit /b 1
