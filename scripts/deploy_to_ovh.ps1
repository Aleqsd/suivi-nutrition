$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RemoteHost = "ovh"
$RemoteDir = "/home/ubuntu/GitHub/suivi-nutrition"

ssh $RemoteHost "mkdir -p $RemoteDir $RemoteDir/data $RemoteDir/site"

$FileItems = @(
  ".gitignore",
  "AGENTS.md",
  "README.md",
  "requirements.txt"
)

foreach ($Item in $FileItems) {
  $LocalPath = Join-Path $RepoRoot $Item
  scp $LocalPath "${RemoteHost}:$RemoteDir/"
}

$DirItems = @(
  "docs",
  "schemas",
  "scripts",
  "data/reference",
  "data/templates"
)

foreach ($Item in $DirItems) {
  $LocalPath = Join-Path $RepoRoot $Item
  scp -r $LocalPath "${RemoteHost}:$RemoteDir/$([System.IO.Path]::GetDirectoryName($Item).Replace('\','/'))/"
}

$SiteItems = @(
  "site/index.html",
  "site/styles.css",
  "site/app.js"
)

foreach ($Item in $SiteItems) {
  $LocalPath = Join-Path $RepoRoot $Item
  scp $LocalPath "${RemoteHost}:$RemoteDir/site/"
}

ssh $RemoteHost "chmod +x $RemoteDir/scripts/provision_vps.sh $RemoteDir/scripts/install_cloudflared_ubuntu.sh $RemoteDir/scripts/configure_cloudflared_service.sh"
ssh $RemoteHost "APP_DIR=$RemoteDir bash $RemoteDir/scripts/provision_vps.sh"
