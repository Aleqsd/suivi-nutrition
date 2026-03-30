param(
  [string]$RemoteHost = $env:OVH_HOST,
  [string]$RemoteDir = "/home/ubuntu/GitHub/suivi-nutrition",
  [string]$PublicBaseUrl = $env:PUBLIC_BASE_URL,
  [string]$NetlifySiteId = $env:NETLIFY_SITE_ID,
  [ValidateSet("standard", "fast")]
  [string]$Mode = "standard",
  [switch]$SkipPrivateDataSync,
  [switch]$SkipPublish,
  [switch]$SkipSmokeTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RsyncFilterFile = "scripts/deploy_rsync.rules"
$WslSshExe = "/mnt/c/Windows/System32/OpenSSH/ssh.exe"

if (-not $RemoteHost) {
  $RemoteHost = "ovh"
}
if (-not $PublicBaseUrl) {
  throw "Missing public base URL. Set -PublicBaseUrl or PUBLIC_BASE_URL."
}

function Get-DeployModeDescription {
  param([Parameter(Mandatory = $true)][string]$CurrentMode)

  switch ($CurrentMode) {
    "fast" { return "fast: skip VPS package/dependency reprovisioning, keep rebuild/publish/tests" }
    default { return "standard: full VPS reprovision, rebuild, publish, tests" }
  }
}

function Invoke-RemoteCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command
  )

  ssh $RemoteHost $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Remote command failed: $Command"
  }
}

function Invoke-RsyncSync {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Source,
    [Parameter(Mandatory = $true)]
    [string]$Destination,
    [switch]$Delete,
    [string[]]$ExtraArgs = @()
  )

  $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if (-not $wsl) {
    throw "Missing WSL locally. Install WSL with Ubuntu before deploying."
  }

  $sshConfig = Resolve-SshConnection
  $rsyncArgs = @("rsync", "-az", "--itemize-changes")
  if ($Delete) {
    $rsyncArgs += "--delete"
  }
  $rsyncArgs += "-e"
  $rsyncArgs += ("'" + (Build-WslSshCommand $sshConfig.IdentityFile) + "'")
  foreach ($extraArg in $ExtraArgs) {
    $rsyncArgs += ("'" + (Escape-WslSingleQuotedValue $extraArg) + "'")
  }
  $rsyncArgs += @(
    "'" + (Escape-WslSingleQuotedValue $Source) + "'",
    "'" + (Escape-WslSingleQuotedValue $Destination) + "'"
  )

  $command = "cd '" + (Escape-WslSingleQuotedValue (Convert-ToWslPath $RepoRoot)) + "' && " + ($rsyncArgs -join " ")
  & $wsl.Path bash -lc $command
  if ($LASTEXITCODE -ne 0) {
    throw "rsync failed for $Source"
  }
}

function Get-NetlifyAuthToken {
  if ($env:NETLIFY_AUTH_TOKEN) {
    return $env:NETLIFY_AUTH_TOKEN
  }

  $configPath = Join-Path $env:APPDATA "netlify\Config\config.json"
  if (Test-Path $configPath) {
    $config = Get-Content $configPath | ConvertFrom-Json
    foreach ($user in $config.users.PSObject.Properties) {
      $token = $user.Value.auth.token
      if ($token) {
        return $token
      }
    }
  }

  throw "Missing NETLIFY_AUTH_TOKEN locally. Export it or login with netlify-cli first."
}

function Convert-ToRsyncPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  return (Resolve-Path $Path).Path.Replace("\", "/")
}

function Convert-ToWslPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $resolved = (Resolve-Path $Path).Path
  if ($resolved -match '^(?<drive>[A-Za-z]):(?<rest>.*)$') {
    $drive = $matches['drive'].ToLowerInvariant()
    $rest = $matches['rest'].Replace('\', '/')
    return "/mnt/$drive$rest"
  }
  throw "Failed to convert path to WSL format: $Path"
}

function Escape-SingleQuotedShellValue {
  param([Parameter(Mandatory = $true)][string]$Value)

  return $Value.Replace("'", "'\''")
}

function Escape-WslSingleQuotedValue {
  param([Parameter(Mandatory = $true)][string]$Value)

  return $Value.Replace("'", "'`"`'`"`'")
}

function Resolve-SshConnection {
  $details = @{
    User = ""
    Host = ""
    IdentityFile = ""
  }
  foreach ($line in ssh -G $RemoteHost) {
    if ($line -match "^user\s+(.+)$") {
      $details.User = $matches[1].Trim()
      continue
    }
    if ($line -match "^hostname\s+(.+)$") {
      $details.Host = $matches[1].Trim()
      continue
    }
    if ($line -match "^identityfile\s+(.+)$" -and -not $details.IdentityFile) {
      $identityFile = $matches[1].Trim()
      if ($identityFile.StartsWith("~/")) {
        $identityFile = Join-Path $HOME $identityFile.Substring(2)
      }
      $details.IdentityFile = (Resolve-Path $identityFile).Path
    }
  }
  if (-not $details.User -or -not $details.Host -or -not $details.IdentityFile) {
    throw "Failed to resolve SSH connection details for host '$RemoteHost'."
  }
  return [pscustomobject]$details
}

function Build-WslSshCommand {
  param([Parameter(Mandatory = $true)][string]$IdentityFile)

  $escapedIdentityFile = $IdentityFile.Replace("\", "\\")
  return "$WslSshExe -i $escapedIdentityFile -o IdentitiesOnly=yes"
}

function Sync-Code {
  Write-Host "[deploy] Syncing code to VPS with rsync..."
  Invoke-RemoteCommand "mkdir -p $RemoteDir"
  $sshConfig = Resolve-SshConnection
  Invoke-RsyncSync -Source "./" -Destination "$($sshConfig.User)@$($sshConfig.Host):$RemoteDir/" -Delete -ExtraArgs @("--filter=merge $RsyncFilterFile")
}

function Sync-PrivateData {
  Write-Host "[deploy] Syncing private local data to VPS..."
  Invoke-RemoteCommand "mkdir -p $RemoteDir/data/journal $RemoteDir/data/profile"
  $sshConfig = Resolve-SshConnection

  $journalDir = Join-Path $RepoRoot "data/journal/"
  if (Test-Path $journalDir) {
    Invoke-RsyncSync -Source (Convert-ToWslPath $journalDir) -Destination "$($sshConfig.User)@$($sshConfig.Host):$RemoteDir/data/journal/"
  }

  $currentProfile = Join-Path $RepoRoot "data/profile/current.yaml"
  if (Test-Path $currentProfile) {
    Invoke-RsyncSync -Source (Convert-ToWslPath $currentProfile) -Destination "$($sshConfig.User)@$($sshConfig.Host):$RemoteDir/data/profile/current.yaml"
  }
}

function Run-RemotePipeline {
  $skipPublishFlag = if ($SkipPublish) { "1" } else { "0" }
  $deployMessage = Escape-SingleQuotedShellValue "Manual deploy from local workspace"
  $deployMode = Escape-SingleQuotedShellValue $Mode

  if (-not $SkipPublish -and -not $NetlifySiteId) {
    throw "Missing Netlify site id. Set -NetlifySiteId or NETLIFY_SITE_ID."
  }

  $envParts = @(
    "APP_DIR='$RemoteDir'",
    "DEPLOY_MODE='$deployMode'",
    "SKIP_PUBLISH='$skipPublishFlag'",
    "DEPLOY_MESSAGE='$deployMessage'"
  )

  if (-not $SkipPublish) {
    $netlifyAuthToken = Escape-SingleQuotedShellValue (Get-NetlifyAuthToken)
    $netlifySiteId = Escape-SingleQuotedShellValue $NetlifySiteId
    $envParts += @(
      "NETLIFY_SITE_ID='$netlifySiteId'",
      "NETLIFY_AUTH_TOKEN='$netlifyAuthToken'"
    )
  }

  $remoteCommand = "cd $RemoteDir && " + ($envParts -join " ") + " bash scripts/run_vps_deploy_pipeline.sh"
  Write-Host "[deploy] Running unified pipeline on VPS..."
  Invoke-RemoteCommand $remoteCommand
}

function Run-SmokeTests {
  Write-Host "[deploy] Running public smoke test..."
  & python "$RepoRoot/scripts/smoke_test_site.py" public --base-url $PublicBaseUrl
  if ($LASTEXITCODE -ne 0) {
    throw "Public smoke test failed."
  }

  Write-Host "[deploy] Running VPS dashboard smoke test..."
  $escapedRemoteDir = Escape-SingleQuotedShellValue $RemoteDir
  Invoke-RemoteCommand "cd '$escapedRemoteDir' && python3 scripts/smoke_test_site.py vps --base-url http://127.0.0.1:43817/site"
}

Write-Host ("[deploy] Mode: " + (Get-DeployModeDescription $Mode))
Sync-Code

if (-not $SkipPrivateDataSync) {
  Sync-PrivateData
}

Run-RemotePipeline

if (-not $SkipSmokeTests) {
  Run-SmokeTests
}

Write-Host "[deploy] Done."
