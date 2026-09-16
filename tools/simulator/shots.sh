#!/bin/bash
# App Store screenshots, without tapping the simulator.
#
# Seeds the app's saved settings (postcode, distance, one child) straight into its storage,
# then opens each screen with a deep link and captures it at 1320 x 2868, the 6.9" size Apple asks for.
#
#   tools/simulator/shots.sh [output-folder]
#
# Needs the release ("screenshots" profile) build installed on the "Doddily Screenshots" simulator.
set -e

UDID=${UDID:-$(xcrun simctl list devices available | grep "Doddily Screenshots" | grep -oE "[0-9A-F-]{36}" | head -1)}
BUNDLE=app.doddily
OUT=${1:-$HOME/Downloads/doddily-screenshots}
[ -n "$UDID" ] || { echo "No 'Doddily Screenshots' simulator found."; exit 1; }
mkdir -p "$OUT"

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" >/dev/null 2>&1 || true

# A clean status bar: full signal, full battery, and 9:41, the time Apple uses in its own shots.
xcrun simctl status_bar "$UDID" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100

# Settings the app would have saved after the welcome screen: Hackney, 3 miles, one toddler.
seed() {
  # Newer versions of async-storage keep the file under Application Support/<bundle id>;
  # older ones used the container root. Write both, so it works either way.
  local root; root=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
  local dirs=("$root/Library/Application Support/$BUNDLE/RCTAsyncLocalStorage_V1" "$root/RCTAsyncLocalStorage_V1")
  mkdir -p "${dirs[@]}"
  node - "${dirs[@]}" <<'NODE'
const fs = require('fs'), path = require('path');
const dirs = process.argv.slice(2);
const settings = {
  loc: { lat: 51.545033, lng: -0.056407, name: 'E8 1EA', postcode: 'E8 1EA' },
  radius: 3, group: 'all', onboarded: true, name: '',
  kids: [{ id: 'k1', name: 'Ada', band: '1to2' }],
  mapApp: 'apple',
};
const manifest = JSON.stringify({
  'ld:settings:v1': JSON.stringify(settings),
  'ld:saved:v1': JSON.stringify({}),
});
for (const dir of dirs) fs.writeFileSync(path.join(dir, 'manifest.json'), manifest);
console.log('seeded a 14-month-old and E8 1EA');
NODE
}

shot() { # shot <name> <seconds to settle>
  sleep "${2:-6}"
  xcrun simctl io "$UDID" screenshot --type png "$OUT/$1.png" >/dev/null
  echo "captured $1"
}

# Opening a link shows iOS's "Open in Doddily?" prompt, so confirm it with a tap.
# The tap helper aims at the frontmost Simulator window, so bring this device's window forward first.
TAP=$(dirname "$0")/tap
open_link() {
  open -a Simulator --args -CurrentDeviceUDID "$UDID" >/dev/null 2>&1
  sleep 1
  xcrun simctl openurl "$UDID" "littledays://$1" >/dev/null
  sleep 2
  "$TAP" 0.67 0.54 >/dev/null 2>&1 || true   # the "Open" button
}

xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
xcrun simctl launch "$UDID" $BUNDLE >/dev/null   # first launch creates the container
sleep 4
xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
seed

xcrun simctl launch "$UDID" $BUNDLE >/dev/null
shot 1-today 12          # the intro plays first, so give it longer
open_link "/map";   shot 2-map 8
open_link "/saved"; shot 3-saved 5
open_link "/you";   shot 4-you 5
open_link "/";      shot 5-today-week 6

xcrun simctl status_bar "$UDID" clear
echo "Screenshots in $OUT"
