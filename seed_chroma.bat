@echo off
echo ============================================================
echo   Seeding ChromaDB with sample test cases ^& knowledge docs
echo ============================================================
echo.
cd /d "%~dp0backend"
call venv\Scripts\activate.bat
python scripts\seed_chroma.py
echo.
echo Done. Press any key to close.
pause >nul
