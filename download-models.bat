@echo off
chcp 65001 >nul
title Forge Neo - скачивание моделей
cd /d "%~dp0"

if not exist "system\python\python.exe" (
    echo Не найдена папка system. Сначала запустите install.bat
    pause
    exit /b 1
)

"system\python\python.exe" "setup\download_models.py" %*
pause
