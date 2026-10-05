# Doddily — where we left off

Saved 5 October 2026, when Doddily was put down for a while.
To carry on: open Claude Code and say **"pick up Doddily"**. It has the same notes in its memory, and the list is on track.lab.

## 1. What is live right now
- **App:** version 1.1 in the UK App Store (£2.99). Nothing from 4–5 October is in it yet.
- **Website:** https://doddily.app, with the new **List a class** form at https://doddily.app/list (button on the home page and on the links page).
- **Review list for the form:** your copy review link with `/classes` on the end. There are no email alerts, so look at it now and then. One TEST entry is in there; press No to clear it.
- **Post 38** ("help us find the hidden classes") is in Victoria's review feed, not approved, not scheduled.

## 2. Three things that only need a click or a command from you
1. **Publish the new listings.** Merge https://github.com/LabMasd/doddily/pull/5. It adds real times for leisure centres (Better, Everyone Active, Places Leisure): 13,572 → 14,295 listings. Every phone picks it up within about 6 hours. No app update needed.
2. **Make the test build of the app (1.2.0).** In Terminal:
   `cd ~/little-days/app && npx eas-cli build --profile production --platform ios --non-interactive`
   About 15 minutes. Then ask Claude to "upload Doddily 1.2.0 to TestFlight". Nothing reaches users; you and Vicky test first.
3. **Switch on the private add page.** In Terminal:
   `ssh -t marcos@homeserver.local 'sudo sh /srv/apps/doddily-add/enable.sh'`
   Then open https://homeserver.tail6d7a62.ts.net:8206 (home network / Tailscale only).

## 3. What is in the 1.2.0 test build (all from Vicky's notes and yours, 4–5 Oct)
- **Fixed:** postcode and distance looked lost in the You tab, and pressing Save reset the distance.
- **Distance:** up to 25 miles; a new install starts at 10; a control on the map to change it.
- **Walk or drive:** near = walk time; a longer walk = walk and drive; over 3 miles = drive only. Directions open in the matching mode.
- **Day bar:** All first, the week Monday to Sunday, a small arrow that drops down a month calendar (four weeks ahead at most).
- **Evening:** opened after 6pm with nothing left today, it starts on tomorrow.
- **Today tapped again:** the list glides back to the top.
- **Filters:** chosen ones first, a round cross that clears them all, chips fade at the ends of the row, more room above the list.
- **Saved classes** refresh when the data changes. Larger text sizes are handled. Search and filters on the map.

**Check on a real phone, because these were only tested in a web preview:** the iPhone map and its distance control, tapping Today to go to the top, larger text sizes.

After testing: either submit 1.2.0 to Apple, or send the same code over the air to people on 1.1 (the app is set up for it). Ask Claude for either.

## 4. Waiting on you and Vicky (no hurry)
- **Post 38:** approve or comment. Decide what to do about classes that have no link.
- **Form wording:** Victoria has not seen the words on the List a class page.
- **Press:** 25 outlets are in Dropbox › 02_Products › Little-Days › *Doddily press list 2026-10-04.md*. The press release still needs the date, Victoria's surname and the children's ages.
- **Provider emails:** share the doc with Victoria, then send.
- **Google Search Console**, **website amends in Figma**, **flyers** (printer and quantities).

## 5. Not started
- **Android.** Needs a Google Play account from you first, and a choice of map.
- **Eventbrite.** Their terms forbid automatic collection. Add those classes by hand, or write to them for permission.
- **Facebook and WhatsApp groups.** Only through people: the form, the private add page, or asking group admins.

## 6. Where everything is
- **App and data:** `~/little-days`, GitHub LabMasd/doddily. Working branch `filters-map-text-size` (pushed). Do not merge that whole branch into main; it also carries an old web export. Data goes in through small pull requests like #5.
- **Website:** `~/doddily-site`, GitHub LabMasd/doddily-site (pushed, live).
- **Form storage and review page:** `~/copy-lab` (on Vercel; this folder has no GitHub copy).
- **Private add page:** `~/doddily-add` and `/srv/apps/doddily-add` on the home server (no GitHub copy).
- **Refresh the leisure-centre times later:** in `~/little-days`, `node data/uk-research/scripts/openactive.mjs`, then `openactive-clean.mjs`, then `node scripts/merge.mjs`. Ask Claude.
