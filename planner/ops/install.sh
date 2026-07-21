#!/bin/bash
# Installs Daybloom as a background app that starts automatically when you log in
# and restarts itself if it ever crashes. Run this once:
#     cd planner/ops && ./install.sh
set -e

LABEL="com.aneeta.daybloom"
OPS_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$OPS_DIR/.." && pwd)"
SERVER="$APP_DIR/backend/server.js"
ENV_FILE="$OPS_DIR/daybloom.env"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Daybloom"
DATA_DIR="$HOME/Library/Application Support/Daybloom"
NODE_BIN="$(command -v node || true)"

echo "🌱 Installing Daybloom…"

if [ -z "$NODE_BIN" ]; then echo "❌ Could not find node. Install Node 18+ first."; exit 1; fi
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ No daybloom.env found. Run:  cp daybloom.env.example daybloom.env  then edit it, then re-run."
  exit 1
fi

# Load env, generating strong secrets if they're blank, and write them back.
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
CHANGED=0
if [ -z "$DAYBLOOM_SECRET" ]; then
  DAYBLOOM_SECRET="$(openssl rand -hex 32)"
  /usr/bin/sed -i '' "s|^DAYBLOOM_SECRET=.*|DAYBLOOM_SECRET=$DAYBLOOM_SECRET|" "$ENV_FILE"; CHANGED=1
fi
if [ -z "$DAYBLOOM_INGEST_TOKEN" ]; then
  DAYBLOOM_INGEST_TOKEN="$(openssl rand -hex 24)"
  /usr/bin/sed -i '' "s|^DAYBLOOM_INGEST_TOKEN=.*|DAYBLOOM_INGEST_TOKEN=$DAYBLOOM_INGEST_TOKEN|" "$ENV_FILE"; CHANGED=1
fi
[ "$CHANGED" = "1" ] && echo "🔑 Generated your SECRET and INGEST_TOKEN (saved into daybloom.env)."
PORT="${PORT:-3000}"

mkdir -p "$LOG_DIR" "$DATA_DIR" "$HOME/Library/LaunchAgents"

# Write the LaunchAgent plist.
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$SERVER</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DAYBLOOM_PASSCODE</key><string>$DAYBLOOM_PASSCODE</string>
    <key>DAYBLOOM_SECRET</key><string>$DAYBLOOM_SECRET</string>
    <key>DAYBLOOM_INGEST_TOKEN</key><string>$DAYBLOOM_INGEST_TOKEN</string>
    <key>ANTHROPIC_API_KEY</key><string>$ANTHROPIC_API_KEY</string>
    <key>DATA_DIR</key><string>$DATA_DIR</string>
    <key>HOST</key><string>127.0.0.1</string>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/daybloom.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/daybloom.err.log</string>
</dict>
</plist>
PLIST
chmod 600 "$PLIST"

# (Re)load it.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo ""
echo "✅ Daybloom is installed and running at http://127.0.0.1:$PORT"
echo "   Logs:   $LOG_DIR/daybloom.log"
echo "   Data:   $DATA_DIR"
echo "   Your Apple Health token is in daybloom.env (DAYBLOOM_INGEST_TOKEN)."
echo ""
echo "Next: run  tailscale serve --bg --https=443 http://localhost:$PORT  to reach it from your phone."
