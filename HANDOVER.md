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

## Phone app (iOS + Android), started 2026-09-15
- **Code:** `app/`, Expo SDK 57 (React Native 0.86, expo-router, TypeScript). The plan is in `docs/mobile-app-plan.md`.
- **Screens:**
  - `welcome`: postcode or location, distance, birth month
  - `(tabs)/index`: Today, with the week strip, filters and sections
  - `(tabs)/map`: native map (Apple on iOS, Google on Android); the web preview shows a note instead
  - `(tabs)/saved`
  - `activity/[id]`: directions, website, call, save, add to calendar (native form), send
  - `settings`: form sheet
- **Data:**
  - Listings: `src/lib/data.ts` loads the tiles from `https://labmasd.github.io/little-days/data/tiles/`. They're cached on the phone and still work offline.
  - Places: parks, playgrounds, libraries, pools, soft play, farms, museums and baby change come live from Overpass. The plan moves them to a pre-built import before launch.
- **No login.** Model: a paid-upfront app with Family Sharing (see the plan).
- **Run:**
  - `cd app && npx expo start --web` for the browser preview
  - `npx expo run:ios` for the iPhone simulator (needs Xcode + CocoaPods, both installed)
- **Store builds:** `eas.json` has development, preview and production profiles. It needs an Expo account (`npx eas-cli login`), an Apple Developer account and a Google Play account.
- **Database design:** `supabase/migrations/0001_init.sql`, for when listings move off static tiles.
- **UK data:**
  - `data/uk-research/*.json` come from national sources (family hubs, class chains, cinemas, libraries and so on), with crawl scripts in `data/uk-research/scripts/`.
  - `node scripts/merge.mjs` builds `data/tiles/`.
  - `tier`: timetable = day and time known; venue = runs there, times on the provider's site; place = open hours.
- **Xcode 26.3 patch:** `app/patches/expo-modules-jsi+57.1.0.patch` removes `SWIFT_RETURNS_RETAINED` from two `RuntimeScheduler` constructors, which the Xcode 26.3 compiler rejects. It re-applies on `npm install` via `postinstall: patch-package`. Delete the patch once Expo ships a fix.
- **Reminders:** `app/src/lib/reminders.ts`. The activity page's "Remind me" schedules a local notification an hour before, or 15 minutes if the class is sooner. Tapping it opens the class.
- **Prebuilt places:** `.github/workflows/places.yml` runs monthly on GitHub (it can also be started by hand). It downloads the Geofabrik UK extract and filters it with osmium, then `scripts/build-places.mjs` writes `data/places/` tiles. The app and web load those and fall back to live Overpass if the tiles are missing.
- **Cloud builds (EAS):** the project is `@labmasd/little-days`.
  - Development simulator build: `cd app && npx eas-cli build --profile development --platform ios`
  - Run it: install the build on the simulator, then `npx expo start --dev-client`.
- **Store drafts:** `docs/store-listing.md` (App Store and Play text, privacy labels, screenshots list, privacy policy draft) and `docs/partner-emails.md` (Babyballet, Happity).
