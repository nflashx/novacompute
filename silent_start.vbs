' NovaCompute - silent launcher (1-click, no console windows)
' Starts the backend (:8080) and the frontend (:8123) with hidden
' windows, then opens the site in the default browser after 3 s.
' Launch it from the Desktop shortcut created by Create_Shortcut.vbs.
Option Explicit

Dim shell, fso, root, siteUrl
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root

' Window style 0 = hidden. bWaitOnReturn = False, so both servers
' keep running after this script exits and no CMD window is shown.
shell.Run "python backend\app.py", 0, False
shell.Run "python -m http.server 8123 --directory novacompute", 0, False

WScript.Sleep 3000

siteUrl = "http://127.0.0.1:8123/index.html"
shell.Run siteUrl, 1, False

Set shell = Nothing
Set fso = Nothing
