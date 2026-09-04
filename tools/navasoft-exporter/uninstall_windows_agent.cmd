@echo off
REM Detiene y elimina la tarea automatica del agente Navasoft.
setlocal
set "TASK_NAME=NavasoftBocasionAgent"
schtasks /End /TN "%TASK_NAME%" >nul 2>nul
schtasks /Delete /TN "%TASK_NAME%" /F
echo Tarea eliminada: %TASK_NAME%
pause
