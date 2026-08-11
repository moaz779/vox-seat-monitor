# GitHub Actions Setup

This runs the VOX monitor from GitHub every 5 minutes, so your PC and home internet do not need to stay on.

## What Changes

- GitHub checks VOX every 5 minutes.
- Telegram alerts still send when new days, new showtimes, booking links, or interested seats are found.
- Telegram bot commands do not run live because GitHub Actions is not an always-on server.
- Manual date checks use the GitHub **Run workflow** button instead.

## Create The Repository

Create a new GitHub repository, then from PowerShell:

```powershell
cd C:\vox-seat-monitor
git init
git branch -M main
git add .
git commit -m "Add VOX seat monitor"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

The `.gitignore` keeps `.env`, local logs, local state, and Telegram offset files out of GitHub.

## Add Telegram Secrets

In your GitHub repository:

1. Go to **Settings**.
2. Go to **Secrets and variables**.
3. Open **Actions**.
4. Add repository secret `TELEGRAM_BOT_TOKEN`.
5. Add repository secret `TELEGRAM_CHAT_ID`.

Do not put these values in the workflow file.

## Enable Write Permission

The workflow commits `github-state/state.json` back to the repository so it remembers what it already alerted you about.

In the repository:

1. Go to **Settings**.
2. Go to **Actions**.
3. Open **General**.
4. Under **Workflow permissions**, choose **Read and write permissions**.
5. Save.

The workflow also declares:

```yaml
permissions:
  contents: write
```

## Start It

In GitHub:

1. Open the **Actions** tab.
2. Select **VOX Seat Monitor**.
3. Click **Run workflow** once.
4. Leave `check_date` blank for a normal scheduled-style run.

After that, the schedule runs every 5 minutes.

## Manual Date Check

To replace Telegram `/check 13/8`:

1. Open **Actions**.
2. Select **VOX Seat Monitor**.
3. Click **Run workflow**.
4. Enter `13/8` or `2026-08-13` in `check_date`.

This sends showtimes first, then interested-seat alerts as seat maps are read.

## Important Notes

- Public repositories get free standard GitHub-hosted Actions usage. Private repositories have a monthly free-minute quota.
- GitHub's shortest scheduled interval is 5 minutes.
- GitHub schedules can be delayed sometimes, so this is not as instant as a real VPS.
- The first GitHub run starts with a new `github-state/state.json`, so it may send an initial baseline alert.
- If you update the workflow, start a fresh run from **Actions -> VOX Seat Monitor -> Run workflow**. Do not use **Re-run jobs** on an old failed run, because that reuses the old commit.
