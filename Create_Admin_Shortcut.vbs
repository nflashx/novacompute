' Creates a Desktop shortcut that launches the NovaCompute Admin Console
' with pythonw.exe (GUI only, no console window).
Option Explicit

Dim shell, fso, root, desktopPath, linkPath, link, py
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
desktopPath = shell.SpecialFolders("Desktop")
linkPath = desktopPath & "\NovaCompute Admin.lnk"

py = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Python\Python311\pythonw.exe"
If Not fso.FileExists(py) Then py = "pythonw.exe"

Set link = shell.CreateShortcut(linkPath)
link.TargetPath = py
link.Arguments = """" & root & "\admin_app.py"""
link.WorkingDirectory = root
link.WindowStyle = 1
link.Description = "NovaCompute Admin Console - API keys, models, hot reload"
link.IconLocation = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\SHELL32.dll,21"
link.Save

WScript.Echo "Shortcut created:" & vbCrLf & linkPath

Set link = Nothing
Set shell = Nothing
Set fso = Nothing
