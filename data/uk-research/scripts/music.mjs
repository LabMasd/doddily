#!/usr/bin/env node
// Little Days - UK baby & toddler music class directory crawler.
// Node 22, built-in fetch only.
//
// Politeness: honest UA, robots.txt checked per origin, >= 1.1s between network
// requests, every successful page cached on disk so re-runs do not re-fetch.
// Sites that answer 403 to this UA are NOT worked around (no proxies, no UA spoofing).
//
// Usage:
//   node music.mjs                         full run
//   LIMIT=2 BRANDS=moo,minimozart node music.mjs   test a handful of pages
//   TODAY=2026-09-15 OUT=/tmp/x.json node music.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)';
const CACHE = process.env.CACHE_DIR || '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/music';
const OUT = process.env.OUT || '/Users/marcos/little-days/data/uk-research/music.json';
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const ONLY = process.env.BRANDS ? process.env.BRANDS.split(',') : null;
const UK_COUNTRIES = new Set(['England', 'Scotland', 'Wales', 'Northern Ireland']);

// Brands whose official finder refuses this UA (checked once per run, never bypassed),
// or which are otherwise out of reach. Kept here so re-runs notice if that changes.
const BLOCKED_PROBES = [
  { brand: 'Monkey Music', url: 'https://www.monkeymusic.co.uk/find-a-class' },
  { brand: 'Music Bugs', url: 'https://www.musicbugs.co.uk/' },
  { brand: 'Boogie Mites', url: 'https://www.boogiemites.co.uk/' },
  { brand: 'Hartbeeps', url: 'https://www.hartbeeps.com/' },
  { brand: 'Music Bus', url: 'https://musicbus.com/classes/' },
];

// ---------------------------------------------------------------- fetching
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const stats = { net: 0, cache: 0, errors: [] };
let lastNet = 0;
async function throttle() {
  const wait = lastNet + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastNet = Date.now();
}
const log = (...a) => console.error('[music]', ...a);

async function get(url, { skipRobots = false, noCache = false } = {}) {
  const file = path.join(CACHE, sha1(url) + '.html');
  if (!noCache) {
    try {
      const t = await fs.readFile(file, 'utf8');
      if (t.length) { stats.cache++; return t; }
    } catch {}
  }
  if (!skipRobots && !(await robotsAllowed(url))) {
    stats.errors.push(`robots disallow ${url}`);
    return null;
  }
  await throttle();
  stats.net++;
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    stats.errors.push(`fetch error ${url}: ${e.message}`);
    return null;
  }
  const text = await res.text();
  if (!res.ok) {
    stats.errors.push(`HTTP ${res.status} ${url}`);
    return null; // errors are not cached
  }
  if (!noCache) await fs.writeFile(file, text);
  return text;
}

async function postJson(url, body) {
  const payload = JSON.stringify(body);
  const file = path.join(CACHE, sha1('POST ' + url + ' ' + payload) + '.json');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
  await throttle();
  stats.net++;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
  const json = await res.json();
  await fs.writeFile(file, JSON.stringify(json));
  return json;
}

// ---------------------------------------------------------------- robots.txt
const robotsCache = new Map();
function parseRobots(txt) {
  const groups = [];
  let cur = null;
  let lastUA = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastUA = true;
    } else {
      lastUA = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a && a !== '*' && 'littledaysbot'.includes(a)));
  return (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
}
function robotsMatch(pattern, p) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : '')).test(p);
}
async function robotsAllowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    const txt = await get(u.origin + '/robots.txt', { skipRobots: true });
    robotsCache.set(u.origin, parseRobots(txt && !/<html/i.test(txt) ? txt : ''));
  }
  const p = u.pathname + u.search;
  let best = null;
  for (const r of robotsCache.get(u.origin)) {
    if (!r.path || !robotsMatch(r.path, p)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

// ---------------------------------------------------------------- text helpers
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…' };
const decode = (s) =>
  String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const clean = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function toText(html) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|p|div|li|h[1-6]|tr|td|section|article|ul|ol|table|time)\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
const PC_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
function normPc(s) {
  const m = String(s || '').match(PC_RE);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}
const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

// ---------------------------------------------------------------- session parsing
const DAY_WORDS = {
  Mon: ['monday', 'mondays', 'mon'],
  Tue: ['tuesday', 'tuesdays', 'tues', 'tue'],
  Wed: ['wednesday', 'wednesdays', 'weds', 'wed'],
  Thu: ['thursday', 'thursdays', 'thurs', 'thur', 'thu'],
  Fri: ['friday', 'fridays', 'fri'],
  Sat: ['saturday', 'saturdays', 'sat'],
  Sun: ['sunday', 'sundays', 'sun'],
};
const DAY_LOOKUP = Object.fromEntries(Object.entries(DAY_WORDS).flatMap(([d, ws]) => ws.map((w) => [w, d])));
const dayOf = (s) => DAY_LOOKUP[String(s).toLowerCase().replace(/[^a-z]/g, '')] || null;
const DAY_ALT = Object.values(DAY_WORDS).flat().sort((a, b) => b.length - a.length).join('|');
const TOKEN_RE = new RegExp(
  String.raw`(?<day>\b(?:${DAY_ALT})\b)|(?<![£\d.:/])(?<t1>\d{1,2})(?:[.:](?<m1>\d{2}))?\s*(?<a1>am|pm)?(?:\s*(?:-|–|—|to|until)\s*(?<t2>\d{1,2})(?:[.:](?<m2>\d{2}))?\s*(?<a2>am|pm)?)?(?![\d])`,
  'gi',
);
const TOKEN_RE_HAS_DAY = new RegExp(`\\b(?:${DAY_ALT})\\b`, 'i');
const MONTH_AHEAD =/^\s*\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

function to24(h, m, ap) {
  h = Number(h); m = Number(m || 0);
  if (ap) {
    ap = ap.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  } else if (h >= 1 && h <= 6) h += 12; // bare 1-6 o'clock in a daytime class listing = afternoon
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// Free-text timetable parser: "Fridays 10-10.40am and 11.10-11.50am", "Thursday 9.45 – 10.25am".
function parseSessions(text) {
  const sessions = [];
  const undated = [];
  let days = [];
  let lastDayEnd = -1;
  let prevWasDay = false;
  let prevEnd = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const g = m.groups;
    if (g.day) {
      const after = text.slice(m.index + g.day.length, m.index + g.day.length + 20);
      if (MONTH_AHEAD.test(after)) { prevWasDay = false; continue; } // "Mon 7 Sept" is a date
      const gap = text.slice(prevEnd, m.index);
      const d = dayOf(g.day);
      if (prevWasDay && /^\s*(?:,|&|and|\/|\+)?\s*$/i.test(gap)) days.push(d);
      else days = [d];
      lastDayEnd = m.index + g.day.length;
      prevWasDay = true;
      prevEnd = lastDayEnd;
      continue;
    }
    prevWasDay = false;
    prevEnd = m.index + m[0].length;
    const hasTime = g.m1 || g.a1 || (g.t2 && (g.m2 || g.a2));
    if (!hasTime) continue;
    let start, end = null;
    if (g.t2) {
      end = to24(g.t2, g.m2, g.a2);
      const apStart = g.a1 || g.a2;
      start = to24(g.t1, g.m1, apStart);
      if (start && end && mins(start) > mins(end) && !g.a1) start = to24(g.t1, g.m1, 'am');
      if (start && end && mins(end) - mins(start) > 240) end = null;
    } else {
      start = to24(g.t1, g.m1, g.a1);
    }
    if (!start || mins(start) < 6 * 60 || mins(start) > 20 * 60) continue;
    const between = lastDayEnd >= 0 ? text.slice(lastDayEnd, m.index) : null;
    if (days.length && between !== null && (between.match(/\n/g) || []).length <= 3) {
      for (const d of days) sessions.push({ day: d, start, end });
    } else {
      undated.push({ start, end });
    }
  }
  return { sessions: dedupeSessions(sessions), undated };
}
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function dedupeSessions(list) {
  const seen = new Map();
  for (const s of list) {
    const k = `${s.day}|${s.start}`;
    if (!seen.has(k) || (!seen.get(k).end && s.end)) seen.set(k, s);
  }
  return [...seen.values()].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.start.localeCompare(b.start));
}

// ---------------------------------------------------------------- item builder
const DESCRIPTIONS = {
  'Jo Jingles': 'Music, singing and movement classes for young children, run in age-based groups.',
  'Moo Music': 'Weekly sing-along music sessions with original songs, percussion and movement for young children.',
  'Mini Mozart': 'Nursery rhymes and classical music classes led by live musicians, with separate age groups.',
  'Musical Bumps': 'Songs, rhymes and percussion play in small music groups for babies and young children with their carers.',
  'Bach to Baby': 'Relaxed live classical concerts where babies and toddlers can move, feed and make noise.',
  'Pelican Music': 'Weekly group music class for babies and toddlers with their adults at a Stoke Newington studio.',
  'Little Notes': 'Music classes for babies and young children led by professional musicians playing live instruments.',
  'Jiggy Wrigglers': 'Music and movement groups for babies and young children, with age-specific and mixed sessions.',
};
function item(o) {
  const sessions = dedupeSessions(o.sessions || []);
  return {
    name: o.name,
    provider: o.provider,
    category: 'music',
    venue: (o.venue || '').replace(/\s+/g, ' ').trim(),
    address: (o.address || '').replace(/\s+,/g, ',').replace(/(,\s*)+,/g, ',').replace(/\s+/g, ' ').replace(/^,\s*|,\s*$/g, '').trim(),
    postcode: o.postcode,
    lat: 0,
    lng: 0,
    sessions,
    tier: sessions.length ? 'timetable' : 'venue',
    schedule_note: (o.schedule_note || '').slice(0, 240),
    age_min_months: o.age_min_months ?? null,
    age_max_months: o.age_max_months ?? null,
    price: o.price || '',
    free: false,
    booking: o.booking || 'book',
    indoor: true,
    description: DESCRIPTIONS[o.brand] || '',
    url: o.url,
    phone: o.phone || '',
    source: o.source,
    confidence: o.confidence || 'high',
    _brand: o.brand,
  };
}
const take = (arr) => (Number.isFinite(LIMIT) ? arr.slice(0, LIMIT) : arr);

// ---------------------------------------------------------------- Jo Jingles
async function joJingles() {
  const base = 'https://booking.jojingles.com/discover/classes/';
  const html = await get(base);
  if (!html) return [];
  const sel = html.match(/<select name="territory"[\s\S]*?<\/select>/)?.[0] || '';
  const territories = [...sel.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)]
    .map((m) => ({ id: m[1], name: clean(m[2]) }))
    .filter((t) => !/^ireland/i.test(t.name));
  const byClass = new Map();
  for (const t of take(territories)) {
    for (const age of [0, 1]) {
      const page = await get(`${base}?territory=${t.id}&age=${age}`);
      if (!page) continue;
      for (const card of page.split('class="class-card').slice(1)) {
        const title = clean(card.match(/<h4>([\s\S]*?)<\/h4>/)?.[1]);
        const det = card.match(/<div class="class-details">([\s\S]*?)<\/div>/)?.[1] || '';
        const field = (k) => clean(det.match(new RegExp(`${k}:\\s*([^<]*)`))?.[1]);
        const classId = card.match(/[?&]class=(\d+)/)?.[1];
        const areaUrl = card.match(/href="(\/discover\/territory\/[^"]+)"/)?.[1];
        const rec = byClass.get(classId) || { title, area: field('Class Area'), location: field('Location'), address: field('Address'), day: field('Day'), time: field('Time'), price: field('Price'), classId, territory: t.id, areaUrl, ages: new Set() };
        rec.ages.add(age);
        if (classId) byClass.set(classId, rec);
      }
    }
  }
  const out = [];
  for (const r of byClass.values()) {
    const ages = jjAges(r.title, r.ages);
    if (ages.min > 18) continue;
    const [start, end] = (r.time.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/) || []).slice(1).map((x) => x && x.padStart(5, '0'));
    const day = dayOf(r.day);
    const address = r.address.replace(/,\s*uk\s*,/i, ',').replace(/\s+,/g, ',');
    out.push(item({
      brand: 'Jo Jingles',
      name: `Jo Jingles ${r.title.replace(/\s*\(.*\)\s*$/, '')}`,
      provider: `Jo Jingles ${r.area}`,
      venue: r.location,
      address,
      postcode: normPc(address),
      sessions: day && start ? [{ day, start, end: end || null }] : [],
      schedule_note: r.title.match(/\((.*)\)/)?.[1] ? `Class for ${r.title.match(/\((.*)\)/)[1].toLowerCase()}; term-time` : 'Term-time',
      age_min_months: ages.min,
      age_max_months: ages.max,
      price: r.price,
      booking: 'term',
      url: `https://booking.jojingles.com/discover/booking/?territory=${r.territory}&class=${r.classId}`,
      source: 'jojingles.com',
    }));
  }
  return out;
}
function jjAges(title, queried) {
  const t = title.toLowerCase();
  const range = t.match(/(\d+)\s*(months?|years?|yrs?)?\s*(?:-|–|to)\s*(\d+)\s*(months?|years?|yrs?)/);
  if (range) {
    const unitA = range[2] || range[4];
    const toM = (n, u) => (/^y/.test(u) ? Number(n) * 12 : Number(n));
    return { min: toM(range[1], unitA), max: toM(range[3], range[4]) };
  }
  if (/walking to 2/.test(t)) return { min: 12, max: 24 };
  if (/baby|to walking/.test(t)) return { min: 3, max: 15 };
  if (/mixed|family/.test(t)) return { min: 3, max: 48 };
  if (/toddler/.test(t)) return { min: 12, max: 24 };
  if (queried.has(0)) return { min: 3, max: 12 };
  if (queried.has(1)) return { min: 12, max: 24 };
  return { min: 24, max: 84 };
}

// ---------------------------------------------------------------- Moo Music
async function mooMusic() {
  const sm = await get('https://moo-music.co.uk/wp-sitemap-posts-area-1.xml');
  if (!sm) return [];
  const areas = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const out = [];
  for (const url of take(areas)) {
    const html = await get(url);
    if (!html) continue;
    const provider = clean(html.match(/<title>([\s\S]*?)<\/title>/)?.[1]).replace(/\s*[–-]\s*Moo Music\s*$/, '');
    const bookwhen = html.match(/<iframe src="(https:\/\/bookwhen\.com\/[^"]+)"/)?.[1];
    for (const li of html.split('<li class="venue">').slice(1)) {
      const block = li.split('</li>')[0];
      const venue = clean(block.match(/<strong>([\s\S]*?)<\/strong>/)?.[1]);
      const addrRaw = block.match(/<!-- Address -->([\s\S]*?)<!-- Postcode -->/)?.[1] || '';
      const pcRaw = clean(block.match(/<!-- Postcode -->([\s\S]*?)<\/p>/)?.[1]);
      const notes = clean(block.match(/class="tip venue-notes">([\s\S]*?)<\/p>/)?.[1]);
      const addrParts = addrRaw.split(/<br\s*\/?>/i).map(clean).map((s) => s.replace(/,\s*$/, '')).filter(Boolean);
      const postcode = normPc(pcRaw) || normPc(addrParts.join(' '));
      const address = [...addrParts.filter((p) => normPc(p) !== postcode || p.length > 9), postcode].filter(Boolean).join(', ');
      const { sessions } = parseSessions(notes);
      out.push(item({
        brand: 'Moo Music',
        name: 'Moo Music',
        provider,
        venue,
        address,
        postcode,
        sessions,
        schedule_note: notes && (sessions.length || TOKEN_RE_HAS_DAY.test(notes)) ? notes : 'Session times on the provider booking page',
        age_min_months: 0,
        age_max_months: 60,
        booking: 'book',
        url,
        source: 'moo-music.co.uk',
        confidence: sessions.length ? 'high' : 'medium',
        _bookwhen: bookwhen,
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- Mini Mozart
async function miniMozart() {
  const sm = await get('https://www.minimozart.com/venue-sitemap.xml');
  if (!sm) return [];
  const venues = [...sm.matchAll(/<loc>([^<]*\/venue\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  const out = [];
  for (const url of take(venues)) {
    const html = await get(url);
    if (!html) continue;
    const det = html.match(/<div class="product-det">([\s\S]*?)<\/div>/)?.[1];
    if (!det) continue;
    const timeSpan = det.match(/<span class="time">([\s\S]*?)<\/span>/)?.[1] || '';
    const locText = clean(det.match(/<span class="location">([\s\S]*?)<\/span>/)?.[1]).replace(/\(see on Google Maps\)/i, '').trim();
    const lm = locText.match(/^(.+?)\s*\(([A-Za-z]+)\)\s*,\s*(.+)$/);
    if (!lm) continue;
    const [, area, dayWord, restRaw] = lm;
    const rest = restRaw.replace(/(\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\s+\1\s*$/i, '$1').trim();
    const firstPart = rest.split(',')[0].trim();
    const venue = /^\d/.test(firstPart) ? `Mini Mozart ${area}` : firstPart;
    const day = dayOf(dayWord);
    for (const part of timeSpan.split(/<br\s*\/?>/i)) {
      const m = clean(part.replace(/<a [^>]*>\s*\(book now\)\s*<\/a>/i, '')).match(/^[–-]?\s*(.+?)\s+(\d{1,2})[:.](\d{2})\s*(am|pm)/i);
      if (!m) continue;
      const cls = m[1].trim();
      const link = part.match(/href="([^"]+)"/)?.[1];
      let ages;
      if (/babies\s*&\s*toddlers/i.test(cls)) ages = [0, 48];
      else if (/bab/i.test(cls)) ages = [0, 15];
      else continue; // Toddlers-only (16 months+) is out of scope
      out.push(item({
        brand: 'Mini Mozart',
        name: `Mini Mozart ${cls}`,
        provider: `Mini Mozart ${area}`,
        venue,
        address: rest,
        postcode: normPc(rest),
        sessions: day ? [{ day, start: to24(m[2], m[3], m[4]), end: null }] : [],
        schedule_note: 'Term-time weekly class, monthly membership',
        age_min_months: ages[0],
        age_max_months: ages[1],
        booking: 'term',
        url: link || url,
        source: 'minimozart.com',
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- Musical Bumps
async function musicalBumps() {
  const finder = await get('https://www.musicalbumps.com/find-a-class/');
  if (!finder) return [];
  const pages = [...new Set([...finder.matchAll(/https:\/\/www\.musicalbumps\.com\/teachers\/[a-z0-9-]+\//g)].map((m) => m[0]))];
  const out = [];
  for (const url of take(pages)) {
    const html = await get(url);
    if (!html) continue;
    const title = clean(html.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    const area = title.replace(/\s*-\s*Musical Bumps\s*$/i, '').replace(/^Musical Bumps\s*/i, '').replace(/\s*-.*$/, '').trim();
    const text = toText(html);
    const years = [...text.matchAll(/\b(20[12]\d)\b/g)].map((m) => Number(m[1])).filter((y) => y <= 2030);
    const stale = years.length && Math.max(...years) < 2025;
    const booking = html.match(/href="(https:\/\/[^"]*(?:bookpebble|bookwhen|classforkids)[^"]*)"/)?.[1];
    const phone = text.match(/\b(0\d{3,4}\s?\d{3}\s?\d{3,4})\b/)?.[1] || '';
    // venue lines = lines carrying a postcode, excluding form/owner/footer noise
    const lines = text.split('\n');
    const venueLines = [];
    for (const line of lines) {
      const pc = normPc(line);
      if (!pc || line.length > 260 || /registered|company|copyright|@/i.test(line)) continue;
      if (venueLines.some((v) => v.postcode === pc)) continue;
      venueLines.push({ line: line.trim(), postcode: pc });
    }
    // baby-suitable timetable lines, with day carried from the previous lines
    const babyLine = /bab|newborn|0\s*-\s*1[0-8]\s*m|crawl|mixed|1\s*yr|1\s*\+|1-2|family/i;
    const timetableText = lines.filter((l) => babyLine.test(l) || /^\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*:?\s*$/i.test(l)).join('\n');
    const { sessions, undated } = parseSessions(timetableText);
    const summary = sessions.length
      ? `Baby/mixed classes listed on provider page: ${sessions.map((s) => `${s.day} ${s.start}`).join(', ')}`
      : undated.length ? 'Baby class times listed on provider page (days not given per venue)' : 'Timetable on provider page';
    for (const v of venueLines) {
      const single = venueLines.length === 1;
      const parts = v.line.split(',').map((s) => s.trim()).filter(Boolean);
      const stripped = parts[0].replace(PC_RE, '').replace(/[.,\s]+$/, '').trim();
      const venue = stripped.length > 2 ? stripped : `Musical Bumps ${area}`;
      out.push(item({
        brand: 'Musical Bumps',
        name: 'Musical Bumps',
        provider: `Musical Bumps ${area}`,
        venue,
        address: v.line.replace(/\.$/, ''),
        postcode: v.postcode,
        sessions: single ? sessions : [],
        schedule_note: single ? (sessions.length ? 'Term-time' : summary) : summary,
        age_min_months: 0,
        age_max_months: 48,
        booking: 'term',
        url: booking || url,
        phone,
        source: 'musicalbumps.com',
        confidence: stale ? 'low' : 'medium',
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- Bach to Baby
async function bachToBaby() {
  const cal = await get('https://www.bachtobaby.com/calendar');
  if (!cal) return [];
  const events = [...cal.matchAll(/title\s*:\s*"([^"]*)"\s*,\s*start\s*:\s*"([^"]+)"[^}]*?url\s*:\s*"([^"]+)"/g)]
    .map((m) => ({ title: m[1].trim(), start: m[2], path: m[3] }))
    .filter((e) => e.start.slice(0, 10) >= TODAY);
  const byPath = new Map();
  for (const e of events) byPath.set(e.path, [...(byPath.get(e.path) || []), e]);
  const out = [];
  for (const [p, evs] of take([...byPath.entries()])) {
    const url = 'https://www.bachtobaby.com' + p;
    const html = await get(url);
    if (!html) continue;
    const lines = toText(html).split('\n').map((s) => s.trim()).filter(Boolean);
    const i = lines.findIndex((l) => /^Family Concerts in /i.test(l));
    if (i < 0) continue;
    let venue = lines[i + 1] || '';
    let addrLines = [];
    let postcode = null;
    for (let k = i + 2; k <= i + 5 && k < lines.length; k++) {
      const pc = normPc(lines[k]);
      if (pc) { postcode = pc; if (lines[k].replace(PC_RE, '').trim()) addrLines.push(lines[k].replace(PC_RE, '').replace(/,\s*$/, '').trim()); break; }
      addrLines.push(lines[k]);
    }
    if (!postcode && normPc(venue)) postcode = normPc(venue);
    const priceM = toText(html).match(/Tickets cost (£\d+(?:\.\d{2})?)/i);
    const fmt = (e) => {
      const d = new Date(e.start.replace(' ', 'T') + 'Z');
      return `${DAY_ORDER[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${e.start.slice(11, 16)}`;
    };
    evs.sort((a, b) => a.start.localeCompare(b.start));
    out.push(item({
      brand: 'Bach to Baby',
      name: 'Bach to Baby family concert',
      provider: `Bach to Baby ${evs[0].title}`,
      venue,
      address: [venue, ...addrLines, postcode].filter(Boolean).join(', '),
      postcode,
      sessions: [],
      schedule_note: `Dated concerts, not a weekly class. Next: ${evs.slice(0, 4).map(fmt).join(', ')}`,
      age_min_months: 0,
      age_max_months: 60,
      price: priceM ? `${priceM[1]} per adult on the door (less if pre-booked); up to 2 children free per adult ticket` : '',
      booking: 'book',
      url,
      source: 'bachtobaby.com',
    }));
  }
  return out;
}

// ---------------------------------------------------------------- Pelican Music
async function pelican() {
  const home = await get('https://pelican-music.co.uk/');
  const js = home?.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  if (!js) return [];
  const bundle = await get('https://pelican-music.co.uk' + js);
  if (!bundle) return [];
  const n16 = bundle.match(/streetAddress:"([^"]+)",addressLocality:"([^"]+)",addressRegion:"([^"]+)",postalCode:"(N16[^"]+)"/);
  const out = [];
  for (const seg of bundle.split(/\{slug:"/).slice(1)) {
    const body = seg.split(/\}\]\}|\},\{slug:/)[0] + '}]';
    const name = body.match(/name:"([^"]+)"/)?.[1];
    const types = body.match(/types:\[([^\]]*)\]/)?.[1] || '';
    const locs = body.match(/locations:\[([^\]]*)\]/)?.[1] || '';
    const ageRange = body.match(/ageRange:"([^"]+)"/)?.[1] || '';
    if (!name || !/Baby and Toddler/.test(types) || !/N16/.test(locs)) continue;
    const am = ageRange.match(/(\d+)\s*[–-]\s*(\d+)\s*(months|years)/);
    if (!am) continue;
    const f = am[3] === 'years' ? 12 : 1;
    const [amin, amax] = [Number(am[1]) * f, Number(am[2]) * f];
    if (amin > 18) continue;
    const whens = [...body.matchAll(/when:"([^"]+)"/g)].map((m) => m[1]).join('\n');
    const { sessions } = parseSessions(whens);
    out.push(item({
      brand: 'Pelican Music',
      name: `Pelican Music ${name}`,
      provider: 'Pelican Music',
      venue: 'Pelican Music N16',
      address: n16 ? `${n16[1]}, ${n16[2]}, ${n16[3]} ${n16[4]}` : '',
      postcode: n16 ? normPc(n16[4]) : null,
      sessions,
      schedule_note: 'Term-time weekly class; 45 minutes',
      age_min_months: amin,
      age_max_months: amax,
      price: body.match(/cost:"([^"]+)"/)?.[1] || '',
      booking: 'book',
      url: body.match(/bookingUrl:"([^"]+)"/)?.[1] || 'https://pelican-music.co.uk/classes',
      source: 'pelican-music.co.uk',
    }));
  }
  return out;
}

// ---------------------------------------------------------------- Little Notes
async function littleNotes() {
  const finder = await get('https://www.littlenotes.co.uk/find-a-class/');
  if (!finder) return [];
  const areaLinks = [...new Set([...finder.matchAll(/href="(https:\/\/www\.littlenotes\.co\.uk\/(cardiff|guildford|horsham-and-dorking|chichester|[a-z-]+)\/?)"/g)]
    .map((m) => m[1].replace(/\/?$/, '/'))
    .filter((u) => !/\/(about|blog|benefits|age-ranges|work-with-us|privacy-policy|terms-and-conditions|find-a-class|amsterdam|the-hague|almere[^/]*|wp-json)\/$/.test(u) && u !== 'https://www.littlenotes.co.uk/'))];
  const out = [];
  for (const url of take(areaLinks)) {
    const html = (await get(url)) || (await get(url.replace(/\/$/, '')));
    if (!html) continue;
    const lines = toText(html).split('\n').map((s) => s.trim()).filter(Boolean);
    const area = clean(html.match(/<title>([\s\S]*?)<\/title>/)?.[1]).split(/[|–-]/)[0].trim();
    const seen = new Set();
    lines.forEach((l, i) => {
      if (!/^Address\b/i.test(l)) return;
      const chunk = [];
      for (let k = i; k < i + 5 && k < lines.length; k++) {
        chunk.push(lines[k].replace(/^Address\s*/i, ''));
        if (normPc(lines[k])) break;
      }
      const joined = chunk.filter(Boolean).join(', ');
      const pc = normPc(joined);
      if (!pc || seen.has(pc)) return;
      seen.add(pc);
      const dayHint = (lines.slice(Math.max(0, i - 3), i).join(' ').match(new RegExp(`\\b(${DAY_ALT})\\b`, 'i')) || [])[1];
      out.push(item({
        brand: 'Little Notes',
        name: 'Little Notes',
        provider: `Little Notes ${titleCase(new URL(url).pathname.replace(/\//g, ''))}`,
        venue: chunk.find(Boolean)?.split(',')[0] || area,
        address: joined,
        postcode: pc,
        sessions: [],
        schedule_note: `${dayHint ? `${dayHint.replace(/^./, (c) => c.toUpperCase())}. ` : ''}Class times and ages on the provider booking page`,
        age_min_months: 0,
        age_max_months: 48,
        booking: 'book',
        url,
        source: 'littlenotes.co.uk',
        confidence: 'medium',
      }));
    });
  }
  return out;
}

// ---------------------------------------------------------------- Jiggy Wrigglers
async function jiggyWrigglers() {
  const idx = await get('https://jiggywrigglers.com/locations/');
  if (!idx) return [];
  const links = [...new Set([...idx.matchAll(/href="((?:https:\/\/jiggywrigglers\.com)?\/locations\/[a-z0-9-]+)\/?"/g)]
    .map((m) => (m[1].startsWith('http') ? m[1] : 'https://jiggywrigglers.com' + m[1]) + '/'))];
  const out = [];
  for (const url of take(links)) {
    const html = await get(url);
    if (!html) continue;
    const lines = toText(html).split('\n').map((s) => s.trim()).filter(Boolean);
    const pageTitle = clean(html.match(/<title>([\s\S]*?)<\/title>/)?.[1]).split('|')[0].trim();
    const area = pageTitle && !/locations/i.test(pageTitle) ? pageTitle : titleCase(new URL(url).pathname.split('/').filter(Boolean).pop());
    const programmes = [...new Set(lines.filter((l) => /^Jiggy (Babies|Tots|Mixed)\b/i.test(l) && l.length > 12 && l.length < 80))];
    const has = (re) => programmes.some((p) => re.test(p));
    if (!programmes.length) continue;
    const ageMin = has(/babies/i) ? 0 : has(/mixed/i) ? 4 : 6;
    const ageMax = has(/mixed/i) ? 60 : has(/tots/i) ? 30 : 12;
    if (ageMin > 18) continue;
    const seen = new Set();
    for (const l of lines) {
      const m = l.match(/^([^:]{3,90}):\s*(.+)$/);
      if (!m) continue;
      const pc = normPc(m[2]);
      if (!pc || seen.has(pc) || /email|contact|phone/i.test(m[1])) continue;
      seen.add(pc);
      out.push(item({
        brand: 'Jiggy Wrigglers',
        name: 'Jiggy Wrigglers',
        provider: `Jiggy Wrigglers ${area}`,
        venue: m[1].trim(),
        address: `${m[1].trim()}, ${m[2].trim()}`,
        postcode: pc,
        sessions: [],
        schedule_note: `Area runs: ${programmes.join('; ')}. Session times on the provider booking page`,
        age_min_months: ageMin,
        age_max_months: ageMax,
        booking: 'book',
        url,
        source: 'jiggywrigglers.com',
        confidence: 'medium',
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- geocoding
async function geocode(items) {
  const pcs = [...new Set(items.map((i) => i.postcode).filter(Boolean))];
  const found = new Map();
  for (let i = 0; i < pcs.length; i += 100) {
    const json = await postJson('https://api.postcodes.io/postcodes', { postcodes: pcs.slice(i, i + 100) });
    for (const r of json.result || []) if (r.result) found.set(r.query.toUpperCase(), r.result);
  }
  const outcodes = new Map();
  for (const it of items) {
    const r = it.postcode && found.get(it.postcode);
    if (r) {
      if (!UK_COUNTRIES.has(r.country)) { it._drop = `country ${r.country}`; continue; }
      it.postcode = r.postcode;
      it.lat = r.latitude;
      it.lng = r.longitude;
      it._region = r.country === 'England' ? r.region || 'England' : r.country;
      continue;
    }
    const out = it.postcode?.split(' ')[0];
    if (!out) { it._drop = 'no postcode'; continue; }
    if (!outcodes.has(out)) {
      const txt = await get(`https://api.postcodes.io/outcodes/${encodeURIComponent(out)}`, { skipRobots: true });
      let res = null;
      try { res = txt ? JSON.parse(txt).result : null; } catch {}
      outcodes.set(out, res);
    }
    const o = outcodes.get(out);
    if (!o || o.latitude == null) { it._drop = `invalid postcode ${it.postcode}`; continue; }
    const country = (o.country || [])[0];
    if (country && !UK_COUNTRIES.has(country)) { it._drop = `country ${country}`; continue; }
    it.lat = o.latitude;
    it.lng = o.longitude;
    it.confidence = 'low';
    it._region = country === 'England' ? (o.region || [])[0] || 'England' : country || 'unknown';
  }
}

// ---------------------------------------------------------------- main
const BRANDS = {
  jojingles: joJingles,
  moo: mooMusic,
  minimozart: miniMozart,
  musicalbumps: musicalBumps,
  bachtobaby: bachToBaby,
  pelican,
  littlenotes: littleNotes,
  jiggy: jiggyWrigglers,
};

async function main() {
  await fs.mkdir(CACHE, { recursive: true });
  const blocked = [];
  if (!ONLY) {
    for (const b of BLOCKED_PROBES) {
      await throttle();
      try {
        const r = await fetch(b.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        blocked.push(`${b.brand}: HTTP ${r.status}`);
      } catch (e) { blocked.push(`${b.brand}: ${e.message}`); }
    }
  }
  let all = [];
  for (const [key, fn] of Object.entries(BRANDS)) {
    if (ONLY && !ONLY.includes(key)) continue;
    const items = await fn();
    log(`${key}: ${items.length} raw rows`);
    all.push(...items);
  }
  await geocode(all);
  const dropped = all.filter((i) => i._drop);
  all = all.filter((i) => !i._drop);

  // merge duplicates (same class name + venue + postcode)
  const merged = new Map();
  for (const it of all) {
    const k = `${it.name}|${it.venue.toLowerCase()}|${it.postcode}`;
    const prev = merged.get(k);
    if (!prev) { merged.set(k, it); continue; }
    prev.sessions = dedupeSessions([...prev.sessions, ...it.sessions]);
    prev.tier = prev.sessions.length ? 'timetable' : 'venue';
  }
  const final = [...merged.values()];

  const summary = {};
  for (const it of final) {
    const s = (summary[it._brand] ||= { rows: 0, timetable: 0, venue: 0, regions: {} });
    s.rows++;
    s[it.tier]++;
    s.regions[it._region] = (s.regions[it._region] || 0) + 1;
  }
  const clean = final.map(({ _brand, _region, _drop, _bookwhen, ...rest }) => rest);
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(clean, null, 1) + '\n');
  console.log(JSON.stringify({
    out: OUT,
    total: clean.length,
    summary,
    dropped: dropped.map((d) => `${d._brand} | ${d.venue} | ${d.postcode} | ${d._drop}`),
    blocked,
    requests: { network: stats.net, cache: stats.cache },
    errors: stats.errors,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
