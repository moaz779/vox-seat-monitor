$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runner = Join-Path $Root "run-monitor.ps1"
$EnvFile = Join-Path $Root ".env"
$TaskName = "VOX Seat Monitor"

if (-not (Test-Path $EnvFile)) {
  throw "Missing $EnvFile. Copy .env.example to .env and fill it before installing the task."
}

$config = @{}
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
  $parts = $line.Split("=", 2)
  $name = $parts[0].Trim()
  $value = $parts[1].Trim().Trim('"').Trim("'")
  if ($name -match "^[A-Za-z_][A-Za-z0-9_]*$") {
    $config[$name] = $value
  }
}

if (-not $config.TELEGRAM_BOT_TOKEN -or $config.TELEGRAM_BOT_TOKEN -eq "123456789:replace_me") {
  throw "TELEGRAM_BOT_TOKEN is not set in $EnvFile."
}

if (-not $config.TELEGRAM_CHAT_ID -or $config.TELEGRAM_CHAT_ID -eq "replace_me") {
  throw "TELEGRAM_CHAT_ID is not set in $EnvFile. Run .\test-telegram.ps1 after messaging your bot."
}

if (-not (Test-Path $Runner)) {
  throw "Missing $Runner."
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`"" `
  -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 365) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 2)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Monitors VOX Cinemas for new IMAX days/showtimes and sends Telegram alerts." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started scheduled task: $TaskName"
Write-Host "Logs will appear in: $Root\logs"
Write-Host "Check status with: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
