@echo off
chcp 65001 >nul
title Forge Neo - обновление
cd /d "%~dp0"

call "%~dp0environment.bat"

echo Обновление сборки из GitHub...
git pull
if errorlevel 1 (
    echo.
    echo [ОШИБКА] git pull не удался. Проверьте интернет и локальные изменения: git status
    pause
    exit /b 1
)

:: Докачать модели, если в манифесте появились новые
call "%~dp0download-models.bat"
