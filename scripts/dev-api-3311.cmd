@echo off
cd /d "%~dp0.."
set PORT=3311
npm run dev -w apps/api >> dev-logs\api-3311.log 2>&1
