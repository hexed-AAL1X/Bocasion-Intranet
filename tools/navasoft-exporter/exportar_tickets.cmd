@echo off
REM Sincroniza tickets Navasoft -> JSON para el dashboard (Windows).
setlocal EnableExtensions
cd /d "%~dp0"

if exist "export.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("export.env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if "%NAV_USUARIO%"=="" goto missing
if "%NAV_CONTRASENA%"=="" goto missing

if "%NAV_BASE_URL%"=="" set "NAV_BASE_URL=http://38.210.1.85:85"
if "%NAV_ESTADO%"=="" set "NAV_ESTADO=todos"
if "%NAV_DESDE%"=="" set "NAV_DESDE=01/01/2010"
if "%NAV_HASTA%"=="" (
  for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format dd/MM/yyyy"') do set "NAV_HASTA=%%I"
)

if "%NAV_OUT_DIR%"=="" set "NAV_OUT_DIR=%~dp0exports"
if not exist "%NAV_OUT_DIR%" mkdir "%NAV_OUT_DIR%"
if "%NAV_SALIDA%"=="" set "NAV_SALIDA=%NAV_OUT_DIR%\tickets_navasoft.json"

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>nul
  if %ERRORLEVEL%==0 (
    set "PY=python"
  ) else (
    echo No hay Python 3 instalado.
    exit /b 1
  )
)

echo ==============================================
echo   Sincronizador Navasoft -^> Dashboard
echo ==============================================
echo.
echo   Usuario : %NAV_USUARIO%
echo   Estado  : %NAV_ESTADO%
echo   Desde   : %NAV_DESDE%
echo   Hasta   : %NAV_HASTA%
echo   Destino : Tickets del dashboard
echo.

%PY% ticket_exporter.py --usuario "%NAV_USUARIO%" --contrasena "%NAV_CONTRASENA%" --base-url "%NAV_BASE_URL%" --estado "%NAV_ESTADO%" --desde "%NAV_DESDE%" --hasta "%NAV_HASTA%" --salida "%NAV_SALIDA%" --modo-batch
set ERR=%ERRORLEVEL%
echo.
if %ERR%==0 (
  echo Datos listos para actualizar Tickets
) else (
  echo La sincronizacion fallo con codigo %ERR%
)
exit /b %ERR%

:missing
echo Faltan NAV_USUARIO o NAV_CONTRASENA en export.env.
exit /b 1
