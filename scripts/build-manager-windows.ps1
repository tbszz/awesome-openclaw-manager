param(
  [string]$SourceRoot = "",
  [string]$BuildRoot = "$env:USERPROFILE\Desktop\openclaw-manager-build",
  [string]$OutputExe = "D:\OpenClaw Manager\openclaw-manager.exe",
  [string]$WinLibsRoot = "$env:USERPROFILE\tools\winlibs\mingw64",
  [string]$RustToolchain = "stable-x86_64-pc-windows-gnu"
)

$ErrorActionPreference = "Stop"

if (-not $SourceRoot) {
  $SourceRoot = Join-Path (Split-Path $PSScriptRoot -Parent) "openclaw-manager-src\openclaw-manager-main"
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

Assert-Path -Path (Join-Path $SourceRoot "package.json") -Message "Manager source was not found at $SourceRoot"
Assert-Path -Path (Join-Path $WinLibsRoot "bin\\gcc.exe") -Message "WinLibs toolchain was not found at $WinLibsRoot"
Assert-Path -Path "$env:USERPROFILE\.cargo\bin\rustup.exe" -Message "rustup.exe was not found under $env:USERPROFILE\.cargo\bin"

if (Test-Path $BuildRoot) {
  Remove-Item -Recurse -Force $BuildRoot
}

Copy-Item -Recurse -Force $SourceRoot $BuildRoot

$buildNodeModules = Join-Path $BuildRoot "node_modules"
$buildTarget = Join-Path $BuildRoot "src-tauri\target"

if (Test-Path $buildNodeModules) {
  Remove-Item -Recurse -Force $buildNodeModules
}

if (Test-Path $buildTarget) {
  Remove-Item -Recurse -Force $buildTarget
}

$env:PATH = (Join-Path $WinLibsRoot "bin") + ";$env:USERPROFILE\.cargo\bin;" + $env:PATH
$env:RUSTUP_TOOLCHAIN = $RustToolchain

Push-Location $BuildRoot
try {
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
  }

  & npm.cmd run tauri:build -- --no-bundle
  if ($LASTEXITCODE -ne 0) {
    throw "tauri build failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

$builtExe = Join-Path $BuildRoot "src-tauri\target\release\openclaw-manager.exe"
Assert-Path -Path $builtExe -Message "The built manager executable was not produced at $builtExe"
$builtRuntimeDir = Join-Path $BuildRoot "src-tauri\target\release"

$outputDir = Split-Path -Parent $OutputExe
if (-not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

Get-Process openclaw-manager -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 600

if (Test-Path $OutputExe) {
  Copy-Item -Force $OutputExe "$OutputExe.bak"
}

Copy-Item -Force $builtExe $OutputExe
Get-ChildItem $builtRuntimeDir -Filter "*.dll" | ForEach-Object {
  Copy-Item -Force $_.FullName (Join-Path $outputDir $_.Name)
}

Write-Host "Built and installed Manager to $OutputExe"
