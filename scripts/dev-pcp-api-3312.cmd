@echo off
cd /d "%~dp0.."
set PORT=3312

echo Iniciando PCP-API em http://localhost:%PORT%

REM Mata qualquer processo usando a porta
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo Encerrando processo PID %%a que estava usando porta %PORT%
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

npm run dev -w apps/pcp-api
