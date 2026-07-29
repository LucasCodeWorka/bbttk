@echo off
cd /d "%~dp0.."
set PORT=3312
set DOTENV_CONFIG_PATH=../api/.env
npm run dev -w apps/pcp-api >> dev-logs\pcp-api-3312.log 2>&1
