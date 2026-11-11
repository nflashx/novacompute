@echo off
cd /d "%~dp0"
start /min "NovaBackend" cmd /c "python backend\app.py"
start /min "NovaFrontend" cmd /c "python -m http.server 8123 --directory novacompute"
timeout /t 3 /nobreak >nul
start http://127.0.0.1:8123/index.html
