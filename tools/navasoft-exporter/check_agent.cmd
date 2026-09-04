@echo off
REM Mira si el agente esta vivo y muestra el log.
setlocal
cd /d "%~dp0"
echo ==== Task ====
schtasks /Query /TN "NavasoftBocasionAgent" /FO LIST 2>nul | findstr /I "Status TaskName Last"
echo.
echo ==== Procesos python ====
tasklist /FI "IMAGENAME eq python.exe" 2>nul | findstr /I python
tasklist /FI "IMAGENAME eq pythonw.exe" 2>nul | findstr /I python
echo.
echo ==== agent.log (tail) ====
if exist agent.log (
  powershell -NoProfile -Command "Get-Content -Path 'agent.log' -Tail 20"
) else (
  echo No existe agent.log — el agente nunca llego a escribir.
)
echo.
pause
