#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-3000}"
CONFIG_PATH="${HOME}/.config/ngrok/ngrok.yml"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is not installed or not on PATH."
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Missing ngrok config at $CONFIG_PATH"
  echo "Run: ngrok config add-authtoken <your-token>"
  exit 1
fi

exec ngrok http "$PORT" --config "$CONFIG_PATH" --log=stdout
