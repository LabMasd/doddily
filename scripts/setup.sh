#!/bin/bash
# One-time setup on a new Mac: checks tools and installs the app's packages.
set -euo pipefail
cd "$(dirname "$0")/.."

missing=0
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1 ($2)"; missing=1; }; }
need node "install Node 22: brew install node@22, or nodejs.org"
need git "install the Xcode Command Line Tools: xcode-select --install"
[ "$missing" = 0 ] || exit 1
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || { echo "Node 22 or newer needed (you have $(node -v))"; exit 1; }

echo "Installing app packages…"
(cd app && npm install)

if command -v swiftc >/dev/null 2>&1; then
  swiftc -O -o tools/simulator/tap tools/simulator/tap.swift && echo "Built tools/simulator/tap"
else
  echo "Optional: install Xcode to use the iOS Simulator tools"
fi
chmod +x tools/simulator/sim-install.sh
command -v gh >/dev/null 2>&1 || echo "Optional: brew install gh (to push and run the places workflow)"

echo
echo "Done. Next: START-HERE.md"
