param(
  [string]$SourceDir = "$env:USERPROFILE\.openclaw",
  [string]$Distro = "Ubuntu",
  [string]$TargetDir = "/root/.openclaw",
  [string]$ServiceName = "openclaw-gateway.service",
  [int]$DebounceMs = 1200,
  [switch]$Watch,
  [switch]$RestartService
)

$ErrorActionPreference = "Stop"

$TrackedFiles = @("openclaw.json", "env", ".env")

function Write-BridgeLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] $Message"
}

function Get-WslUncPath {
  param([string]$LinuxPath)

  $trimmed = $LinuxPath.Trim().TrimStart("/")
  $segments = if ($trimmed) { $trimmed -split "/" } else { @() }
  $unc = "\\wsl.localhost\$Distro"
  foreach ($segment in $segments) {
    $unc = Join-Path $unc $segment
  }
  return $unc
}

function Ensure-WslReady {
  & wsl.exe -d $Distro -- bash -lc "mkdir -p '$TargetDir' '$TargetDir/.sync-backups'" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to prepare WSL target directory $TargetDir in distro $Distro."
  }
}

function Read-JsonHashtable {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  $raw = Get-Content -Path $Path -Raw -Encoding UTF8
  if (-not $raw.Trim()) {
    return [ordered]@{}
  }

  $parsed = $raw | ConvertFrom-Json
  return ConvertTo-NormalizedValue $parsed
}

function ConvertTo-NormalizedValue {
  param([object]$Value)

  if ($null -eq $Value) {
    return $null
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $result = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $result[$key] = ConvertTo-NormalizedValue $Value[$key]
    }
    return $result
  }

  if ($Value -is [pscustomobject]) {
    $result = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) {
      $result[$property.Name] = ConvertTo-NormalizedValue $property.Value
    }
    return $result
  }

  if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
    $items = @()
    foreach ($item in $Value) {
      $items += ,(ConvertTo-NormalizedValue $item)
    }
    return $items
  }

  return $Value
}

function Merge-StructuredValue {
  param(
    [object]$BaseValue,
    [object]$OverlayValue
  )

  if ($null -eq $BaseValue) {
    return ConvertTo-NormalizedValue $OverlayValue
  }

  if ($null -eq $OverlayValue) {
    return ConvertTo-NormalizedValue $BaseValue
  }

  $baseIsMap = $BaseValue -is [System.Collections.IDictionary]
  $overlayIsMap = $OverlayValue -is [System.Collections.IDictionary]
  if ($baseIsMap -and $overlayIsMap) {
    $merged = [ordered]@{}
    foreach ($key in $BaseValue.Keys) {
      $merged[$key] = ConvertTo-NormalizedValue $BaseValue[$key]
    }
    foreach ($key in $OverlayValue.Keys) {
      if ($merged.Contains($key)) {
        $merged[$key] = Merge-StructuredValue -BaseValue $merged[$key] -OverlayValue $OverlayValue[$key]
      } else {
        $merged[$key] = ConvertTo-NormalizedValue $OverlayValue[$key]
      }
    }
    return $merged
  }

  return ConvertTo-NormalizedValue $OverlayValue
}

function Ensure-NestedMap {
  param(
    [hashtable]$Map,
    [string[]]$Path
  )

  $cursor = $Map
  foreach ($segment in $Path) {
    if (-not $cursor.Contains($segment) -or -not ($cursor[$segment] -is [System.Collections.IDictionary])) {
      $cursor[$segment] = [ordered]@{}
    }
    $cursor = $cursor[$segment]
  }
  return $cursor
}

function Build-MergedConfig {
  param(
    [hashtable]$SourceConfig,
    [hashtable]$TargetConfig
  )

  if ($null -eq $SourceConfig -and $null -eq $TargetConfig) {
    throw "Neither source nor target openclaw.json exists."
  }

  if ($null -eq $SourceConfig) {
    return ConvertTo-NormalizedValue $TargetConfig
  }

  if ($null -eq $TargetConfig) {
    $merged = ConvertTo-NormalizedValue $SourceConfig
  } else {
    $merged = Merge-StructuredValue -BaseValue $TargetConfig -OverlayValue $SourceConfig
  }

  $defaults = Ensure-NestedMap -Map $merged -Path @("agents", "defaults")
  if ($TargetConfig -and $TargetConfig.Contains("agents") -and $TargetConfig["agents"].Contains("defaults") -and $TargetConfig["agents"]["defaults"].Contains("workspace")) {
    $defaults["workspace"] = $TargetConfig["agents"]["defaults"]["workspace"]
  } else {
    $defaults["workspace"] = "$TargetDir/workspace"
  }

  if ($TargetConfig -and $TargetConfig.Contains("gateway")) {
    $merged["gateway"] = ConvertTo-NormalizedValue $TargetConfig["gateway"]
  }

  return $merged
}

function ConvertTo-PrettyJson {
  param([object]$Value)
  return ($Value | ConvertTo-Json -Depth 100)
}

function Backup-TargetFile {
  param(
    [string]$TargetPath,
    [string]$RelativeName
  )

  if (-not (Test-Path $TargetPath)) {
    return
  }

  $backupDir = Get-WslUncPath "$TargetDir/.sync-backups"
  if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $safeName = $RelativeName.Replace("/", "_").Replace("\", "_")
  $destination = Join-Path $backupDir "$stamp-$safeName"
  Copy-Item -Path $TargetPath -Destination $destination -Force
}

function Write-IfChanged {
  param(
    [string]$TargetPath,
    [string]$Content,
    [string]$RelativeName
  )

  $existing = ""
  if (Test-Path $TargetPath) {
    $existing = Get-Content -Path $TargetPath -Raw -Encoding UTF8
  }

  if ($existing -ceq $Content) {
    return $false
  }

  Backup-TargetFile -TargetPath $TargetPath -RelativeName $RelativeName
  $targetParent = Split-Path -Parent $TargetPath
  if (-not (Test-Path $targetParent)) {
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($TargetPath, $Content, [System.Text.UTF8Encoding]::new($false))
  Write-BridgeLog "Synced $RelativeName -> $TargetPath"
  return $true
}

function Sync-ConfigFile {
  $sourcePath = Join-Path $SourceDir "openclaw.json"
  $targetPath = Get-WslUncPath "$TargetDir/openclaw.json"
  $sourceConfig = Read-JsonHashtable -Path $sourcePath
  $targetConfig = Read-JsonHashtable -Path $targetPath
  $mergedConfig = Build-MergedConfig -SourceConfig $sourceConfig -TargetConfig $targetConfig
  $json = ConvertTo-PrettyJson -Value $mergedConfig
  return Write-IfChanged -TargetPath $targetPath -Content $json -RelativeName "openclaw.json"
}

function Sync-TextFile {
  param([string]$RelativeName)

  $sourcePath = Join-Path $SourceDir $RelativeName
  if (-not (Test-Path $sourcePath)) {
    return $false
  }

  $targetPath = Get-WslUncPath "$TargetDir/$RelativeName"
  $content = Get-Content -Path $sourcePath -Raw -Encoding UTF8
  return Write-IfChanged -TargetPath $targetPath -Content $content -RelativeName $RelativeName
}

function Restart-GatewayIfNeeded {
  & wsl.exe -d $Distro -- systemctl --user restart $ServiceName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to restart $ServiceName in $Distro."
  }
  Write-BridgeLog "Restarted $ServiceName"
}

function Invoke-Sync {
  $changed = $false
  $changed = (Sync-ConfigFile) -or $changed
  foreach ($relativeName in @("env", ".env")) {
    $changed = (Sync-TextFile -RelativeName $relativeName) -or $changed
  }

  if ($changed -and $RestartService) {
    Restart-GatewayIfNeeded
  }

  if (-not $changed) {
    Write-BridgeLog "No config changes detected."
  }

  return $changed
}

function Start-WatchLoop {
  $watcher = New-Object System.IO.FileSystemWatcher
  $watcher.Path = $SourceDir
  $watcher.Filter = "*"
  $watcher.IncludeSubdirectories = $false
  $watcher.NotifyFilter = [System.IO.NotifyFilters]"FileName, LastWrite, Size, CreationTime"
  $watcher.EnableRaisingEvents = $true

  $script:SyncPending = $false
  $script:SyncDueAt = Get-Date

  $action = {
    $candidateNames = @()
    if ($Event.SourceEventArgs.PSObject.Properties.Name -contains "Name") {
      $candidateNames += $Event.SourceEventArgs.Name
    }
    if ($Event.SourceEventArgs.PSObject.Properties.Name -contains "OldName") {
      $candidateNames += $Event.SourceEventArgs.OldName
    }

    if ($candidateNames | Where-Object { $TrackedFiles -contains $_ }) {
      $script:SyncPending = $true
      $script:SyncDueAt = (Get-Date).AddMilliseconds($DebounceMs)
    }
  }

  $subscriptions = @(
    Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $action,
    Register-ObjectEvent -InputObject $watcher -EventName Created -Action $action,
    Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action $action
  )

  Write-BridgeLog "Watching $SourceDir and syncing into $TargetDir on $Distro"

  try {
    while ($true) {
      Wait-Event -Timeout 1 | Out-Null
      if ($script:SyncPending -and (Get-Date) -ge $script:SyncDueAt) {
        try {
          Invoke-Sync | Out-Null
        } catch {
          Write-BridgeLog "Sync failed: $($_.Exception.Message)"
        }
        $script:SyncPending = $false
      }
    }
  } finally {
    foreach ($subscription in $subscriptions) {
      Unregister-Event -SubscriptionId $subscription.Id -ErrorAction SilentlyContinue
    }
    $watcher.Dispose()
  }
}

if (-not (Test-Path $SourceDir)) {
  throw "Source directory $SourceDir was not found."
}

Ensure-WslReady
Invoke-Sync | Out-Null

if ($Watch) {
  Start-WatchLoop
}
