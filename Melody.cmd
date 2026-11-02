@echo off
rem Melody 拾音 启动器
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
