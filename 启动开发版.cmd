@echo off
setlocal
title Personal Workstation - Dev Launcher

cd /d "%~dp0"

if not exist package.json (
  echo ERROR: package.json was not found.
  echo Put this launcher in the personal-workstation project folder.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: npm was not found.
  echo Install Node.js, then run this launcher again.
  echo Or start: src-tauri\target\release\personal-workstation.exe
  echo.
  pause
  exit /b 1
)

echo.
tasklist /FI "IMAGENAME eq personal-workstation.exe" | find /I "personal-workstation.exe" >nul
if not errorlevel 1 (
  echo Personal Workstation is already running.
  echo Close the existing app window before starting another development instance.
  pause
  exit /b 0
)

powershell -NoProfile -Command "try { $result = Invoke-WebRequest -UseBasicParsing -Uri http://localhost:1420 -TimeoutSec 2; if ($result.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  echo An existing development web server was found.
  echo Starting the Tauri application with that server...
  cargo run --manifest-path src-tauri\Cargo.toml --no-default-features --
) else (
  echo Starting Personal Workstation development version...
  echo Keep this window open while the app is running.
  echo.
  call npm run tauri:dev
)

echo.
echo The development process exited with code: %errorlevel%
pause
