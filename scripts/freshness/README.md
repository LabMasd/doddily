# Freshness checker

Tells you, once a week, which listings' provider pages have changed, gone or started refusing us, so a person or agent can re-read them. It never edits listing data.

## What it does
- `check.mjs` visits every distinct listing url in `data/research/*.json` and `data/uk-research/*.json` (about 5,700 pages on 700 sites, about an hour). It reads robots.txt first and never works around a block, identifies as `LittleDaysBot`, waits at least 1.5 s between requests to one site (longer if robots.txt asks), and sends `If-None-Match` / `If-Modified-Since` so unchanged pages cost nothing.
- It hashes the page's readable text and its schedule tokens (times, weekdays, dates, "term", "cancelled"). It writes only `data/freshness-state.json`: hashes, dates and status codes, no page text.
- Happity, Bloom and social sites are never requested (project rules). OpenActive leisure-centre listings are skipped: re-pull them with `data/uk-research/scripts/openactive.mjs`.
- `report.mjs` writes `out/digest.txt` (the Telegram message) and `out/flagged.json` (every page to re-read with its listings, plus term-time listings with a session on a school holiday in the next 14 days, from `data/uk-research/collected/freshness/term-dates-2026-27.json` if present).
- `node scripts/merge.mjs` copies `verified` (YYYY-MM-DD) and `verifiedStatus` onto each tile listing. The app ignores both for now.

| Status | Meaning | `verified` |
|---|---|---|
| `unchanged` | schedule tokens match the accepted version | today |
| `live` | page is there; it has no listing-specific times (none, or loaded by script) | today |
| `baseline` | first look, nothing to compare yet | not set |
| `changed` | times differ from the accepted version: re-read | kept from last match |
| `dead` | 404/410, DNS gone, or moved (`to` = new address) | kept |
| `blocked` | robots.txt, 401/403/429, or excluded by project rule | kept |
| `unreadable` | timeout, 5xx, too large, no readable text | kept |
| `feed` | OpenActive listing; date is the feed pull | pull date |

## Commands
```
node scripts/freshness/check.mjs --dry-run                       # plan only, no requests
node scripts/freshness/check.mjs --limit 20 --host lovehackney    # host or url fragment
node scripts/freshness/check.mjs                                  # full run (skips pages checked in the last 6 days)
node scripts/freshness/report.mjs                                 # digest + out/flagged.json
node scripts/freshness/check.mjs --accept <url>                   # after re-reading a changed page and updating the listing
```
Re-read loop: open `out/flagged.json`, fix the listing in a small PR, then `--accept` the url so it counts as verified again.

## Install on the home server (not done yet)
1. Clone the repo to `/home/marcos/little-days` (Node 20 or later; no npm install needed).
2. Check the Telegram bits exist: `~/.claude/channels/telegram/.env` and `~/server-report/chat_id` (the existing bot; no new bot or token).
3. Try it: `node scripts/freshness/check.mjs --dry-run`, then `node scripts/freshness/report.mjs` (prints, sends nothing).
4. `sudo cp scripts/freshness/systemd/doddily-freshness.* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now doddily-freshness.timer`
5. First run by hand: `sudo systemctl start doddily-freshness` and `journalctl -u doddily-freshness -f`.

Pause: `touch scripts/freshness/PAUSED`. Resume: delete it. Remove: `sudo systemctl disable --now doddily-freshness.timer` and delete the two unit files. Hard stop for the message: revoke the bot token (also stops Claude on the server).

## Getting results back
The run writes state on the server only. Pulling it back into the repo (by hand, or the server committing to a branch) is still to be decided.
