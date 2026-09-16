# Apple review reply — Guideline 2.1, Information Needed (16 Sep 2026)

Submission 9ce7db3f-70ed-44d9-822e-dfa3abc9634c, version 1.0, build 8.
This is the routine first-submission check for an account with little review
history. Nothing in the app was faulted.

The written answers are already saved in App Store Connect under
App Review Information → Notes. **Only the screen recording is outstanding, and
it has to be made on a physical device.**

## 1. The recording (Marcos)

Apple asks for a recording from a real iPhone, not the simulator. Record
**build 8** (1.0.0), the build they are reviewing: the You screen shows "Born"
with a month stepper. If it shows age-group chips, that is the development
build ("Little Days"), not this one.

**Start from a clean install.** It wipes the real child's name and home
postcode, and it gives Apple the from-launch flow they asked for.

1. Delete Doddily from the phone (press and hold the icon, Remove App). This
   clears the saved postcode and children.
2. Reinstall from **TestFlight** - the app must be called **Doddily**,
   version 1.0.0 (8). Internal testers get every build automatically.
3. Settings > Control Centre > add **Screen Recording** if it isn't there.
4. Record, in one take, starting on the Home screen:
   - Tap the Doddily icon, so the launch is on camera.
   - Type postcode **E8 1EA**. Do not use "Use where I am" - it shows your home.
   - Add a child: any neutral name, any birth month.
   - Let Today load, scroll the list.
   - Tap a class: times, price, ages, then Directions, the booking page, a
     reminder and add-to-calendar. **Don't tap Call** - it starts a phone call.
   - Back, then **Map**, then **Saved**, then **You** (postcode, distance, the
     Directions app choice, the child).
5. Stop. Keep it under about three minutes. No narration needed.

Nothing to show for accounts, user-generated content or purchases: the app has
none. The reply below says so.

## 2. Reply to paste into Resolution Center

> Thank you for the review.
>
> A screen recording from an iPhone running the latest iOS is attached. It starts
> at app launch and shows the normal flow: entering a postcode, the day's list,
> a session's details, directions, add-to-calendar and a reminder, then the Map,
> Saved and You screens.
>
> The app has no account registration, login or deletion, because it has no
> accounts at all. It has no user-generated content, so there is nothing to
> report or block, and no in-app purchases. It is a paid app with no further
> purchases inside it.
>
> 2. Purpose and audience. Doddily is for parents and carers of children aged
> 0-5 in the United Kingdom. Baby and toddler class timetables are scattered
> across provider websites, council pages and Facebook groups. Doddily collects
> them into one list for the day and place you choose, filtered to your
> children's ages, showing walking distance, price, the booking link, a reminder
> and add-to-calendar.
>
> 3. Setting up and access. No login or credentials are needed. On first launch,
> type the postcode E8 1EA (London) — "Use where I am" finds nothing outside the
> United Kingdom. Today then lists that day's sessions. Tap any session for its
> details. The You tab sets the postcode, the distance and each child's age
> group.
>
> 4. External services. Our own static JSON data on GitHub Pages
> (labmasd.github.io/doddily) for the activity and place listings;
> api.postcodes.io to turn a UK postcode into coordinates; the OpenStreetMap
> Overpass API (overpass-api.de, overpass.kumi.systems) for parks, playgrounds,
> libraries and baby-change points; Apple MapKit for the map; and iOS location,
> write-only calendar access and local notifications. There are no accounts,
> payment processors, analytics, advertising, trackers or AI services.
>
> 5. Regional differences. None. The app is sold in the United Kingdom only and
> behaves the same throughout the UK. Outside the UK there are no listings
> nearby, which is why the postcode above is provided.
>
> 6. Regulated industry or protected material. Neither applies. Listings are
> factual details — time, price, age range, venue — taken from providers' own
> public pages, council and library pages, and public-sector open data, and each
> listing links back to its source. OpenStreetMap data is used under the ODbL
> with attribution.

## 3. After replying

The version stays REJECTED until Apple accepts the reply; replying in
Resolution Center is enough, no new build or resubmission is needed unless they
ask for one.
