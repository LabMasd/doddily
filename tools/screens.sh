#!/bin/bash
# Fresh screens of the app in one go, for the App Store, socials, the website and motion work.
#
#   tools/screens.sh [output folder]
#
# It builds the app's web version from the current code, renders each screen with Chrome at 1320 x 2868
# (an iPhone 17 Pro Max at three pixels per point) with a 9:41 status bar, then makes the framed store
# pages with their captions. Nothing is uploaded anywhere. Needs Google Chrome; no simulator, no build service.
#
#   <output>/screens   the bare screens: 1-today, 2-map, 3-saved, 4-you, 5-today-week, 6-calendar, 7-detail
#   <output>/store     the same in a drawn iPhone with a headline: promo-today, promo-map, promo-you, promo-calendar
#
# To add a screen, add a line to tools/simulator/web-shots.mjs; to caption it, add it to PAGES in promo.mjs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HOME/Downloads/doddily-screens-$(date +%F)}"
n=2; BASE="$OUT"; while [ -e "$OUT" ]; do OUT="$BASE-v$n"; n=$((n + 1)); done   # never write over an earlier set
PORT=8267
TMP="$(mktemp -d)"
trap 'kill $SERVER 2>/dev/null || true; wait $SERVER 2>/dev/null || true; rm -rf "$TMP"' EXIT

echo "Building the app's web version…"
(cd "$ROOT/app" && DODDILY_WEB=1 npx expo export -p web --output-dir "$TMP/web/doddily" >/dev/null 2>&1)
node "$ROOT/tools/simulator/serve-spa.mjs" "$TMP/web" $PORT >/dev/null 2>&1 &
SERVER=$!
sleep 1
node "$ROOT/tools/simulator/web-shots.mjs" "http://127.0.0.1:$PORT/doddily" "$OUT/screens"
node "$ROOT/tools/simulator/promo.mjs" "$OUT/screens" "$OUT/store"
echo "Done: $OUT"
open -R "$OUT/store/promo-today.png" 2>/dev/null || true
