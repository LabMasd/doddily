#!/usr/bin/env bash
# Weekly run (systemd timer): check every listing page, then send the digest.
# Writes only data/freshness-state.json and scripts/freshness/out/. No git: see README "Getting results back".
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
if [ -f "$DIR/PAUSED" ]; then echo "freshness: paused ($DIR/PAUSED exists)"; exit 0; fi
cd "$REPO"
node scripts/freshness/check.mjs --quiet
node scripts/freshness/report.mjs --send
