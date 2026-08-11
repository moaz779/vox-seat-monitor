$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $Root ".env"
$ExampleFile = Join-Path $Root ".env.example"

function Read-EnvFile($Path) {
  $config = [ordered]@{}
  if (-not (Test-Path $Path)) { return $config }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
    $parts = $line.Split("=", 2)
    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    if ($name -match "^[A-Za-z_][A-Za-z0-9_]*$") {
      $config[$name] = $value
    }
  }

  return $config
}

function Write-EnvFile($Path, $Config) {
  $lines = @(
    "# VOX Seat Monitor local config",
    "# Keep this file private. It contains your Telegram bot token.",
    "",
    "TELEGRAM_BOT_TOKEN=$($Config.TELEGRAM_BOT_TOKEN)",
    "TELEGRAM_CHAT_ID=$($Config.TELEGRAM_CHAT_ID)",
    "",
    "VOX_END_DATE=$($Config.VOX_END_DATE)",
    "VOX_POLL_MINUTES=$($Config.VOX_POLL_MINUTES)",
    "",
    "VOX_CITY=$($Config.VOX_CITY)",
    "VOX_MOVIE=$($Config.VOX_MOVIE)",
    "VOX_EXPERIENCE=$($Config.VOX_EXPERIENCE)",
    "",
    "VOX_SEND_EVERY_CHECK=$($Config.VOX_SEND_EVERY_CHECK)"
  )

  Set-Content -Path $Path -Value $lines -Encoding ASCII
}

function ConvertFrom-SecureStringPlainText($SecureString) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if (-not (Test-Path $EnvFile)) {
  Copy-Item $ExampleFile $EnvFile
}

$config = Read-EnvFile $EnvFile

$defaults = @{
  TELEGRAM_BOT_TOKEN = ""
  TELEGRAM_CHAT_ID = ""
  VOX_END_DATE = "20260820"
  VOX_POLL_MINUTES = "15"
  VOX_CITY = "city-centre-almaza"
  VOX_MOVIE = "the-odyssey"
  VOX_EXPERIENCE = "IMAX"
  VOX_SEND_EVERY_CHECK = "0"
}

foreach ($key in $defaults.Keys) {
  if (-not $config.Contains($key)) {
    $config[$key] = $defaults[$key]
  }
}

if (-not $config.TELEGRAM_BOT_TOKEN -or $config.TELEGRAM_BOT_TOKEN -eq "123456789:replace_me") {
  $secureToken = Read-Host "Paste your Telegram bot token from BotFather" -AsSecureString
  $config.TELEGRAM_BOT_TOKEN = ConvertFrom-SecureStringPlainText $secureToken
}

Write-Host "Reading Telegram updates. This needs at least one message sent to your bot."
$updatesUrl = "https://api.telegram.org/bot$($config.TELEGRAM_BOT_TOKEN)/getUpdates"
$updates = Invoke-RestMethod -Uri $updatesUrl -Method Get -TimeoutSec 20
$messages = @($updates.result | Where-Object { $_.message -and $_.message.chat -and $_.message.chat.id })

if ($messages.Count -eq 0) {
  Write-EnvFile $EnvFile $config
  throw "No Telegram messages found yet. Send 'hi' to your bot, wait a few seconds, then run .\setup-telegram.ps1 again."
}

$last = $messages[$messages.Count - 1]
$config.TELEGRAM_CHAT_ID = [string]$last.message.chat.id
Write-EnvFile $EnvFile $config

$body = @{
  chat_id = $config.TELEGRAM_CHAT_ID
  text = "VOX monitor Telegram setup complete - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  disable_web_page_preview = $true
} | ConvertTo-Json

$sendUrl = "https://api.telegram.org/bot$($config.TELEGRAM_BOT_TOKEN)/sendMessage"
$response = Invoke-RestMethod -Uri $sendUrl -Method Post -ContentType "application/json" -Body $body

if ($response.ok) {
  Write-Host "Telegram is configured. Chat ID saved to .env: $($config.TELEGRAM_CHAT_ID)"
  Write-Host "You should receive a Telegram test message now."
  Write-Host "Next: run .\install-task.ps1 to keep the monitor running at login."
} else {
  $response | ConvertTo-Json -Depth 10
}
