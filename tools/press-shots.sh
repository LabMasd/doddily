#!/bin/bash
# The press kit's screenshots (doddily.app/press) from a set made by tools/screens.sh.
#
#   tools/press-shots.sh <screens folder> [press folder]
#
# For each screen it writes, into the website's press folder:
#   assets/screenshots/<name>.jpg                  the bare screen, 1320 x 2868
#   assets/screenshots/framed/<name>-framed.jpg    the screen on milk in a thin ink outline, 1290 x 2796
#   thumbs/<name>.jpg                              the framed one at 560 px wide, for the page
# Needs ImageMagick. Nothing is uploaded; commit and push the website to publish.
set -euo pipefail
SRC="${1:?Give the screens folder, e.g. ~/Downloads/doddily-screens-2026-10-06/screens}"
PRESS="${2:-$HOME/doddily-site/press}"
MILK='#F4F6F8'; INK='#1E2536'
W=1130; H=2455; X=80; Y=170; R=132          # the phone on the 1290 x 2796 page, and its corner
mkdir -p "$PRESS/assets/screenshots/framed" "$PRESS/thumbs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
magick -size ${W}x${H} xc:none -fill white -draw "roundrectangle 0,0 $((W-1)),$((H-1)) $R,$R" "$TMP/mask.png"
for pair in 1-today:today 2-map:map 7-detail:detail 3-saved:saved 4-you:you 6-calendar:calendar 5-today-week:week; do
  from="${pair%%:*}"; name="${pair##*:}"
  [ -f "$SRC/$from.png" ] || { echo "missing $from.png, skipped"; continue; }
  magick "$SRC/$from.png" -quality 88 "$PRESS/assets/screenshots/$name.jpg"
  magick "$SRC/$from.png" -resize ${W}x${H}! "$TMP/mask.png" -alpha off -compose CopyOpacity -composite "$TMP/screen.png"
  magick -size 1290x2796 "xc:$MILK" "$TMP/screen.png" -geometry +$X+$Y -compose Over -composite \
    -fill none -stroke "$INK" -strokewidth 4 -draw "roundrectangle $X,$Y $((X+W-1)),$((Y+H-1)) $R,$R" \
    -quality 88 "$PRESS/assets/screenshots/framed/$name-framed.jpg"
  magick "$PRESS/assets/screenshots/framed/$name-framed.jpg" -resize 560x -quality 84 "$PRESS/thumbs/$name.jpg"
  echo "made $name"
done
