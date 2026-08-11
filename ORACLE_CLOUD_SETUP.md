# Oracle Cloud Setup

This moves the VOX monitor off your metered connection. The cloud VM uses its own network; your PC only needs internet while you deploy or SSH.

## Current Low-Bandwidth Strategy

Keep these settings in `.env`:

```text
VOX_POLL_MINUTES=5
VOX_LOOKAHEAD_DAYS=21
VOX_AUTO_SEAT_CHECK_MODE=release
VOX_FULL_SEAT_CHECK_EVERY_MINUTES=0
VOX_TELEGRAM_COMMANDS=1
```

This means:

- Every 5 minutes: cheap date/showtime scan over the next 21 days.
- Automatic live seat-map check only when a new date, new showtime, new booking link, or newly bookable showtime appears.
- Manual live full date scan any time: send `/check 13/8` to Telegram.
- Old high-bandwidth behavior: set `VOX_AUTO_SEAT_CHECK_MODE=all`.

## Create The Oracle VM

1. Create/sign in to Oracle Cloud Free Tier.
2. Create a Compute instance in your home region. Oracle says Always Free resources are available in the home region, so choose carefully during signup.
3. Recommended image: Ubuntu 24.04 or Ubuntu 22.04.
4. Choose an Always Free-eligible shape.
   - Easiest Chrome setup: x86/AMD shape, if available.
   - More RAM: Ampere ARM shape, if available; the install script will try Chromium.
5. Networking: default VCN is fine.
6. Inbound rules: SSH only. Do not open HTTP/HTTPS ports; this bot only needs outbound internet.
7. Download or save the SSH private key.

Official docs:

- Oracle Free Tier: https://docs.oracle.com/iaas/Content/FreeTier/freetier.htm
- Always Free resources: https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Security lists: https://docs.oracle.com/iaas/Content/Network/Concepts/securitylists.htm

## Upload From Windows

From PowerShell on your PC:

```powershell
cd C:\vox-seat-monitor
.\cloud\deploy-oracle.ps1 -HostName YOUR_VM_PUBLIC_IP -KeyPath C:\path\to\ssh-key.key -IncludeEnv -Install
```

`-IncludeEnv` uploads your existing `.env`, including Telegram secrets. Use it only with your own VM. Never upload `.env` to a public GitHub repository.

That one command uploads the monitor, installs Node/Chrome or Chromium on Ubuntu, registers the systemd service, and starts it.

## Manual Install On The VM

Only use this section if you did not pass `-Install`. SSH into the VM:

```powershell
ssh -i C:\path\to\ssh-key.key ubuntu@YOUR_VM_PUBLIC_IP
```

Run:

```bash
cd ~/vox-seat-monitor
chmod +x cloud/install-oracle-ubuntu.sh
APP_USER=ubuntu APP_DIR=/opt/vox-seat-monitor ./cloud/install-oracle-ubuntu.sh

sudo rsync -a --delete ~/vox-seat-monitor/ /opt/vox-seat-monitor/
sudo chown -R ubuntu:ubuntu /opt/vox-seat-monitor
chmod 600 /opt/vox-seat-monitor/.env

sudo cp /opt/vox-seat-monitor/cloud/vox-seat-monitor.service /etc/systemd/system/vox-seat-monitor.service
sudo systemctl daemon-reload
sudo systemctl enable --now vox-seat-monitor
```

Check it:

```bash
sudo systemctl status vox-seat-monitor --no-pager
sudo journalctl -u vox-seat-monitor -f
```

You should see:

```text
Telegram commands enabled. Use /check 13/8 or /check 2026-08-13.
```

## Telegram Test

Message your bot:

```text
/status
/check 13/8
```

`/check 13/8` should send showtimes with booking links first, then live interested-seat messages as each seat map is read.

## Stop Local Windows Monitor

Keep the Windows scheduled task stopped while the cloud VM is active:

```powershell
Stop-ScheduledTask -TaskName "VOX Seat Monitor"
```

Check that nothing local is running:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'chrome.exe') -and $_.CommandLine -like '*vox-seat-monitor*' }
```

## Updating Later

After editing locally:

```powershell
cd C:\vox-seat-monitor
.\cloud\deploy-oracle.ps1 -HostName YOUR_VM_PUBLIC_IP -KeyPath C:\path\to\ssh-key.key -IncludeEnv
```

Then on the VM, or rerun the deploy command with `-Install`:

```bash
sudo rsync -a --delete ~/vox-seat-monitor/ /opt/vox-seat-monitor/
sudo chown -R ubuntu:ubuntu /opt/vox-seat-monitor
chmod 600 /opt/vox-seat-monitor/.env
sudo systemctl restart vox-seat-monitor
sudo journalctl -u vox-seat-monitor -f
```
