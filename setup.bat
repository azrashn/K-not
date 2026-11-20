@echo off
rem K-not tek komutla kurulum (Windows). Kullanim:  setup.bat [--start]
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo HATA: Node.js bulunamadi. https://nodejs.org adresinden LTS kurup tekrar dene.
  exit /b 1
)
node scripts\setup.mjs %*
exit /b %errorlevel%
