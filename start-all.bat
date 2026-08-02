@echo off
echo ====================================
echo Iniciando Bebetenkite Dashboard
echo ====================================
echo.

REM Verifica se node_modules existe
if not exist "node_modules" (
    echo [AVISO] node_modules nao encontrado. Executando npm install...
    call npm install
    echo.
)

echo [1/3] Iniciando API principal (porta 3001)...
start "API - Porta 3001" cmd /k "cd apps\api && npm run dev"
timeout /t 3 /nobreak >nul

echo [2/3] Iniciando PCP-API (porta 3002)...
start "PCP-API - Porta 3002" cmd /k "cd apps\pcp-api && npm run dev"
timeout /t 3 /nobreak >nul

echo [3/3] Iniciando Frontend (porta 3000)...
start "Frontend - Porta 3000" cmd /k "cd apps\web && npm run dev"

echo.
echo ====================================
echo Todos os servicos foram iniciados!
echo ====================================
echo.
echo API Principal: http://localhost:3001
echo PCP-API:       http://localhost:3002
echo Frontend:      http://localhost:3000
echo.
echo Pressione qualquer tecla para fechar esta janela...
echo (Os servicos continuarao rodando em suas proprias janelas)
pause >nul
