# Little Days

A baby activity finder for UK parents: a web prototype (GitHub Pages) plus an Expo iPhone and Android app heading to the stores as a paid app with no login.

**Read first:**
- `START-HERE.md`: setting up on a new machine
- `HANDOVER.md`: how everything works
- `docs/mobile-app-plan.md`: decisions, checklist and progress
- `docs/store-listing.md` and `docs/partner-emails.md`: drafts

## Layout
- **Web version:** `index.html`, `app.js`, `sw.js`. Live at https://labmasd.github.io/little-days/, and pushing to `main` publishes it.
- **App:** `app/`, Expo SDK 57 (expo-router, TypeScript). Follow `app/AGENTS.md`: check the Expo v57 docs or type definitions before using an API.
- **Data:**
  - `data/research/`: hand-checked local research
  - `data/uk-research/`: UK national sources, with their crawlers in `scripts/`
  - `data/tiles/`: built by `node scripts/merge.mjs`
  - `data/places/`: OpenStreetMap places, rebuilt monthly by `.github/workflows/places.yml`. Don't edit by hand.
- **Simulator tools:** `tools/simulator/` (installing EAS builds, tapping the iOS Simulator).
- **Search command:** `.claude/skills/little-days/`, for `/little-days <what> near <postcode>` and `/little-days refresh`.

## Rules
- **Collecting data:** store facts plus a link back to the provider only. Respect robots.txt and blocks, and never work around them (no proxies, no pretending to be a browser).
- **Excluded sources:**
  - Happity: partner with them instead of scraping.
  - Bloom Baby Classes: its robots.txt blocks ClaudeBot.
- **Personal data:** no home postcodes or family names in the repo. The home location is set on each phone with the setup link `#at=POSTCODE`.
- **Privacy:** no login, tracking or ads. On iOS the calendar uses add-only access through the system form in `expo-calendar/legacy`.
- **iOS builds:** use EAS cloud builds (`cd app && npx eas-cli build --profile development --platform ios`). Expo 57 needs Xcode 27 to build locally. Don't patch `expo-modules-jsi`: that left `ExpoModulesJSI.framework` out of the app, and it crashed on launch.
- **Filters:** the list always opens on "Everything", so don't save the chosen category.
- **Keep web and app in sync:** categories and groups live in both `app.js` (`CATS`/`GROUPS`) and `app/src/lib/categories.ts`.
- **Design:** plain, short, sentence-case copy. Tokens are in `app/src/constants/theme.ts` (milk, navy and a pastel purple accent; Bricolage Grotesque + Figtree).
