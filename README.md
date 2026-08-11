# VOX Seat Monitor

Watches VOX Egypt showtimes for one movie/cinema/experience set, then optionally sends Telegram alerts.

Default target:

- Cinema: `city-centre-almaza`
- Movie: `the-odyssey`
- Experiences: `IMAX`, `Standard`
- Poll interval: 5 minutes
- Future window: 30 days

The monitor does not depend on the visible VOX date carousel. It directly checks URLs with `d=YYYYMMDD`, so it can find newly opened days even if VOX currently only shows about a week.

## Run Once

```powershell
cd C:\vox-seat-monitor
node .\monitor.js --once
```

## Run Continuously

```powershell
cd C:\vox-seat-monitor
node .\monitor.js
```

Leave that terminal open. With `VOX_COMMAND_ONLY=1`, it only listens for Telegram commands and does not scan VOX automatically.

## Telegram

Create a Telegram bot with BotFather, then set these environment variables:

```powershell
$env:TELEGRAM_BOT_TOKEN="123456:your_token_here"
$env:TELEGRAM_CHAT_ID="123456789"
node .\monitor.js
```

To get your chat ID, message your bot once, then open:

```text
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```

Or use the local `.env` file, which is easier for always-on monitoring:

```powershell
cd C:\vox-seat-monitor
Copy-Item .\.env.example .\.env
notepad .\.env
```

Fill in:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
VOX_LOOKAHEAD_DAYS=21
VOX_POLL_MINUTES=5
```

Then test Telegram:

```powershell
.\test-telegram.ps1
```

You can also use the guided setup after messaging the bot once:

```powershell
.\setup-telegram.ps1
```

## Always On

Install a Windows Scheduled Task that starts the monitor when you log in:

```powershell
cd C:\vox-seat-monitor
.\install-task.ps1
```

Logs are written to:

```text
C:\vox-seat-monitor\logs
```

Check the task:

```powershell
Get-ScheduledTask -TaskName "VOX Seat Monitor" | Get-ScheduledTaskInfo
```

Stop/remove it:

```powershell
.\uninstall-task.ps1
```

This keeps the monitor running while your PC is on and your Windows user session is active. If the PC is asleep/offline, checks cannot run until it wakes up.

## GitHub Actions

GitHub Actions can run the monitor every 5 minutes without using your PC's internet. It sends Telegram alerts, but it does not keep Telegram commands live all the time.

See [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md).

The script sends alerts when:

- A new date gets matching IMAX showtimes.
- A new matching IMAX showtime appears.
- A booking link becomes available for a previously listed showtime.
- Available seats change.

With `VOX_COMMAND_ONLY=1`, these automatic alerts are disabled. The script checks VOX only after you send a Telegram command such as `/check 13/8`.
With `VOX_TELEGRAM_IGNORE_OLD_UPDATES_ON_START=1`, old Telegram messages queued while the bot was off are discarded at startup, so only new commands sent while it is running trigger checks.

Interested-seat alerts are sent immediately after that seat map is read, before the script continues to later showtimes in the same cycle.
Newly released days are also sent immediately after the fast date scan, before any seat-map checks, with booking links for every listed showtime on that day.

## Telegram Commands

When the scheduled monitor is running, message your bot:

```text
/check 13/8
/check 2026-08-13
/date 13/8
/seats 13/8
/today
/tomorrow
/status
```

`/check`, `/date`, and `/seats` scan just that requested date immediately. The bot first sends the listed showtimes and booking links, then checks live seat maps. If any seats are available in your interested range, it sends that seat message immediately while the requested-date scan is still running.

Showtime/day discovery is intentionally fast: the script checks the live showtime HTML with no-cache headers and scans dates in parallel.

In command-only mode, automatic seat-map checks are disabled. Use `/check 13/8` for a full seat scan of one date. Set `VOX_COMMAND_ONLY=0` and `VOX_AUTO_SEAT_CHECK_MODE=release` only if you want automatic release-driven checks again.

To receive a Telegram summary on every check even when nothing changed:

```powershell
$env:VOX_SEND_EVERY_CHECK="1"
```

## Useful Settings

```powershell
$env:VOX_LOOKAHEAD_DAYS="21"
# $env:VOX_END_DATE="20260820"
$env:VOX_POLL_MINUTES="5"
$env:VOX_EXPERIENCES="IMAX,Standard"
$env:VOX_CITY="city-centre-almaza"
$env:VOX_MOVIE="the-odyssey"
$env:VOX_PARALLEL_DATE_SCANS="6"
$env:VOX_HTTP_RETRIES="0"
$env:VOX_ABORT_SCAN_ON_FIRST_DATE_FAILURE="0"
$env:VOX_SHOWTIME_FETCH_MODE="http"
$env:VOX_BLOCK_ASSETS="1"
$env:VOX_SKIP_UNAVAILABLE_LISTINGS="0"
$env:VOX_TELEGRAM_COMMANDS="1"
$env:VOX_TELEGRAM_IGNORE_OLD_UPDATES_ON_START="1"
$env:VOX_COMMAND_ONLY="1"
$env:VOX_AUTO_SEAT_CHECK_MODE="none"
$env:VOX_FULL_SEAT_CHECK_EVERY_MINUTES="0"
$env:VOX_PERSIST_LAST_RUN="0"
$env:VOX_PERSIST_SEEN_TIMESTAMPS="0"
```

Use either `VOX_LOOKAHEAD_DAYS` or `VOX_END_DATE`. For always-on monitoring, prefer `VOX_LOOKAHEAD_DAYS` so the scan window moves forward each day. For example:

```powershell
$env:VOX_LOOKAHEAD_DAYS="21"
node .\monitor.js
```

For a fixed temporary window through August 20, 2026:

```powershell
$env:VOX_END_DATE="20260820"
node .\monitor.js
```

Seat types are inferred from VOX's seat CSS classes. The script reports `Premium`, `Standard`, or `Unknown` for available seats.

## Seat Rules

Normal Telegram seat updates only apply to IMAX and only include:

```text
Rows E/F/G/H/J/K/L, seat numbers 18 through 7
```

The priority standalone Telegram alert triggers for:

```text
IMAX:
H-16 H-15 H-14 H-13 H-12
J-16 J-15 J-14 J-13 J-12
K-16 K-15 K-14 K-13 K-12

Standard:
B-8 B-7 B-6 B-5 B-4 B-3 B-2 B-1
C-8 C-7 C-6 C-5 C-4 C-3 C-2 C-1
D-8 D-7 D-6 D-5 D-4 D-3 D-2 D-1
```

Override those in `.env` with:

```text
VOX_EXPERIENCES=IMAX,Standard
VOX_INTERESTED_ROWS=E,F,G,H,J,K,L
VOX_INTERESTED_MIN_SEAT=7
VOX_INTERESTED_MAX_SEAT=18
VOX_PRIORITY_SEATS=H:16,15,14,13,12;J:16,15,14,13,12;K:16,15,14,13,12
VOX_STANDARD_PRIORITY_SEATS=B:8,7,6,5,4,3,2,1;C:8,7,6,5,4,3,2,1;D:8,7,6,5,4,3,2,1
```

Sold-out and zero-interest-seat results are kept quiet in Telegram.
Standard showtimes do not use the IMAX interested range; they only send target-seat alerts for B/C/D seats 8 through 1.
