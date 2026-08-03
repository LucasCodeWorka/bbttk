@echo off
cd /d "%~dp0.."
set PORT=3310
set NEXT_PUBLIC_API_URL=http://localhost:3311
set NEXT_PUBLIC_PCP_API_URL=http://localhost:3312

echo Iniciando Frontend em http://localhost:%PORT%
echo API principal: %NEXT_PUBLIC_API_URL%
echo PCP-API: %NEXT_PUBLIC_PCP_API_URL%

REM Mata qualquer processo usando a porta 3310
echo Verificando se porta %PORT% esta em uso...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo Encerrando processo PID %%a que estava usando porta %PORT%
    taskkill /F /PID %%a >nul 2>&1
)

REM Remove lock antigo do Next.js se existir
if exist "apps\web\.next\dev\lock" (
    echo Removendo lock antigo do Next.js...
    del /f /q "apps\web\.next\dev\lock" >nul 2>&1
)

timeout /t 1 /nobreak >nul
npm run dev -w apps/web
