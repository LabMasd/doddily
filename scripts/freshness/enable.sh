#!/bin/sh
# Run once with sudo on the home server: installs the weekly Doddily freshness timer and starts the first scan.
# Usage: sudo sh ~/little-days/scripts/freshness/enable.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$DIR/systemd/doddily-freshness.service" "$DIR/systemd/doddily-freshness.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now doddily-freshness.timer
systemctl start --no-block doddily-freshness.service
echo "Installed. Weekly timer: Sundays 05:00. First scan started now (about an hour); the digest arrives on Telegram."
echo "Follow it:  journalctl -u doddily-freshness -f"
echo "Pause:      touch $DIR/PAUSED      Remove: sudo systemctl disable --now doddily-freshness.timer"
