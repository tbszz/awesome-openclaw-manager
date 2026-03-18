param(
  [string]$Distro = "Ubuntu",
  [switch]$RestartService = $true
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "sync-openclaw-to-wsl.ps1"

$existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -in @("powershell.exe", "pwsh.exe") -and
  $_.CommandLine -like "*sync-openclaw-to-wsl.ps1*" -and
  $_.CommandLine -like "*-Watch*"
}

if ($existing) {
  Write-Host "OpenClaw sync bridge is already running."
  return
}

$args = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "`"$scriptPath`"",
  "-Watch",
  "-Distro",
  "`"$Distro`""
)

if ($RestartService) {
  $args += "-RestartService"
}

Start-Process -FilePath "powershell.exe" -ArgumentList $args -WindowStyle Hidden
Write-Host "Started OpenClaw sync bridge in the background."
