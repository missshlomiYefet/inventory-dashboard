@echo off
rem Starts a local web server for the dashboard and opens it in your browser.
rem Keep this window open while you use the dashboard. Close it to stop the server.
cd /d "%~dp0"
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"
npx --yes serve . -l 3000 --no-clipboard
