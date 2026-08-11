# VOX Seat Monitor

Watches VOX Egypt showtimes for one movie/cinema/experience, then optionally sends Telegram alerts.

Default target:

- Cinema: `city-centre-almaza`
- Movie: `the-odyssey`
- Experience: `IMAX`
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

Leave that terminal open. It checks every 5 minutes by default.

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

By default, automatic seat-map checks are release-driven to keep bandwidth low: the script opens live booking pages only when a new date, new showtime, new booking link, or newly bookable showtime appears. Use `/check 13/8` for an immediate full seat scan of a date. Set `VOX_AUTO_SEAT_CHECK_MODE=all` only if you want the old bandwidth-heavy behavior that checks every known seat map every cycle.

To receive a Telegram summary on every check even when nothing changed:

```powershell
$env:VOX_SEND_EVERY_CHECK="1"
```

## Useful Settings

```powershell
$env:VOX_LOOKAHEAD_DAYS="21"
# $env:VOX_END_DATE="20260820"
$env:VOX_POLL_MINUTES="5"
$env:VOX_EXPERIENCE="IMAX"
$env:VOX_CITY="city-centre-almaza"
$env:VOX_MOVIE="the-odyssey"
$env:VOX_PARALLEL_DATE_SCANS="6"
$env:VOX_HTTP_RETRIES="0"
$env:VOX_ABORT_SCAN_ON_FIRST_DATE_FAILURE="0"
$env:VOX_BLOCK_ASSETS="1"
$env:VOX_SKIP_UNAVAILABLE_LISTINGS="0"
$env:VOX_TELEGRAM_COMMANDS="1"
$env:VOX_AUTO_SEAT_CHECK_MODE="release"
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

Normal Telegram seat updates only include:

```text
Rows E/F/G/H/J/K/L, seat numbers 18 through 7
```

The priority standalone Telegram alert triggers for:

```text
H-16 H-15 H-14 H-13 H-12
J-16 J-15 J-14 J-13 J-12
K-16 K-15 K-14 K-13 K-12
```

Override those in `.env` with:

```text
VOX_INTERESTED_ROWS=E,F,G,H,J,K,L
VOX_INTERESTED_MIN_SEAT=7
VOX_INTERESTED_MAX_SEAT=18
VOX_PRIORITY_SEATS=H:16,15,14,13,12;J:16,15,14,13,12;K:16,15,14,13,12
```

Sold-out and zero-interest-seat results are kept quiet in Telegram.
