param(
  [string]$ManagerExe = "D:\\OpenClaw Manager\\openclaw-manager.exe",
  [string]$WebView2Loader = "D:\\OpenClaw Manager\\WebView2Loader.dll",
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$packageJsonPath = Join-Path $repoRoot "openclaw-manager-src\\openclaw-manager-main\\package.json"
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$version = $packageJson.version

if (-not $OutputRoot) {
  $OutputRoot = Join-Path $repoRoot "release-artifacts"
}

function Assert-Path {
  param(
    [string]$Path,
    [string]$Message
  )

  if (-not (Test-Path $Path)) {
    throw $Message
  }
}

function Reset-Directory {
  param([string]$Path)

  if (Test-Path $Path) {
    Remove-Item -Recurse -Force $Path
  }

  New-Item -ItemType Directory -Path $Path | Out-Null
}

function Copy-IfExists {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (Test-Path $Source) {
    Copy-Item -Recurse -Force $Source $Destination
  }
}

Assert-Path -Path $ManagerExe -Message "Manager executable was not found at $ManagerExe"

$localName = "Awesome-OpenClaw-Manager-Windows-Local-v$version"
$wslName = "Awesome-OpenClaw-Manager-Windows-WSL2-v$version"

$localDir = Join-Path $OutputRoot $localName
$wslDir = Join-Path $OutputRoot $wslName
$localZip = Join-Path $OutputRoot "$localName.zip"
$wslZip = Join-Path $OutputRoot "$wslName.zip"

Reset-Directory -Path $OutputRoot
Reset-Directory -Path $localDir
Reset-Directory -Path $wslDir

Copy-Item -Force $ManagerExe (Join-Path $localDir "openclaw-manager.exe")
Copy-Item -Force $ManagerExe (Join-Path $wslDir "openclaw-manager.exe")
Copy-IfExists -Source $WebView2Loader -Destination (Join-Path $localDir "WebView2Loader.dll")
Copy-IfExists -Source $WebView2Loader -Destination (Join-Path $wslDir "WebView2Loader.dll")

Copy-Item -Force (Join-Path $repoRoot "docs\\releases\\windows-local.md") (Join-Path $localDir "README.md")
Copy-Item -Force (Join-Path $repoRoot "docs\\releases\\windows-wsl2.md") (Join-Path $wslDir "README.md")
Copy-Item -Force (Join-Path $repoRoot "docs\\screenshots\\manager-ui.png") (Join-Path $localDir "manager-ui.png")
Copy-Item -Force (Join-Path $repoRoot "docs\\screenshots\\manager-ui.png") (Join-Path $wslDir "manager-ui.png")

Copy-Item -Force (Join-Path $repoRoot "openclaw-manager-wsl-launch.ps1") (Join-Path $wslDir "openclaw-manager-wsl-launch.ps1")
Copy-Item -Recurse -Force (Join-Path $repoRoot "scripts") (Join-Path $wslDir "scripts")

if (Test-Path $localZip) {
  Remove-Item -Force $localZip
}

if (Test-Path $wslZip) {
  Remove-Item -Force $wslZip
}

Compress-Archive -Path (Join-Path $localDir "*") -DestinationPath $localZip -Force
Compress-Archive -Path (Join-Path $wslDir "*") -DestinationPath $wslZip -Force

$localHash = (Get-FileHash $localZip -Algorithm SHA256).Hash
$wslHash = (Get-FileHash $wslZip -Algorithm SHA256).Hash

@(
  "SHA256  $(Split-Path $localZip -Leaf)  $localHash",
  "SHA256  $(Split-Path $wslZip -Leaf)  $wslHash"
) | Set-Content -Path (Join-Path $OutputRoot "SHA256SUMS.txt")

Write-Host "Created release bundles:"
Write-Host " - $localZip"
Write-Host " - $wslZip"
