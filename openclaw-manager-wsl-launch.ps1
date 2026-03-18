$bridgeScript = Join-Path $env:APPDATA "npm\\openclaw-wsl-bridge.js"
$managerExe = "D:\\OpenClaw Manager\\openclaw-manager.exe"
$distro = "Ubuntu"
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$manifestPath = "\\wsl.localhost\$distro\root\.openclaw-manager\gateways.json"

$services = @(
  "openclaw-gateway.service",
  "openclaw-gateway-lxgnews.service",
  "openclaw-gateway-doctor.service"
)
$portValues = @("18789", "18790", "18791", "18802")

if (Test-Path $manifestPath) {
  try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.gateways) {
      $services = @(
        $manifest.gateways |
          ForEach-Object { $_.serviceName } |
          Where-Object { $_ } |
          Select-Object -Unique
      )
      $portValues = @("18789") + @(
        $manifest.gateways |
          ForEach-Object { [string]$_.port } |
          Where-Object { $_ }
      )
    }
  }
  catch {
    Write-Warning "Failed to parse managed gateway manifest. Falling back to built-in defaults."
  }
}

$ports = (
  $portValues |
    Sort-Object { [int]$_ } |
    Select-Object -Unique
) -join ","

foreach ($service in $services) {
  & wsl.exe -d $distro -- systemctl --user start $service *> $null
}

$bridge = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*openclaw-wsl-bridge.js*"
}

if (-not $bridge) {
  $previousDistro = [Environment]::GetEnvironmentVariable("OPENCLAW_WSL_DISTRO", "Process")
  $previousPorts = [Environment]::GetEnvironmentVariable("OPENCLAW_WSL_PORTS", "Process")

  try {
    [Environment]::SetEnvironmentVariable("OPENCLAW_WSL_DISTRO", $distro, "Process")
    [Environment]::SetEnvironmentVariable("OPENCLAW_WSL_PORTS", $ports, "Process")
    Start-Process -FilePath $nodeExe -ArgumentList $bridgeScript -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }
  finally {
    [Environment]::SetEnvironmentVariable("OPENCLAW_WSL_DISTRO", $previousDistro, "Process")
    [Environment]::SetEnvironmentVariable("OPENCLAW_WSL_PORTS", $previousPorts, "Process")
  }
}

Start-Process -FilePath $managerExe -WorkingDirectory (Split-Path $managerExe)
