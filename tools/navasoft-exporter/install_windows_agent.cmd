@echo off
REM Instala el agente Navasoft en segundo plano (Task Scheduler).
REM Clic derecho -> Run as administrator

setlocal EnableExtensions
cd /d "%~dp0"
set "AGENT_DIR=%cd%"
set "TASK_NAME=NavasoftBocasionAgent"
set "VBS=%AGENT_DIR%\run_agent_hidden.vbs"

echo ============================================
echo  Instalando agente Navasoft (background)
echo ============================================
echo Carpeta: %AGENT_DIR%
echo.

if not exist "%AGENT_DIR%\agente_navasoft.py" (
  echo ERROR: falta agente_navasoft.py en esta carpeta.
  pause
  exit /b 1
)
if not exist "%AGENT_DIR%\export.env" (
  echo ERROR: falta export.env
  pause
  exit /b 1
)
if not exist "%VBS%" (
  echo ERROR: falta run_agent_hidden.vbs
  pause
  exit /b 1
)

where py >nul 2>nul
if errorlevel 1 (
  echo ERROR: no esta "py" en PATH. Reinstala Python con Add to PATH.
  pause
  exit /b 1
)

echo Probando Python...
py -3 -c "import requests,bs4,pandas; print('deps OK')"
if errorlevel 1 (
  echo Instalando dependencias...
  py -3 -m pip install -r "%AGENT_DIR%\requirements.txt"
)

echo Probando cola del dashboard...
py -3 -c "import urllib.request; r=urllib.request.urlopen('https://www.bocasion.com/out/api/navasoft.php?action=status&id=1', timeout=15); print('cola OK', r.status)"
if errorlevel 1 (
  echo ERROR: esta PC no llega a https://www.bocasion.com
  pause
  exit /b 1
)

REM Detener instancia previa
schtasks /End /TN "%TASK_NAME%" >nul 2>nul
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul
taskkill /F /IM python.exe /FI "WINDOWTITLE eq *agente*" >nul 2>nul

REM Crear tarea: al iniciar sesion, carpeta correcta, sin ventana
schtasks /Create /F /TN "%TASK_NAME%" /SC ONLOGON /RL LIMITED ^
  /TR "wscript.exe \"%VBS%\"" ^
  /IT

if errorlevel 1 (
  echo ERROR creando la tarea. Ejecuta como Administrador.
  pause
  exit /b 1
)

REM Arrancar ahora
schtasks /Run /TN "%TASK_NAME%"
timeout /t 3 /nobreak >nul

echo.
echo ---- ultimas lineas de agent.log ----
if exist "%AGENT_DIR%\agent.log" (
  powershell -NoProfile -Command "Get-Content -Path '%AGENT_DIR%\agent.log' -Tail 8"
) else (
  echo (aun no hay agent.log — la tarea puede haber fallado)
)

echo.
echo Si ves "escuchando cola" arriba, ya esta bien.
echo Deja este remoto encendido/con sesion iniciada.
echo.
echo Comandos utiles:
echo   schtasks /Query /TN %TASK_NAME% /V /FO LIST
echo   schtasks /Run  /TN %TASK_NAME%
echo   schtasks /End  /TN %TASK_NAME%
pause
