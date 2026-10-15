#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu/Debian VPS (run as a sudo-capable user).
# Usage: bash deploy/setup-ubuntu.sh play.example.com
set -euo pipefail
DOMAIN="${1:?usage: setup-ubuntu.sh <domain>}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Node.js 24 LTS + build tools
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx
sudo npm install -g pm2

# Build the game
cd "$APP_DIR"
npm ci
npm run build

# Run it and keep it running across reboots
pm2 start ecosystem.config.cjs
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"

# Reverse proxy + HTTPS
sed "s/play.example.com/$DOMAIN/g" deploy/nginx.conf | sudo tee /etc/nginx/sites-available/my-world >/dev/null
sudo ln -sf /etc/nginx/sites-available/my-world /etc/nginx/sites-enabled/my-world
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect

echo "Done: https://$DOMAIN"
