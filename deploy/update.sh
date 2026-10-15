#!/usr/bin/env bash
# Pull the latest code, rebuild, and restart. Usage: bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci
npm run build
pm2 reload my-world
