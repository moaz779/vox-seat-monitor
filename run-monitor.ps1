$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Set-Location $Root

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $LogDir "monitor-$stamp.log"

"$(Get-Date -Format o) Starting VOX monitor in $Root" | Tee-Object -FilePath $logFile
"$(Get-Date -Format o) Log file: $logFile" | Tee-Object -FilePath $logFile -Append

node "$Root\monitor.js" 2>&1 | Tee-Object -FilePath $logFile -Append
