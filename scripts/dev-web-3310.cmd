@echo off
cd /d "%~dp0.."
set PORT=3310
set NEXT_PUBLIC_API_URL=http://localhost:3311
set NEXT_PUBLIC_PCP_API_URL=http://localhost:3312
npm run dev -w apps/web >> dev-logs\web-3310.log 2>&1
