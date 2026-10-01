@echo off
rem Збереження секретів сервера: запустити подвійним кліком
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-secrets.ps1"
