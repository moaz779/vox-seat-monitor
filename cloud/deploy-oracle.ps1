param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$User = "ubuntu",

  [Parameter(Mandatory = $true)]
  [string]$KeyPath,

  [switch]$IncludeEnv,

  [switch]$Install
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RemoteHome = "/home/$User/vox-seat-monitor"

$required = @("monitor.js", ".env.example", "README.md", "cloud/install-oracle-ubuntu.sh", "cloud/vox-seat-monitor.service")
foreach ($file in $required) {
  $localPath = Join-Path $Root $file
  if (-not (Test-Path $localPath)) {
    throw "Missing required file: $localPath"
  }
}

ssh -i $KeyPath "$User@$HostName" "mkdir -p '$RemoteHome/cloud'"

$files = @(
  "monitor.js",
  ".env.example",
  "README.md",
  "cloud/install-oracle-ubuntu.sh",
  "cloud/vox-seat-monitor.service"
)

if ($IncludeEnv) {
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path $envFile)) {
    throw "Cannot include .env because it does not exist."
  }
  $files += ".env"
}

foreach ($file in $files) {
  $source = Join-Path $Root $file
  $targetDir = if ($file -like "cloud/*") { "$RemoteHome/cloud/" } else { "$RemoteHome/" }
  scp -i $KeyPath $source "$User@$HostName`:$targetDir"
}

Write-Host "Uploaded files to $User@$HostName`:$RemoteHome"

if ($Install) {
  Write-Host "Installing and starting systemd service on the VM..."
  $remoteInstall = @"
set -euo pipefail
cd '$RemoteHome'
chmod +x cloud/install-oracle-ubuntu.sh
APP_USER='$User' APP_DIR='/opt/vox-seat-monitor' ./cloud/install-oracle-ubuntu.sh
sudo rsync -a --delete '$RemoteHome/' /opt/vox-seat-monitor/
sudo chown -R '${User}:${User}' /opt/vox-seat-monitor
if [ -f /opt/vox-seat-monitor/.env ]; then chmod 600 /opt/vox-seat-monitor/.env; fi
sudo cp /opt/vox-seat-monitor/cloud/vox-seat-monitor.service /etc/systemd/system/vox-seat-monitor.service
sudo systemctl daemon-reload
sudo systemctl enable --now vox-seat-monitor
sudo systemctl status vox-seat-monitor --no-pager
"@
  $remoteInstall = $remoteInstall -replace "`r", ""
  $remoteInstall | ssh -i $KeyPath "$User@$HostName" "bash -s"
  Write-Host "Install complete. Watch logs with:"
  Write-Host "ssh -i $KeyPath $User@$HostName `"sudo journalctl -u vox-seat-monitor -f`""
} else {
  Write-Host "Next: SSH to the VM and follow ORACLE_CLOUD_SETUP.md from the local project, or rerun this command with -Install."
}
