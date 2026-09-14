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

## Searching and refreshing (Claude Code)
No local model or API key. In Claude Code:
- `/little-days <what> [near <postcode>] [<n> miles]`: searches the web, checks the providers' pages, prints cards in the terminal, then asks whether to add them to the app.
- `/little-days refresh`: re-checks the saved timetables, then updates and publishes.
- The command is a user skill at `~/.claude/skills/little-days/SKILL.md`.
