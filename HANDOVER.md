# Little Days — handover

Baby activity finder for Vicky (and Marigold). A static PWA with no backend. It opens on a phone and can be added to the home screen.

## What it does
- **Location:** a postcode or "use where I am", plus a distance slider from 0.5 to 10 miles. Settings are saved on the phone only (localStorage `littledays-v1`).
- **Days:** the week strip shows Today through +6 days, or All. Picking a day shows that weekday's sessions in time order, then "Go any time" places, then "Earlier today".
- **Filters:** single-select groups (Rhymes & stay-and-play, Classes, Swim, Cinema, Days out, Parks & playgrounds, Baby change) and toggles (Free, No booking, Rainy day, Right for N months).
- **Cards:** open to show details, Directions (Apple Maps on iOS, walking), Website/Book, Call, Save ♥, Add to calendar (.ics) and Send (share sheet).
- **Map:** a Leaflet map with OpenStreetMap tiles. On phones there's a tab bar; on desktop the map sits beside the list.

## Data
- `data/activities.json` holds the classes, groups and outings. It's built by `node scripts/merge.mjs` from `data/research/*.json`. Research files follow the schema in `scripts/merge.mjs`: name, category, venue, address, postcode, lat/lng, sessions `[{day,start,end}]`, age months, price, free, booking, indoor, url, confidence.
- Parks, playgrounds, libraries and baby-change toilets load live from OpenStreetMap Overpass in the browser. The query is capped at 5 miles and cached for 7 days per location.
- Timetables go stale. The footer shows the "checked" date, and items with `confidence: "low"` show a "Check times" tag.

## Refreshing the timetable
Re-run the research (Claude Code, web search) into `data/research/*.json`, then `node scripts/merge.mjs`, then commit and push.

## Setup link (keeps the home postcode out of the public repo)
`https://labmasd.github.io/little-days/#at=<POSTCODE>&r=3&born=YYYY-MM`. It saves the settings on that phone, then clears the address bar.

## Local
`python3 -m http.server 8230` in this folder → http://127.0.0.1:8230

## Live search from the terminal (local, free)
`littledays "baby swimming"` searches the web and reads the pages with a local model, then prints cards as it finds them.
- **Pieces:** SearXNG (Docker container `littledays-searxng`, 127.0.0.1:8888, settings in `search/searxng/`) finds pages. The script fetches each page and keeps the timetable-looking lines. Ollama (`qwen3:8b`, brew service on :11434) extracts cards to JSON with a schema. postcodes.io places them and drops anything outside the radius.
- **Options:** `--near E17`, `-r 5`, `-p 20` (pages to read), `-m qwen3:14b`, `--json`, `--add`. `--add` saves to `data/research/cli-DATE.json` and runs the merge; then commit and push to publish.
- **Local config:** home postcode and default radius live in `~/.littledays.json`, not in the repo.
- **Confidence:** found items are `medium` when the postcode and time were found, `low` otherwise.
- **If it fails:**
  - "Ollama is not running": run `brew services start ollama`.
  - "SearXNG is not running": open OrbStack, then `docker start littledays-searxng`.
