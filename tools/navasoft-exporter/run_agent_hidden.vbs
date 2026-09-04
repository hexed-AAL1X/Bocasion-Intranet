' Run Navasoft agent hidden (no console window).
' Used by Task Scheduler.
Option Explicit
Dim sh, dir, cmd
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
cmd = "cmd /c ""py -3 agente_navasoft.py >> agent.log 2>&1"""
sh.Run cmd, 0, False
