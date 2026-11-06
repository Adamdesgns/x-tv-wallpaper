# Starts the X TV feeder at every logon (a Task Scheduler task for this user only).
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1          install
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Remove  uninstall
param([switch]$Remove)

$name = 'X TV Feed'
if ($Remove) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Removed task '$name'."
    return
}

$vbs = Join-Path $PSScriptRoot 'feeder\start-hidden.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Keeps the X TV wallpaper feed fresh (Projects\apps\x-tv-wallpaper).' -Force | Out-Null
Write-Output "Installed task '$name' (runs at logon)."
