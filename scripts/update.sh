#!/usr/bin/env bash
# Run on the server to pull the latest code from GitHub and restart the bot.
#   bash scripts/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
npm ci
npm run build
npm run register:prod
pm2 reload ecosystem.config.cjs
pm2 status carla-ai
