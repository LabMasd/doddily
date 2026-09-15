#!/bin/sh
# Builds the Expo app for the web and puts it at the repo root, which GitHub Pages serves
# at https://labmasd.github.io/doddily/ (the base path is experiments.baseUrl in app/app.json).
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mktemp -d)
cd "$ROOT/app" && DODDILY_WEB=1 npx expo export -p web --output-dir "$OUT"
cd "$ROOT"

# Remove the previous export, as listed in .web-files, before copying the new one.
if [ -f .web-files ]; then
  while read -r f; do
    case "$f" in ''|.|..|app|data|docs|scripts|brand|tools|supabase|.github|.claude|.git) continue ;; esac
    rm -rf -- "$f"
  done < .web-files
fi

(cd "$OUT" && ls -A) > .web-files
echo 404.html >> .web-files
cp -R "$OUT"/. "$ROOT"/
cp "$OUT/+not-found.html" 404.html
touch .nojekyll # GitHub Pages would otherwise skip the _expo folder
rm -rf "$OUT"
echo "Web app exported to the repo root. Commit and merge to main to publish."
