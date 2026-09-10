@echo off
chcp 65001 >nul
title Forge Neo - установка
cd /d "%~dp0"

:: 1. Портативное окружение (system) из GitHub Releases
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\install.ps1" %*
if errorlevel 1 (
    echo.
    echo [ОШИБКА] Не удалось установить папку system.
    pause
    exit /b 1
)

:: 2. Модели
call "%~dp0download-models.bat"
