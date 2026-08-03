@echo off
cd /d "%~dp0.."
set PORT=3311

echo Iniciando API principal em http://localhost:%PORT%

REM Mata qualquer processo usando a porta
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo Encerrando processo PID %%a que estava usando porta %PORT%
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

npm run dev -w apps/api
