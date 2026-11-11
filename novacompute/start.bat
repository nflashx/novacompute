@echo off
title NovaCompute Dev Servers
cd /d "%~dp0"

echo ============================================================
echo  NovaCompute - starting backend (:8080) and frontend (:8123)
echo ============================================================

if not exist "%~dp0..\backend\app.py" (
  echo [ERROR] backend\app.py not found next to this folder.
  pause
  exit /b 1
)

echo Starting backend  ... http://127.0.0.1:8080
start "NovaCompute Backend (:8080)" cmd /k "cd /d "%~dp0..\backend" && python app.py"

timeout /t 2 /nobreak >nul

echo Starting frontend ... http://127.0.0.1:8123
start "NovaCompute Frontend (:8123)" cmd /k "cd /d "%~dp0" && python -m http.server 8123 --bind 127.0.0.1"

timeout /t 2 /nobreak >nul

start "" http://127.0.0.1:8123/index.html

echo.
echo Backend  : http://127.0.0.1:8080/api/health
echo Frontend : http://127.0.0.1:8123/index.html
echo Demo login: demo@novacompute.io / demo1234  (run python backend\seed_demo.py once)
echo.
