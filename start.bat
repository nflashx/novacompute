@echo off
title NovaCompute - API gateway (:8080) + frontend (:8123)
cd /d "%~dp0"

echo Starting backend  ... http://127.0.0.1:8080
start /b python backend\app.py

echo Starting frontend ... http://127.0.0.1:8123
start /b python -m http.server 8123 --directory novacompute

timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8123/index.html

echo.
echo Both servers are running inside this window (start /b). Press Ctrl+C to stop them.
echo Backend  : http://127.0.0.1:8080/api/health
echo Frontend : http://127.0.0.1:8123/index.html
echo.
