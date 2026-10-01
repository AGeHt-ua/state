@echo off
rem Локальний запуск Worker з локальною базою D1 (http://localhost:8787)
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
npx --yes wrangler@latest dev --port 8787 --test-scheduled
