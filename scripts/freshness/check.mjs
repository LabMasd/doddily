#!/usr/bin/env node
// Doddily freshness checker: is each listing's provider page still the page we took the times from?
//
// For every distinct listing url in data/research/*.json and data/uk-research/*.json it asks the page
// politely (robots.txt first, LittleDaysBot user agent, >= 1.5 s between requests to one host, conditional
// GET with ETag / Last-Modified), hashes the readable text and the schedule tokens (times, weekdays,
// dates, "term", "cancelled"...), and compares with the last run. It never edits listing data: it writes
// only data/freshness-state.json (hashes, dates, status codes).
//
// Statuses per url:
//   baseline   first time seen; hashes recorded, nothing verified yet
//   unchanged  schedule tokens match the accepted version  -> verified = today
//   live       page is there but has no listing-specific times to compare (none, or loaded by script) -> verified = today
//   changed    schedule tokens differ from the accepted version -> a person or agent should re-read it
//   dead       404/410, DNS gone, or permanently moved (to = new address)
//   blocked    robots.txt disallows us, or the site refuses bots (401/403/429/451). Never worked around.
//   unreadable timeouts, 5xx, no readable text (page needs a browser), unsupported type
// OpenActive listings (leisure centres) are skipped: re-pull them with data/uk-research/scripts/openactive.mjs.
//
// Usage:
//   node scripts/freshness/check.mjs                      check every url not checked in the last 6 days
//   node scripts/freshness/check.mjs --dry-run            plan only: no network, no writes
//   node scripts/freshness/check.mjs --limit 20 --host babysensory,kent.gov.uk   (host or url fragment)
//   node scripts/freshness/check.mjs --force              ignore --min-age
//   node scripts/freshness/check.mjs --min-age 3          skip urls checked within 3 days (default 6)
//   node scripts/freshness/check.mjs --state /tmp/s.json  use another state file (testing)
//   node scripts/freshness/check.mjs --accept <url|host>  after a re-read (and listing PR): take the page's
//                                                         current version as correct; verified = today
import { loadListings, readState, writeState, checkUrl, Fetcher, hostOf, isOpenActive, today, hash, STATE_FILE, GAP_MS } from './lib.mjs';
const NO_TIMES = hash('');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = flag('--dry-run');
const LIMIT = +opt('--limit', 0) || Infinity;
const HOSTS = opt('--host', '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const MIN_AGE = flag('--force') ? 0 : +opt('--min-age', 6);
const CONC = Math.max(1, +opt('--concurrency', 4));
const STATE = opt('--state', STATE_FILE);
const ACCEPT = opt('--accept', '');
const QUIET = flag('--quiet');
const day = today();
const daysSince = (d) => (d ? (Date.parse(day) - Date.parse(d)) / 864e5 : Infinity);

const listings = loadListings();
const state = readState(STATE);

// ---------- --accept ----------
if (ACCEPT) {
  let n = 0;
  for (const [u, e] of Object.entries(state.urls)) {
    if (u !== ACCEPT && !hostOf(u).includes(ACCEPT.toLowerCase())) continue;
    if (!e.k || !['changed', 'baseline', 'unchanged'].includes(e.st)) continue;
    if (e.st !== 'unchanged') e.since = day;
    Object.assign(e, { a: e.k, st: 'unchanged', v: day }); n++;
  }
  if (!DRY) { state.updated = day; writeState(state, STATE); }
  console.log(`${DRY ? 'would accept' : 'accepted'} ${n} url(s) matching ${ACCEPT}`);
  process.exit(0);
}

// ---------- plan ----------
const urls = new Map(); let oa = 0, noUrl = 0, badUrl = 0;
for (const it of listings) {
  if (isOpenActive(it)) { oa++; continue; }
  if (!it.url) { noUrl++; continue; }
  if (!/^https?:\/\//i.test(it.url) || !hostOf(it.url)) { badUrl++; continue; }
  urls.set(it.url, (urls.get(it.url) || 0) + 1);
}
const all = [...urls.keys()];
const bare = (u) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
const matching = all.filter((u) => !HOSTS.length || HOSTS.some((h) => bare(u).includes(h.replace(/^www\./, ''))));
const due = matching.filter((u) => daysSince(state.urls[u]?.c) >= MIN_AGE)
  .sort((a, b) => (state.urls[a]?.c || '').localeCompare(state.urls[b]?.c || '') || a.localeCompare(b));
// Spread a --limit across hosts (round robin) instead of hammering the first one.
const byHostAll = new Map();
for (const u of due) { const h = hostOf(u); if (!byHostAll.has(h)) byHostAll.set(h, []); byHostAll.get(h).push(u); }
const picked = [];
for (let round = 0; picked.length < Math.min(LIMIT, due.length); round++) {
  for (const list of byHostAll.values()) { if (list[round] && picked.length < LIMIT) picked.push(list[round]); }
}
const byHost = new Map();
for (const u of picked) { const h = hostOf(u); if (!byHost.has(h)) byHost.set(h, []); byHost.get(h).push(u); }
const biggest = Math.max(0, ...[...byHost.values()].map((l) => l.length));
const estMin = Math.ceil(Math.max(biggest, picked.length / CONC) * (GAP_MS / 1000 + 0.6) / 60);

console.log(`${listings.length} listings · ${all.length} distinct urls on ${new Set(all.map(hostOf)).size} hosts · ${oa} OpenActive listings skipped (re-pull with openactive.mjs) · ${noUrl} without url${badUrl ? ` · ${badUrl} bad url` : ''}`);
console.log(`${matching.length} match${HOSTS.length ? ` --host ${HOSTS.join(',')}` : ''} · ${due.length} due (not checked in ${MIN_AGE} days) · checking ${picked.length} on ${byHost.size} hosts · about ${estMin} min${DRY ? ' (dry run: no requests, nothing written)' : ''}`);
if (DRY) {
  for (const [h, l] of [...byHost].sort((a, b) => b[1].length - a[1].length).slice(0, 15)) console.log(`  ${String(l.length).padStart(5)}  ${h}`);
  if (byHost.size > 15) console.log(`  ... and ${byHost.size - 15} more hosts`);
  process.exit(0);
}

// ---------- run ----------
const fx = new Fetcher();
const counts = {};
let done = 0, sinceSave = 0;
const save = () => { state.updated = day; writeState(state, STATE); sinceSave = 0; };
process.on('SIGINT', () => { save(); console.log('\nstopped; state saved'); process.exit(130); });
process.on('SIGTERM', () => { save(); process.exit(143); });

// live = page reachable but it carries no listing-specific times to compare (no times at all, or the same
// schedule tokens on every page of the host, i.e. the times load by script). Verified means "still there".
let notModified = 0;
const firstSight = new Set(), prevStatus = new Map(), readToday = new Set();
function derive(url, e) {
  if (e.k === NO_TIMES || e.b) return 'live';
  if (firstSight.has(url)) return 'baseline';
  return e.k === e.a ? 'unchanged' : 'changed';
}
function setStatus(url, e, st) {
  e.st = st;
  if (st === 'unchanged' || st === 'live') e.v = day;
  const prev = prevStatus.get(url);
  if (st === 'dead' || st === 'unreadable') e.n = (prev?.st === st ? prev.n || 1 : 0) + 1; else delete e.n;
  e.since = st !== prev?.st ? day : prev.since || day;
}
function record(url, res) {
  const prev = state.urls[url] || {};
  prevStatus.set(url, { st: prev.st, n: prev.n, since: prev.since });
  const e = { ...prev, c: day };
  if (!prev.c) e.seen = day;
  delete e.r; delete e.to;
  if (res.status === 'ok' || res.status === 'notmodified') {
    if (res.status === 'notmodified') notModified++;
    if (res.status === 'ok') {
      e.t = res.text; e.k = res.times;
      if (res.etag) e.e = res.etag; else delete e.e;
      if (res.lastModified) e.m = res.lastModified; else delete e.m;
    }
    if (!e.a) { e.a = e.k; firstSight.add(url); }
    readToday.add(url);
    setStatus(url, e, derive(url, e));
  } else { e.r = res.reason; setStatus(url, e, res.status); }
  if (res.to) e.to = res.to;
  state.urls[url] = e;
  return e;
}
/** Same schedule tokens on 3+ pages of one host = site template, not this listing's times. */
function markTemplates() {
  const groups = new Map();
  for (const [u, e] of Object.entries(state.urls)) {
    if (!e.k || e.k === NO_TIMES || e.k.startsWith('pdf:')) continue;
    const key = `${hostOf(u)}|${e.k}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  for (const u of readToday) {
    const e = state.urls[u];
    const b = groups.get(`${hostOf(u)}|${e.k}`) >= 3;
    if (b) e.b = 1; else delete e.b;
    setStatus(u, e, derive(u, e));
  }
}

const hosts = [...byHost.keys()].sort((a, b) => byHost.get(b).length - byHost.get(a).length); // longest first
let next = 0;
async function worker() {
  while (next < hosts.length) {
    const h = hosts[next++];
    let strikes = 0;
    for (const url of byHost.get(h)) {
      const res = await checkUrl(fx, url, state.urls[url] || {});
      const e = record(url, res);
      done++; sinceSave++;
      if (!QUIET) console.log(`${String(done).padStart(5)}/${picked.length}  ${e.st.padEnd(10)} ${url.slice(0, 110)}${e.r ? `  (${e.r}${e.to ? ' -> ' + e.to.slice(0, 60) : ''})` : ''}`);
      if (sinceSave >= 100) save();
      // Back off a host for the rest of this run if it rate-limits us or keeps failing.
      if (res.rateLimited) { console.log(`  ${h}: rate limited (429); leaving the rest of this host for next run`); break; }
      if (res.status === 'unreadable' && /timeout|robots.txt unreachable|http 5/.test(res.reason || '')) { if (++strikes >= 5) { console.log(`  ${h}: 5 failures in a row; leaving the rest for next run`); break; } } else strikes = 0;
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(CONC, hosts.length) }, worker));

markTemplates();
// Forget urls that no listing uses any more (full runs only).
if (!HOSTS.length && LIMIT === Infinity) for (const u of Object.keys(state.urls)) if (!urls.has(u)) delete state.urls[u];
save();
for (const u of picked) { const e = state.urls[u]; if (e?.c === day) counts[e.st] = (counts[e.st] || 0) + 1; }
console.log(`\ndone in ${Math.round((Date.now() - t0) / 1000)} s · ${fx.requests} requests (${notModified} answered 304 not modified) · ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
console.log(`state: ${STATE}`);
