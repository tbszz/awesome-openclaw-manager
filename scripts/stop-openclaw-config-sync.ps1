$ErrorActionPreference = "Stop"

$targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -in @("powershell.exe", "pwsh.exe") -and
  $_.CommandLine -like "*sync-openclaw-to-wsl.ps1*" -and
  $_.CommandLine -like "*-Watch*"
}

if (-not $targets) {
  Write-Host "OpenClaw sync bridge is not running."
  return
}

$targets | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}

Write-Host "Stopped OpenClaw sync bridge."
