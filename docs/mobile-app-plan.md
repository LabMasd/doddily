# Little Days: iPhone and Android app plan

Started 2026-09-15. The web version (labmasd.github.io/little-days) is the working prototype. This plan turns it into a store app for the UK.

## What the app is
Parents open it, see baby activities near them today, and go. Every card answers: when, where, how far, how much, do I need to book, is it right for my baby's age.

## Decisions (defaults chosen; change any of them)
| Area | Choice | Why |
|---|---|---|
| App framework | **Expo (React Native, TypeScript)** with expo-router | One codebase for iOS and Android, genuinely native. Store builds happen in the cloud (EAS), so no Android Studio is needed. |
| Maps | **react-native-maps**: Apple Maps on iOS, Google Maps on Android | Free on phones. OpenStreetMap's own tile servers don't allow app traffic. |
| Backend | **Static location tiles for now**; Supabase (open source Postgres + PostGIS) only if the data outgrows tiles | Tiles need no server and work offline. The schema is ready if "near me" queries or anonymous "report wrong info" need a database. No sign-in either way. |
| Data refresh | Claude Code `/little-days refresh` and research runs, imported into Supabase by script | No servers or API keys; the same workflow as now. |
| Parks, playgrounds, pools, soft play | Built from an OpenStreetMap UK extract **by a monthly GitHub Action** (cloud, not your Mac), imported into Supabase | The public Overpass API isn't meant for app traffic. |
| Accounts | **No login at all.** Saved items stay on the phone. | "Buy, download, use". Apple and Google handle payment. The simplest privacy labels ("Data not collected"). |
| Business model | **Paid upfront (e.g. £2.99)** to start, with Family Sharing on. Alternative: free download plus a one-time unlock. | No purchase code or accounts; one purchase covers both parents. Price is a store setting and can change later. |
| Data hosting | GitHub Pages for now → **Cloudflare Pages/R2** before a paid launch | GitHub Pages isn't meant to back a commercial product; Cloudflare's free tier covers static tiles comfortably. |
| Name | "Little Days" (working name) | Check App Store, Play and trademarks before launch. |

## Phases

### Phase 0: you (accounts and admin)
- [ ] Apple Developer Program: £79/yr (developer.apple.com/programs)
- [ ] Google Play Console: $25 once
- [ ] Check the name "Little Days" is free on both stores, then pick a fallback
- [ ] Supabase account (free), or say the word and I'll plan self-hosting on the home server
- [ ] A contact email for the store listing and privacy policy

### Phase 1: data backend (I can do most of this now)
- [x] UK-wide research into `data/uk-research/*.json` (9 national sources, running)
- [x] Merge into location tiles (`scripts/merge.mjs`)
- [x] Supabase schema (written, not deployed): `activities` (PostGIS point, sessions, tier, source, confidence, checked date), `places` (OSM), `reports`, `saved` (`supabase/migrations/0001_init.sql`)
- [x] `activities_near(lat, lng, radius, day)` query function (in the migration)
- [ ] Import script: research JSON → Supabase (upsert by id, keep manual fixes)
- [ ] GitHub Action: monthly OSM extract → playgrounds, parks, libraries, pools, soft play, farms, museums, baby change → Supabase

### Phase 2: app MVP (Expo): screens built 2026-09-15, verified in web preview; iOS simulator build in progress
Screens:
1. **Welcome:** "Use my location" or type a postcode; optional baby birth month. Location is only used to find things nearby.
2. **Today** (home): the week strip, sessions in time order, "Classes nearby, check times", "Go any time" places. Pull to refresh.
3. **Filters** (bottom sheet): category chips; Free, No booking, Rainy day, Right for her age; distance slider.
4. **Activity:** details, Directions (Apple/Google Maps), Book or website, Call, Add to calendar (native), Share, Save, "Something wrong?".
5. **Map:** native map with clustered pins, a distance circle, and a tap-through to details.
6. **Saved:** list; a reminder toggle ("Remind me 1 hour before").

Built in: offline cache of the last area, local notifications for reminders, the same visual system as the web (milk and navy, marigold accent, Bricolage Grotesque + Figtree), iPhone and Android back-gesture behaviour, and accessibility (Dynamic Type, VoiceOver labels).

### Phase 3: trust
- No accounts. Family Sharing (Apple) and the Play family library let both parents use one purchase.
- "Something wrong?" sends an anonymous report (listing id + reason) to a tiny endpoint, e.g. a Cloudflare Worker or a Supabase insert with no login. `/little-days refresh` works through the reports first.
- A "Last checked" date on every card; low-confidence items marked

### Phase 4: store release
- EAS Build → TestFlight (iPhone) + Play internal testing; Vicky is tester #1
- Privacy policy page (location stays on the phone apart from the nearby query, no tracking, no ads) and App Store privacy labels
- Store listing: screenshots, description, category **Lifestyle** or **Parenting**. It's for parents, so **not** the Kids category.
- Review risk: Apple rejects "just a website in an app" (guideline 4.2). A native map, calendar, reminders and offline mode avoid that.

### Phase 5: after launch
- Provider submissions ("Add your class" form → reviewed before it goes live)
- Partnerships: Happity (data feed or booking commission), class franchises (official feeds)
- Coverage dashboard: timetabled classes per area, oldest data, open reports

## Data rights (important for a public app)
- **What we store:** only facts (name, venue, postcode, days and times, price, ages) plus a link back to the provider's own booking page. No copied descriptions or photos.
- **How we collect it:** respect robots.txt and blocks; no scraping of aggregators' databases (e.g. Happity). Use partnerships instead.
- **Takedowns:** a clear contact route for providers to correct or remove a listing.

## Costs to start
| Item | Cost |
|---|---|
| Apple | £79/yr |
| Google | $25 once |
| Supabase | Free tier (500 MB database is plenty for UK listings); Pro is $25/mo if it grows |
| EAS builds | Free tier (limited builds per month) |
| Maps on phones | Free |

## Repo layout
```
little-days/
  index.html, app.js …    web prototype (GitHub Pages)
  app/                    Expo app (iOS + Android)
  supabase/migrations/    database schema
  scripts/                merge + import scripts
  data/                   research + tiles
  docs/                   this plan
```

## Progress log
- **2026-09-15:**
  - **Data:** UK-wide research running (family hubs 3,084, library rhyme times 414, play and farms 320, groups, plus class chains still crawling). The web version now loads location tiles; Leeds confirmed working.
  - **App:** Expo app built with Welcome, Today, Map, Saved, Activity and Settings screens. Type check passes. In the web preview, the flow from postcode to Today to detail to Saved works.
  - **iOS:** needs a local patch for Xcode 26.3 (see HANDOVER).
- **2026-09-15, overnight:**
  - **iOS app running (EAS dev build on the simulator):** Welcome, Today (27 sessions near N16), the Apple Maps map with 64 pins and a 3-mile circle, activity detail, reminders (notification permission, then "Reminder on"), and "Add to calendar" (native pre-filled form) all verified.
  - **Places:** 129,535 UK places are prebuilt monthly by a GitHub Action; web and app load them.
  - **Data:** 8,144 activities; Bloom excluded.
- **Before store submission:**
  - Switch calendar to write-only access (less to review): `writeOnlyCalendarPermission` in the expo-calendar plugin plus `requestCalendarPermissions(true)`. Needs a new native build.
  - A contact email for the privacy policy and store listing
  - Move data hosting to Cloudflare
  - Pre-build OSM places instead of live Overpass
  - Google Maps API key for Android
  - Expo, Apple and Google accounts
