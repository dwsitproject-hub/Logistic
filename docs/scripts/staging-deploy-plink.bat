@echo off
REM KLIP staging deploy from Windows using PuTTY plink.exe
REM Edit PLINK, USER, and key paths before running.
REM Requires: PuTTY plink in PATH or set PLINK below.

setlocal EnableExtensions

set "PLINK=C:\Program Files\PuTTY\plink.exe"
set "USER=ubuntu"
set "KEY=C:\Users\%USERNAME%\.ssh\id_rsa.ppk"
set "BRANCH=SIT"

if not exist "%PLINK%" (
  echo ERROR: plink.exe not found at %PLINK%
  echo Install PuTTY or update PLINK path in this file.
  exit /b 1
)

set "REMOTE=cd /opt/klip && git fetch origin && git checkout %BRANCH% && git pull origin %BRANCH%"

echo.
echo === Backend 172.28.92.57 ===
"%PLINK%" -batch -i "%KEY%" %USER%@172.28.92.57 "%REMOTE% && docker compose -f docker-compose.backend.yml up -d --build && docker compose -f docker-compose.backend.yml ps"
if errorlevel 1 exit /b 1

echo.
echo === Frontend 172.28.92.56 ===
"%PLINK%" -batch -i "%KEY%" %USER%@172.28.92.56 "%REMOTE% && docker compose -f docker-compose.frontend.yml up -d --build && docker compose -f docker-compose.frontend.yml ps"
if errorlevel 1 exit /b 1

echo.
echo Done. Open http://8.215.6.189 in browser.
endlocal
