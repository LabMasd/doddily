# Timetable collectors

Fill in class times for listings saved as tier `venue` ("Times on their site").

Rules (from CLAUDE.md): only read pages that robots.txt allows, identify as LittleDays, keep at least 1.5 s between pages, skip images, and keep class facts only (no teacher or staff names). Never work around a block. Blocked sites go on the screenshot checklist instead.

## Setup
```bash
cd data/uk-research/scripts/timetables
npm install
npx playwright install chromium
```

## Scripts
- `classify-access.mjs`: sorts every no-times listing by website into robots-blocked, refuses bots (401/403/429) or open. Writes `../../collected/manual-list.json` (the blocked ones, for the screenshot checklist).
- `collect-babysensory.mjs`: reads each Baby Sensory branch `/timetable` table (venue, postcode, day, term dates, times, ages, prices, bookable or waitlist). Writes `../../collected/babysensory.json`.
- `collect-singandsign.mjs`: opens each bookmyclass area page, clicks each age stage's "See Availability" and reads the class table. Writes `../../collected/singandsign.json`.

Results in `collected/` still need matching back to listings and merging (`node scripts/merge.mjs`).
