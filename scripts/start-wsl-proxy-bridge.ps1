$ErrorActionPreference = "Stop"

$scriptPath = Join-Path (Split-Path $PSScriptRoot -Parent) "scripts\windows-proxy-bridge.mjs"
$listenPort = 11080

$existing = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty OwningProcess

if ($existing) {
  $process = Get-Process -Id $existing -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -like "node*") {
    Write-Output "WSL proxy bridge already listening on port $listenPort (PID $existing)."
    exit 0
  }
}

Start-Process -FilePath "node" -ArgumentList $scriptPath -WindowStyle Hidden
Start-Sleep -Seconds 1

$ready = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if (-not $ready) {
  throw "WSL proxy bridge did not start on port $listenPort."
}

Write-Output "WSL proxy bridge is listening on port $listenPort."
