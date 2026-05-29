@echo off
REM Oyunu http://localhost:8000 uzerinden baslatir (WebHID icin gerekli)
REM ve cok oyunculu WebSocket sunucusunu ayri pencerede acar.
cd /d "%~dp0"

REM Cok oyunculu sunucu (ws bagimliligi kuruluysa)
if exist node_modules\ws (
  start "Cok Oyunculu Sunucu" cmd /k node server.js
) else (
  echo [bilgi] Cok oyunculu icin once: npm install
)

where python >nul 2>nul
if %errorlevel%==0 (
  python serve.py
) else (
  echo Python bulunamadi, Node ile deneniyor...
  start "" http://localhost:8000
  npx --yes serve -l 8000 .
)
pause
