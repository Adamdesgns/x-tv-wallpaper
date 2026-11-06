' Starts the X TV feeder with no console window (Task Scheduler runs this at logon).
' The feeder itself opens one Edge window and keeps it minimized.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = here
sh.Run "node """ & here & "\feeder.mjs""", 0, False
