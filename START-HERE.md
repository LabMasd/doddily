# Start here (new machine)

Everything lives in GitHub (`LabMasd/doddily`). There are no API keys or passwords to copy.

## 1. Get the code
```bash
git clone https://github.com/LabMasd/doddily.git
cd little-days
./scripts/setup.sh
```
The repo is public, so cloning needs no login. To push changes, log in to GitHub as LabMasd (`gh auth login`).

## 2. See it working
- **Web version:** `cd app && npx expo start --web`. To publish it, run `scripts/build-web.sh`, commit, and merge to `main`.
- **App in the browser:** `cd app && npx expo start --web`. Maps, calendar and reminders only work on a phone or simulator.

## 3. iPhone simulator
You don't need Xcode 27 or a new cloud build to see the app. The latest development build runs in the App Store Xcode (tested with Xcode 26.6 on 2026-09-15), and app code loads from the dev server, so a new build is only needed when native modules or `app.json` change.

1. **Xcode:** install it from the App Store, open it once, click **Agree** and let it install its components (or run `sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch`).
2. **iPhone simulator** (8.5 GB): tick **iOS** in Xcode's first-launch window, or run `xcodebuild -downloadPlatform iOS`. Do one or the other, not both at once. If an image shows as "Unusable - Duplicate", leave it, or delete it with `xcrun simctl runtime delete <id> --keep-asset`. Without `--keep-asset`, the shared download is deleted too.
3. **Run the app:**
   ```bash
   cd app
   npx expo start --dev-client    # leave this running in its own tab
   ../tools/simulator/sim-install.sh https://expo.dev/artifacts/eas/nl4s2Gt7WfZiF0ibfcoewSuOG2d19K5uK-0-TbxIOuo.tar.gz "iPhone 17 Pro"
   ```
   That link is the latest development build (from commit 37f6af9) and downloads without a login. `npx eas-cli build:list --platform ios` lists newer builds (Expo account: labmasd).
4. When iOS asks "Open in Doddily?" (older builds say "Little Days"), tap **Open**. The first time, Expo shows a developer-menu notice; tap **Continue**.

- **Replay the intro:** tap the blue gear button, then **Reload**.
- **New native build** (only when native modules change): `cd app && npx eas-cli build --profile development --platform ios` (about 12 minutes). Building on the Mac itself needs Xcode 27.

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
