$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $Root ".env"

if (-not (Test-Path $EnvFile)) {
  throw "Missing $EnvFile. Copy .env.example to .env and fill TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID first."
}

Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
  $parts = $line.Split("=", 2)
  $name = $parts[0].Trim()
  $value = $parts[1].Trim().Trim('"').Trim("'")
  if ($name -match "^[A-Za-z_][A-Za-z0-9_]*$") {
    Set-Item -Path "Env:$name" -Value $value
  }
}

if (-not $env:TELEGRAM_BOT_TOKEN -or $env:TELEGRAM_BOT_TOKEN -eq "123456789:replace_me") {
  throw "TELEGRAM_BOT_TOKEN is not set in .env."
}

if (-not $env:TELEGRAM_CHAT_ID -or $env:TELEGRAM_CHAT_ID -eq "replace_me") {
  Write-Host "TELEGRAM_CHAT_ID is not set yet."
  Write-Host "Message your bot in Telegram, then opening getUpdates now:"
  $updatesUrl = "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/getUpdates"
  Start-Process $updatesUrl
  Write-Host "Look for: ""chat"":{""id"":NUMBER ... }"
  return
}

$body = @{
  chat_id = $env:TELEGRAM_CHAT_ID
  text = "VOX monitor Telegram test OK - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  disable_web_page_preview = $true
} | ConvertTo-Json

$url = "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/sendMessage"
$response = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json" -Body $body

if ($response.ok) {
  Write-Host "Telegram test sent successfully."
} else {
  $response | ConvertTo-Json -Depth 10
}
