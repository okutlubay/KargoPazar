@echo off
REM KargoPazar — local development launcher (Windows, frontend-only)
setlocal
set ROOT=%~dp0
cd /d %ROOT%frontend
call npm install
npm run dev
endlocal
