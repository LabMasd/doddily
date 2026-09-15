#!/bin/bash
# sim-install.sh <eas-build-artifact-url> [simulator name]
# Downloads an EAS iOS simulator build, installs it and opens it on the local dev server.
# Find the artifact URL on expo.dev → little-days → Builds, or: npx eas-cli build:list --platform ios
set -euo pipefail

URL="${1:?Usage: sim-install.sh <artifact-url> [simulator name]}"
NAME="${2:-}"
BUNDLE=cc.masd.littledays

if [ -n "$NAME" ]; then
  U=$(xcrun simctl list devices | grep -F "$NAME (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
  [ -n "$U" ] || { echo "No simulator called \"$NAME\". List them with: xcrun simctl list devices"; exit 1; }
  xcrun simctl boot "$U" 2>/dev/null || true
else
  U=booted
fi
open -a Simulator

TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/build.tar.gz" "$URL"
tar -xzf "$TMP/build.tar.gz" -C "$TMP"
APP=$(find "$TMP" -maxdepth 2 -name "*.app" | head -1)
[ -d "$APP/Frameworks/ExpoModulesJSI.framework" ] || echo "Warning: ExpoModulesJSI.framework missing, so this build will crash on launch."

xcrun simctl uninstall "$U" "$BUNDLE" 2>/dev/null || true
xcrun simctl install "$U" "$APP"
xcrun simctl openurl "$U" "exp+little-days://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
echo "Installed. Start the dev server (cd app && npx expo start --dev-client) and tap Open when iOS asks."
