# Doddily (formerly Little Days): handover

Baby activity finder for UK parents. A static PWA with no backend. It opens on a phone and can be added to the home screen.

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

## Home location (keeps the home postcode out of the public repo)
Set the postcode and children in the You tab on each phone. The old `#at=` setup link belonged to the previous web version, which the exported app replaced on 2026-09-15.

## Local
`cd app && npx expo start --web` for the web version. `scripts/build-web.sh` rebuilds the published copy at the repo root.

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
  - Listings: `src/lib/data.ts` loads the tiles from `https://labmasd.github.io/doddily/data/tiles/`. They're cached on the phone and still work offline.
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
- **Reminders:** `app/src/lib/reminders.ts`. The activity page's "Remind me" schedules a local notification an hour before, or 15 minutes if the class is sooner. Tapping it opens the class.
- **Prebuilt places:** `.github/workflows/places.yml` runs monthly on GitHub (it can also be started by hand). It downloads the Geofabrik UK extract and filters it with osmium, then `scripts/build-places.mjs` writes `data/places/` tiles. The app and web load those and fall back to live Overpass if the tiles are missing.
- **Cloud builds (EAS):** the project is `@LabMasd/doddily`.
  - Development simulator build: `cd app && npx eas-cli build --profile development --platform ios`
  - Run it: install the build on the simulator, then `npx expo start --dev-client`.
- **Store drafts:** `docs/store-listing.md` (App Store and Play text, privacy labels, screenshots list, privacy policy draft) and `docs/partner-emails.md` (Babyballet, Happity).
- **iOS builds:**
  - Local builds need Xcode 27; Xcode 26.3 fails inside expo-modules-jsi.
  - Use EAS cloud builds instead. Patching expo-modules-jsi made the cloud build leave out ExpoModulesJSI.framework, so the app crashed on launch. The patch was removed on 2026-09-15.
- **Data exclusions:**
  - Bloom Baby Classes is not included: its robots.txt blocks ClaudeBot and says ai-train=no.
  - Hartbeeps, ODEON, Turtle Tots and most of Babyballet block crawlers.
  - Happity isn't scraped (partner with them instead).

## Where we left off (2026-09-15, branch `app-intro-timetables`)
At home: `git fetch && git switch app-intro-timetables`, then `./scripts/setup.sh`.

- **Today intro:** the flower icon pops in, winds back and sweeps round in the middle of the screen, "Little" and "Days" slide out, and the wordmark rises to the top centre and stays there (`app/src/components/brand-header.tsx`). It plays once per launch and is skipped with Reduce Motion. We decided against a name field and a time-of-day greeting.
- **Flower mark:** breathes when the list is still and spins with the scroll (`app/src/components/brand-mark.tsx`). It's drawn from views, not the ✿ glyph, so it turns about its true centre.
- **Activity buttons:** Directions is full width; Website, Call, Save, Send, Calendar and Remind are icon tiles using `expo-symbols` (already in the dev build).
- **iOS gotcha:** text absolutely positioned inside a small view is squeezed to that view's width on iOS (the web preview hides it). Give it an explicit width.
- **Performance** (iPhone 17 Pro simulator, dev build): the intro averages about 57 fps with 7 slow frames while the list renders; idle holds 60. To do:
  - Build the list after the intro.
  - Move the scroll spin to `useAnimatedScrollHandler`.
  - Add `CADisableMinimumFrameDurationOnPhone` in the next EAS build for 120 Hz.
- **Simulator on a Mac:**
  - Xcode 26.6 is enough to run the EAS dev build.
  - Download the iOS runtime with `xcodebuild -downloadPlatform iOS`, never while Xcode's own window is downloading it.
  - Never delete a duplicate runtime image without `--keep-asset`, or the shared download goes too.
  - `tools/simulator/frametimes.swift` and `fps_report.py` measure frame rate from a `simctl io recordVideo` capture.
- **Timetable gap:** 5,634 listings have no times. `data/uk-research/scripts/timetables/classify-access.mjs` sorts them by website:
  - **Open to read (4,364):** robots.txt allows them.
    - **Baby Sensory** publishes full timetables the old crawler missed. `collect-babysensory.mjs` reads them; partial results are in `collected/babysensory.json`, so re-run it to finish.
    - **Sing and Sign:** the times are behind each area's "See Availability" buttons (checked by hand for area 232). `collect-singandsign.mjs` returned no classes on its first run; fix how it finds and clicks those buttons.
  - **Blocked (1,403):** Water Babies and Moo Music by robots.txt, Tumble Tots' booking system (classforkids.io returns 403), and some councils. Don't work around these. `docs/timetable-captures.html` is the screenshot checklist, also published as the "Little Days Timetable Captures" artifact. Name screenshots by listing code in `~/Desktop/little-days-captures`, then ask Claude to read them in. Ticks are saved per browser.
  - **Still to do:** match collected classes back to listings, then run `node scripts/merge.mjs`.
- **Fix:** step 4 of `.claude/skills/little-days/SKILL.md` suggests the `r.jina.ai` proxy for blocked sites, which contradicts the CLAUDE.md rules. Remove that line.
