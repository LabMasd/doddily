#!/usr/bin/env node
// Weekly freshness report: a short Telegram-ready digest plus a machine-readable flagged.json.
// Reads data/freshness-state.json (from check.mjs), the listings, and, if it exists, the school term dates
// file. Writes scripts/freshness/out/digest.txt and out/flagged.json. Never edits listing data.
//
//   node scripts/freshness/report.mjs                 print the digest, write out/
//   node scripts/freshness/report.mjs --send          also send it through the home server's Telegram bot
//   node scripts/freshness/report.mjs --from 2026-12-14 --days 21   holiday window (default: today, 14 days)
//   node scripts/freshness/report.mjs --state f.json --out dir --term-dates f.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadListings, readState, isOpenActive, listingId, STATE_FILE, OUT_DIR, TERM_DATES, ROOT, today } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const STATE = opt('--state', STATE_FILE);
const OUT = opt('--out', OUT_DIR);
const TERMS = opt('--term-dates', TERM_DATES);
const FROM = opt('--from', today());
const DAYS = +opt('--days', 14);
const SEND = argv.includes('--send');
const day = today();

const state = readState(STATE);
const listings = loadListings();
const byUrl = new Map();
let oaCount = 0; const oaDates = new Set();
for (const it of listings) {
  if (isOpenActive(it)) { oaCount++; const m = /checked (\d{4}-\d{2}-\d{2})/.exec(it.schedule_note || ''); if (m) oaDates.add(m[1]); continue; }
  if (!it.url) continue;
  if (!byUrl.has(it.url)) byUrl.set(it.url, []);
  byUrl.get(it.url).push(it);
}
const ref = (it) => ({ id: listingId(it), file: it._file, index: it._i, name: it.name, venue: it.venue || '', postcode: it.postcode || '' });

// ---------- status counts ----------
const ORDER = ['unchanged', 'live', 'changed', 'baseline', 'dead', 'blocked', 'unreadable', 'unchecked'];
const urlCounts = Object.fromEntries(ORDER.map((k) => [k, 0]));
const listingCounts = Object.fromEntries(ORDER.map((k) => [k, 0]));
const flaggedUrls = [];
for (const [url, its] of byUrl) {
  const e = state.urls[url];
  const st = e?.st || 'unchecked';
  urlCounts[st]++; listingCounts[st] += its.length;
  const isNew = e?.since && (Date.parse(day) - Date.parse(e.since)) / 864e5 < 7;
  // Needs a re-read: changed or dead, or unreadable twice running. Blocked only when newly blocked.
  const need = st === 'changed' || st === 'dead' || (st === 'unreadable' && (e.n || 1) >= 2) || (st === 'blocked' && isNew && !/^excluded/.test(e.r || ''));
  if (need) flaggedUrls.push({ status: st, url, reason: e.r || '', to: e.to || '', since: e.since || '', verified: e.v || '', new: !!isNew, action: st === 'blocked' ? 'add to the screenshot checklist (docs/timetable-captures.html); do not work around' : st === 'dead' ? 'find the new page or remove the listing' : st === 'changed' ? 're-read the page, update times, then check.mjs --accept <url>' : 'check by hand', listings: its.map(ref) });
}
const rank = { changed: 0, dead: 1, unreadable: 2, blocked: 3 };
flaggedUrls.sort((a, b) => rank[a.status] - rank[b.status] || Number(b.new) - Number(a.new) || b.listings.length - a.listings.length);

// ---------- school holidays ----------
// Postcode area -> council in the term-dates file (approximate; London and unlisted areas use the
// typical pattern for their nation).
const AREA = { LS: 'Leeds', BS: 'Bristol', S: 'Sheffield', L: 'Liverpool', NE: 'Newcastle', NG: 'Nottingham', LE: 'Leicester', B: 'Birmingham', M: 'Manchester', CT: 'Kent', ME: 'Kent', TN: 'Kent', PR: 'Lancashire', BB: 'Lancashire', FY: 'Lancashire', CF: 'Cardiff', SA: 'Swansea', EH: 'Edinburgh', G: 'Glasgow', AB: 'Aberdeen', DD: 'Dundee', BT: 'Northern Ireland' };
const NATION_AREAS = { Wales: ['CF', 'SA', 'NP', 'LD', 'LL'], Scotland: ['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE'], 'Northern Ireland': ['BT'] };
const COUNCIL_NATION = { Cardiff: 'Wales', Swansea: 'Wales', Edinburgh: 'Scotland', Glasgow: 'Scotland', Aberdeen: 'Scotland', Dundee: 'Scotland', 'Northern Ireland': 'Northern Ireland' };
const areaOf = (pc) => (String(pc || '').toUpperCase().match(/^[A-Z]{1,2}/) || [''])[0];
const nationOf = (area) => Object.entries(NATION_AREAS).find(([, a]) => a.includes(area))?.[0] || 'England';
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const pretty = (k) => k.replace(/([A-Z])/g, ' $1').toLowerCase().trim();

let terms = null, termNote = '';
try { terms = JSON.parse(fs.readFileSync(TERMS, 'utf8')); } catch (e) { termNote = fs.existsSync(TERMS) ? `term dates unreadable (${e.message.slice(0, 60)})` : 'no term dates file yet'; }

/** council -> Map(date -> break name), from any {start,end} value and any closures [{date,label}]. */
function holidayDays(c) {
  const m = new Map();
  for (const [k, v] of Object.entries(c || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && /^\d{4}-\d{2}-\d{2}$/.test(v.start || '')) {
      const end = /^\d{4}-\d{2}-\d{2}$/.test(v.end || '') ? v.end : addDays(v.start, 41); // open-ended summer
      for (let d = v.start; d <= end; d = addDays(d, 1)) m.set(d, pretty(k));
    } else if (Array.isArray(v)) for (const x of v) if (x && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')) m.set(x.date, x.label || pretty(k));
  }
  return m;
}
const calendars = new Map();
if (terms?.councils) {
  for (const [name, c] of Object.entries(terms.councils)) calendars.set(name, holidayDays(c));
  // Typical pattern per nation: a day counts if most of that nation's councils are off.
  for (const nation of ['England', 'Wales', 'Scotland', 'Northern Ireland']) {
    const cs = Object.keys(terms.councils).filter((n) => (COUNCIL_NATION[n] || 'England') === nation).map((n) => calendars.get(n));
    if (!cs.length) continue;
    const votes = new Map();
    for (const c of cs) for (const [d, b] of c) { const v = votes.get(d) || { n: 0, b }; v.n++; votes.set(d, v); }
    calendars.set(`typical ${nation}`, new Map([...votes].filter(([, v]) => v.n * 2 > cs.length).map(([d, v]) => [d, v.b])));
  }
}
const windowDays = Array.from({ length: DAYS }, (_, i) => addDays(FROM, i));
const holidayFlags = [];
if (calendars.size) {
  for (const it of listings) {
    const days = new Set((it.sessions || []).filter((s) => s.start).map((s) => String(s.day).slice(0, 3)));
    if (!days.size) continue;
    const termish = it.booking === 'term' || ['library', 'stayplay', 'support'].includes(it.category) || /term/i.test(it.schedule_note || '');
    if (!termish) continue;
    const area = areaOf(it.postcode);
    const council = AREA[area] && calendars.has(AREA[area]) ? AREA[area] : `typical ${nationOf(area)}`;
    const cal = calendars.get(council);
    if (!cal) continue;
    const hits = windowDays.filter((d) => cal.has(d) && days.has(DAYN[new Date(d + 'T12:00:00Z').getUTCDay()])).map((d) => ({ date: d, break: cal.get(d) }));
    if (hits.length) holidayFlags.push({ ...ref(it), council, dates: hits });
  }
}

// ---------- outputs ----------
const fmt = (n) => n.toLocaleString('en-GB');
const flagged = {
  generated: day, state: path.relative(ROOT, STATE), stateUpdated: state.updated || null,
  window: { from: FROM, days: DAYS }, termDates: calendars.size ? path.relative(ROOT, TERMS) : termNote,
  urls: urlCounts, listings: listingCounts, openactive: { listings: oaCount, pulled: [...oaDates].sort(), action: 'node data/uk-research/scripts/openactive.mjs then openactive-clean.mjs' },
  reread: flaggedUrls, holidays: holidayFlags,
};
const totalUrls = byUrl.size;
const lines = [];
const dateLine = new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
lines.push(`Doddily listings check · ${dateLine}`);
lines.push(`${fmt(totalUrls)} provider pages: ${fmt(urlCounts.unchanged + urlCounts.live)} fine · ${fmt(urlCounts.changed)} changed · ${fmt(urlCounts.dead)} dead · ${fmt(urlCounts.blocked)} blocked · ${fmt(urlCounts.unreadable)} unreadable${urlCounts.baseline ? ` · ${fmt(urlCounts.baseline)} first look` : ''}${urlCounts.unchecked ? ` · ${fmt(urlCounts.unchecked)} not checked yet` : ''}`);
lines.push(`OpenActive: ${fmt(oaCount)} leisure-centre sessions, last pulled ${[...oaDates].sort().pop() || '?'} (re-pull, not page-checked)`);
lines.push('');
if (flaggedUrls.length) {
  lines.push(`Needs a re-read (${fmt(flaggedUrls.length)} pages, ${fmt(flaggedUrls.reduce((n, f) => n + f.listings.length, 0))} listings):`);
  for (const f of flaggedUrls.slice(0, 8)) {
    const it = f.listings[0];
    const more = f.listings.length > 1 ? ` +${f.listings.length - 1}` : '';
    lines.push(`• ${f.status}${f.new ? ' (new)' : ''}: ${it.name}${it.venue ? `, ${it.venue}` : ''}${more}${f.reason ? ` [${f.reason}]` : ''}`);
  }
  if (flaggedUrls.length > 8) lines.push(`  and ${fmt(flaggedUrls.length - 8)} more in flagged.json`);
} else lines.push('Nothing needs a re-read.');
lines.push('');
if (calendars.size) {
  if (holidayFlags.length) {
    const byBreak = new Map();
    for (const h of holidayFlags) for (const d of h.dates) { const k = `${d.break} (${h.council.replace('typical ', '')})`; byBreak.set(k, (byBreak.get(k) || new Set()).add(h.id)); }
    lines.push(`School holidays in the next ${DAYS} days: ${fmt(holidayFlags.length)} term-time listings have a session on a holiday date`);
    for (const [k, s] of [...byBreak].sort((a, b) => b[1].size - a[1].size).slice(0, 4)) lines.push(`• ${k}: ${fmt(s.size)}`);
  } else lines.push(`No school holidays in the next ${DAYS} days.`);
} else lines.push(`School holidays: not checked (${termNote}).`);
const digest = lines.join('\n').slice(0, 3900);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'flagged.json'), JSON.stringify(flagged, null, 1));
fs.writeFileSync(path.join(OUT, 'digest.txt'), digest + '\n');
console.log(digest);
console.log(`\nwrote ${path.join(OUT, 'flagged.json')} (${flaggedUrls.length} pages to re-read, ${holidayFlags.length} holiday clashes)`);

if (SEND) {
  const sh = path.join(path.dirname(new URL(import.meta.url).pathname), 'send-telegram.sh');
  try { execFileSync(sh, [], { input: digest, stdio: ['pipe', 'inherit', 'inherit'] }); console.log('sent to Telegram'); }
  catch { console.error('Telegram send failed'); process.exit(1); }
}
