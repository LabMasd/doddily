# Doddily — where we left off

Saved 17 September 2026, just before updating macOS and Xcode.
To carry on: open Claude Code and say **"pick up Doddily"** — it has the same notes in its memory.

## 1. Apple
- Version 1.0 is **waiting for a reviewer**. It shows as "Rejected / Unresolved issues" — that is only because Apple asked for information (Guideline 2.1), not because anything was wrong.
- You replied with the screen recording on 16 Sept at 21:03. Nothing more to do. Replies usually get read in 1–2 working days. **Apple emails you when it changes.**
- It is set to **release automatically** when approved (UK only, £2.99).
- When approved: tell Claude, so the website can be switched on for Google (it is hidden on purpose until then).

## 2. The next version (1.1) — BUILDING NOW (17 Sept, afternoon)
**Plan changed:** instead of waiting for Apple, we are swapping the new build into the submission, because it fixes the missing privacy link and is the version you want on sale.
- Cloud build started: https://expo.dev/accounts/labmasd/projects/little-days/builds/2e756b51-d6da-42c5-8539-d406636223c1
- When it finishes Claude uploads it to App Store Connect (harmless on its own).
- **Then you:** install 1.1 from TestFlight, test it, and screen-record the run (Home screen → open app → E8 1EA → a class → Map → Saved → You; keyboard predictions OFF; don't tap Send).
- **Then Claude:** swaps build 8 for the new build and renames the version to 1.1. **You** post a short message in the Apple thread with the new recording, and it is resubmitted.
- If your Mac restarted before this finished: say "pick up Doddily" — the build keeps running in the cloud regardless.

Two changes, already written and saved on GitHub:
- asks for an **age group** (Newborns, Babies, Toddlers…) instead of a birth month
- **Privacy / Website / Contact links** in the You tab (Apple requires the privacy link inside the app)

To do: build it, **test it on your phone through TestFlight**, then send it to Apple.
Also worth 30 seconds: in App Store Connect → App Privacy, it should say *Location — app functionality — not linked to you — no tracking*.

## 3. After the Mac update
1. Update **macOS to 27 first**, then **Xcode 27** from the App Store (Xcode 27 will not install on macOS 15).
2. Open Xcode once and let it finish installing its components.
3. Check After Effects, your panels and LucidLink still work.
4. Then ask Claude to **"build Doddily 1.1"** — with Xcode 27 it can build on this Mac, free and without the queue. (Until then, the cloud build still works: about 20 minutes.)

## 4. What is live
- Website: https://doddily.app
- Post maker for Vicky: https://doddily.app/make/ — add to her iPhone Home Screen. Pick a template, type, **Share or save image**. Hidden from Google, but anyone with the link could open it.
- Figma file (brand, website, app screens, all posts — editable): https://www.figma.com/design/I6ucsZ9nm0GfVU29h9wqRo/Doddily
- Social playbook: https://claude.ai/artifact/16bogm3RQfzLQKFdq6NvNV
- Instagram: @doddily.app

## 5. Waiting for your decision
1. **Story images:** the 22 we made have three fake progress lines at the top (Instagram adds its own). Re-render them without? (Quick.)
2. **Post maker password:** add a passphrase so only you and Vicky can open it?
3. **Launch day:** leave "release automatically", or switch to manual so you choose the day?
4. **"kids (up to 8yrs)"** on the website: the app only goes up to 5 today. Keep or drop?

## 6. Where things are on this Mac
- App and tools: `~/little-days` (GitHub: LabMasd/doddily, branch `app-intro-timetables`)
- Website: `~/doddily-site` (GitHub: LabMasd/doddily-site)
- Finished posts: `~/Downloads/doddily-posts` (in week folders, with `preview.html`)
- Apple reply and recording script: `~/little-days/docs/review-reply.md`
- The recording you sent Apple: `~/Downloads/doddily-review-recording-v3.mp4`

Everything is committed and pushed — nothing depends on this Mac surviving the update.
