@echo off
cd /d "%USERPROFILE%\NovaLocalAPI"
start "" "%USERPROFILE%\miniconda3\pythonw.exe" "%USERPROFILE%\NovaLocalAPI\proxy_supervisor.py"
