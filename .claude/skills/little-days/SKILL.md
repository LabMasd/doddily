---
name: little-days
description: Search the web for baby activities (classes, groups, swims, cinema, outings) near a postcode and show them as tidy cards in the terminal, optionally adding them to the Little Days app; or refresh the app's saved timetables. Use for "/little-days <what> [near <postcode>] [<n> miles]" or "/little-days refresh".
---

# Little Days: search and refresh

Little Days is a UK baby activity app. The code is in `~/little-days`; it's live at https://labmasd.github.io/little-days/ and published from the GitHub repo LabMasd/little-days (branch main).
Activity data: `data/research/*.json`. `node scripts/merge.mjs` merges it into `data/activities.json`. The field list is in `scripts/merge.mjs` and the existing research files.

Defaults: ask for a postcode if none is given (never store a home postcode in the repo). Radius **3 miles**. Babies 0–18 months with a parent.

## Search mode: `/little-days <what> [near <place>] [<n> miles] [<when>]`

1. **Understand the request:** what they want, where (ask if not given), radius (default 3), and any day or time ("Thursday", "tomorrow morning", "weekends").
2. **Locate:** `curl -s https://api.postcodes.io/postcodes/<PC>`, or `/outcodes/<OUT>` for a partial postcode such as E17. Note the ward and borough names for searching.
3. **Search:** run 3–5 WebSearch queries that use the area names, for example `baby swimming lessons Walthamstow`, `<borough> library rhyme time`, `<provider> <area> timetable`. Good sources, in order:
   - provider timetable pages
   - council, library and family-hub pages
   - Happity listings
   - Eventbrite
   - cinema and venue sites

   Skip social media and forums except as leads.
4. **Check before trusting:** WebFetch the actual page for each promising result to get the day, start/end time, price, ages, booking type and venue postcode.
   - If a site blocks fetching, try `https://r.jina.ai/<url>`.
   - Never invent a time or price. If you can't confirm one, keep the item but set `confidence: "low"` and say why.
   - For more than about 8 pages, fan out with parallel general-purpose subagents.
5. **Place each result:** geocode the venue postcodes with postcodes.io, work out the distance from the search location, and drop anything outside the radius.
6. **Compare with the app:** match against `~/little-days/data/activities.json` by name and venue, and label each result **New**, **Already in app**, or **Changed** (say what changed).
7. **Show cards in the terminal,** sorted by day and time if the user gave a day, otherwise by distance. Keep them short:

   ```
   Baby Sensory: 0.9 mi · New
     Mon 10:00–11:00 · Abney Park Cafe, N16 0LH
     £13 · term booking · 0–13 months
     https://www.babysensory.com/hackney
   ```

   End with one line: how many results, and anything to watch out for (closures, "check times" items).
8. **Offer to add them:** ask "Add the N new ones to the app?" If they say yes:
   - Write the items to `~/little-days/data/research/search-YYYY-MM-DD.json` (append if the file exists). Use the exact schema: name, provider, category (library|stayplay|support|music|sensory|movement|massage|fitness|swim|cinema|museum|farm|softplay|cafe|outdoor), venue, address, postcode, lat, lng, sessions [{day Mon..Sun, start "HH:MM"|null, end}], schedule_note, age_min_months, age_max_months, price, free, booking (drop-in|book|term), indoor, description (one plain sentence), url, phone, confidence.
   - For **Changed** items, edit the original research file entry instead of adding a duplicate.
   - `cd ~/little-days && node scripts/merge.mjs`, then commit and push. Check the live `data/activities.json` shows the new count (GitHub Pages takes about a minute), then say it's live.

## Refresh mode: `/little-days refresh`

1. Load `data/activities.json`. Prioritise items with `confidence` low or medium, then the rest by nearest first.
2. Re-check each provider page with WebFetch, using parallel subagents in batches of about 15 items. Update times, prices and ages; set `schedule_note` for closures or moves; remove items that have clearly ended; raise confidence when a current page confirms it.
3. Run 3–4 fresh searches around the areas people search most (or the postcode given) for anything new (a new term's timetables, new classes).
4. Write the changes back into the research files, run the merge, commit ("Refresh timetables YYYY-MM-DD"), and push.
5. Report briefly: checked N, updated N, removed N, added N, plus anything parents should know (closures, holiday breaks).

## Tone

Plain and short. Cards first, then one line of notes. The results are for a tired parent.
