#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/vox-seat-monitor}"
APP_USER="${APP_USER:-$USER}"

echo "Installing system packages..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg rsync unzip

need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  if [ "${major}" -ge 22 ]; then
    need_node=0
  fi
fi

if [ "${need_node}" -eq 1 ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

arch="$(dpkg --print-architecture)"
if command -v google-chrome-stable >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then
  echo "Chrome/Chromium already installed."
elif [ "${arch}" = "amd64" ]; then
  echo "Installing Google Chrome stable for amd64..."
  sudo install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /tmp/google-chrome.gpg
  sudo install -m 0644 /tmp/google-chrome.gpg /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y google-chrome-stable
else
  echo "Installing Chromium for ${arch}..."
  sudo apt-get install -y snapd
  sudo snap install chromium
fi

sudo mkdir -p "${APP_DIR}/logs"
sudo chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "Installed:"
node -v
npm -v
(google-chrome-stable --version || chromium --version || chromium-browser --version || true)
echo "Ready for ${APP_DIR}"
