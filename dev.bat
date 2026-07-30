@echo off
REM Start license, API, and web for local development (3 windows)
start "ledger-license" cmd /k "cd /d %~dp0 && npm run dev -w @ledger/license"
timeout /t 2 /nobreak >nul
start "ledger-api" cmd /k "cd /d %~dp0 && npm run dev -w @ledger/api"
timeout /t 2 /nobreak >nul
start "ledger-web" cmd /k "cd /d %~dp0 && npm run dev -w @ledger/web"
echo Started license :4100, api :4000, web :5173
