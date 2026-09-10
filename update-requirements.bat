@echo off
setlocal

:: Переходим в папку webui
cd /d "%~dp0webui" 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Папка "webui" не найдена!
    pause
    exit /b
)

:: Запускаем установку через относительный путь к python
echo Installing requirements...
..\system\python\python -m pip install -r requirements.txt

echo.
echo Done!
pause