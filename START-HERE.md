# Start here (new machine)

Everything lives in GitHub (`LabMasd/little-days`). There are no API keys or passwords to copy.

## 1. Get the code
```bash
git clone https://github.com/LabMasd/little-days.git
cd little-days
./scripts/setup.sh
```
The repo is public, so cloning needs no login. To push changes, log in to GitHub as LabMasd (`gh auth login`).

## 2. See it working
- **Web version:** `python3 -m http.server 8230`, then open http://127.0.0.1:8230/#at=E83PB&r=3 (any UK postcode works).
- **App in the browser:** `cd app && npx expo start --web`. Maps, calendar and reminders only work on a phone or simulator.

## 3. iPhone simulator
Expo 57 needs **Xcode 27** to build locally. Without it, use Expo's cloud builds:
```bash
cd app
npx eas-cli login                                   # Expo account: labmasd
npx eas-cli build --profile development --platform ios   # ~12 min; or reuse the latest build on expo.dev
../tools/simulator/sim-install.sh <artifact-url> "iPhone 16"
npx expo start --dev-client
```
When iOS asks "Open in Little Days?", tap **Open**. In a new build you'll also see Expo's one-time developer notice.

## 4. Working with Claude Code
Open Claude Code in this folder. `CLAUDE.md` gives it the rules. Commands:
- `/little-days baby swimming near E17`: search the web, show cards, and optionally add them to the app
- `/little-days refresh`: re-check saved timetables, then update and publish

## 5. Data
- Edit or add research in `data/uk-research/*.json` or `data/research/*.json`.
- Run `node scripts/merge.mjs`, then commit and push. The web version updates in about a minute, and the app picks up the new tiles.
- Places (parks, playgrounds and so on): run **Actions → Build places from OpenStreetMap** on GitHub, or wait for the monthly run.

## Still needed before the stores
See **Before store submission** in `docs/mobile-app-plan.md`: Apple and Google developer accounts, a Google Maps key for Android, the price, a contact email, and the final name.
