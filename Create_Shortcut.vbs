' Creates a Desktop shortcut that silently starts NovaCompute.
' Double-click once; afterwards use the "NovaCompute" icon on the Desktop.
Option Explicit

Dim shell, fso, root, desktopPath, linkPath, link
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
desktopPath = shell.SpecialFolders("Desktop")
linkPath = desktopPath & "\NovaCompute.lnk"

Set link = shell.CreateShortcut(linkPath)
link.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
link.Arguments = """" & root & "\silent_start.vbs"""
link.WorkingDirectory = root
link.WindowStyle = 1
link.Description = "Start NovaCompute (API gateway + web UI) silently"
link.IconLocation = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\SHELL32.dll,13"
link.Save

WScript.Echo "Shortcut created:" & vbCrLf & linkPath

Set link = Nothing
Set shell = Nothing
Set fso = Nothing
