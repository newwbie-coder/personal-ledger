@echo off
REM Local development: embedded Postgres, API and web in separate windows.
REM .env needs DATABASE_URL, CORS_ORIGIN and VITE_API_URL (see .env.example).
start "ledger-db" cmd /k "cd /d %~dp0 && npm run demo:pg -w @ledger/api"
timeout /t 6 /nobreak >nul
start "ledger-api" cmd /k "cd /d %~dp0 && npm run dev -w @ledger/api"
timeout /t 2 /nobreak >nul
start "ledger-web" cmd /k "cd /d %~dp0 && npm run dev -w @ledger/web"
echo Started postgres :54329, api :4000, web :5173
