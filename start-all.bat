@echo off
setlocal

cd /d "%~dp0"

if not exist "dev-logs" mkdir "dev-logs"

echo ====================================
echo Iniciando Bebetenkite Dashboard
echo ====================================
echo.

REM Verifica se node_modules existe na raiz do monorepo
if not exist "node_modules" (
    echo [AVISO] node_modules nao encontrado. Executando npm install...
    call npm install
    echo.
)

echo [1/3] Iniciando API principal (porta 3311)...
start "API - Porta 3311" cmd /k "scripts\dev-api-3311.cmd"
timeout /t 3 /nobreak >nul

echo [2/3] Iniciando PCP-API (porta 3312)...
start "PCP-API - Porta 3312" cmd /k "scripts\dev-pcp-api-3312.cmd"
timeout /t 3 /nobreak >nul

echo [3/3] Iniciando Frontend (porta 3310)...
start "Frontend - Porta 3310" cmd /k "scripts\dev-web-3310.cmd"

echo.
echo ====================================
echo Todos os servicos foram iniciados!
echo ====================================
echo.
echo API Principal: http://localhost:3311
echo PCP-API:       http://localhost:3312
echo Frontend:      http://localhost:3310
echo.
echo Acompanhe os logs nas janelas abertas de cada servico.
echo Se algum servico nao abrir, copie o erro exibido na janela correspondente.
echo Pressione qualquer tecla para fechar esta janela...
echo (Os servicos continuarao rodando em suas proprias janelas)
pause >nul
