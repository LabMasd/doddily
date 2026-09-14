#!/usr/bin/env node
// Little Days — UK community baby groups & feeding support collector.
// Sources: NCT branch "What's on" listings, BfN drop-in finder, ABM group finder,
// La Leche League GB group pages (curated from the cached pages).
// Polite: <=1 request/second, identifying User-Agent, on-disk cache.
//
// Usage: node groups.mjs [fetch-nct|fetch-abm|fetch-bfn|build|all] [--limit N]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)';
const CACHE = '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/groups/cache';
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'groups.json');
const WORK = path.join(CACHE, '..', 'work');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

const args = process.argv.slice(2);
const cmd = args[0] || 'all';
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

// ---------------------------------------------------------------- fetch helpers
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, { json = false, method = 'GET', body = null, maxAge = 3 * 864e5 } = {}) {
  const key = crypto.createHash('sha1').update(method + url + (body || '')).digest('hex');
  const f = path.join(CACHE, key);
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < maxAge) {
    const t = fs.readFileSync(f, 'utf8');
    return json ? JSON.parse(t) : t;
  }
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, {
    method,
    body,
    headers: { 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const t = await res.text();
  fs.writeFileSync(f, t);
  return json ? JSON.parse(t) : t;
}

// ---------------------------------------------------------------- text helpers
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };
const decode = (s) =>
  String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const strip = (s) => decode(String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const PC_RE = /\b([A-Z]{1,2}[0-9][0-9A-Z]?)\s*([0-9][A-Z]{2})\b/i;
const normPc = (s) => {
  const m = String(s || '').toUpperCase().match(PC_RE);
  return m ? `${m[1]} ${m[2]}` : '';
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_RE = /\b(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?s?\b/gi;
function dayIdx(tok) {
  const t = tok.toLowerCase().slice(0, 3);
  return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(t);
}
function parseDays(text) {
  const s = String(text);
  const out = new Set();
  const range = s.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:-|–|to)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i);
  if (range) {
    const a = dayIdx(range[1]), b = dayIdx(range[2]);
    if (a >= 0 && b >= a) for (let i = a; i <= b; i++) out.add(i);
  }
  for (const m of s.matchAll(DAY_RE)) {
    const i = dayIdx(m[1]);
    if (i >= 0) out.add(i);
  }
  return [...out].sort().map((i) => DAYS[i]);
}
const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
function parseTimeRange(text) {
  const s = String(text).replace(/12\s*(noon|midday)/gi, '12pm').replace(/\bnoon\b|\bmidday\b/gi, '12pm');
  // 4-digit 24h e.g. 1030-1130
  let m = s.match(/\b([01]\d|2[0-3])([0-5]\d)\s*(?:-|–|—|to)\s*([01]\d|2[0-3])([0-5]\d)\b/);
  if (m) {
    const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    if (b > a) return { start: hhmm(m[1], m[2]), end: hhmm(m[3], m[4]) };
  }
  m = s.match(/\b(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?/i);
  if (m) {
    let sh = +m[1], sm = +(m[2] || 0), eh = +m[4], em = +(m[5] || 0);
    const sa = (m[3] || '').toLowerCase(), ea = (m[6] || '').toLowerCase();
    if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
    if (!m[2] && !m[3] && !m[5] && !m[6] && (sh > 12 || eh > 12)) return null; // likely not a time
    let E = eh;
    if (ea === 'pm' && eh < 12) E = eh + 12;
    else if (ea === 'am' && eh === 12) E = 0;
    else if (!ea && eh <= 7) E = eh + 12;
    let S = sh;
    if (sa === 'pm' && sh < 12) S = sh + 12;
    else if (sa === 'am') S = sh === 12 ? 0 : sh;
    else if (!sa) {
      if (sh < 12 && sh + 12 < E && E >= 13 && sh <= 7) S = sh + 12;
      else if (sh <= 7 && ea !== 'am') S = sh + 12;
    }
    const a = S * 60 + sm, b = E * 60 + em;
    if (b > a && S >= 7 && E <= 22) return { start: hhmm(S, sm), end: hhmm(E, em) };
    return null;
  }
  m = s.match(/\b(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    let h = +m[1];
    if (m[3].toLowerCase() === 'pm' && h < 12) h += 12;
    if (h >= 7 && h <= 21) return { start: hhmm(h, +(m[2] || 0)), end: null };
  }
  return null;
}
function monthlyNote(text) {
  const m = String(text).match(/\b(first|second|third|fourth|last|1st|2nd|3rd|4th)\b[^.]{0,20}?\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/i);
  if (m) return `Monthly (${m[1].toLowerCase()} ${DAYS[dayIdx(m[2])]} of the month)`;
  if (/fortnight|every other/i.test(text)) return 'Fortnightly';
  if (/term[- ]time/i.test(text)) return 'Term time only';
  return '';
}
const orgPhone = (p) => {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (!/^(0|\+44)/.test(d)) return '';
  if (/^(07|\+447)/.test(d)) return ''; // mobiles are usually personal volunteer numbers
  return d.length >= 10 && d.length <= 13 ? String(p).trim() : '';
};

// ---------------------------------------------------------------- NCT
async function fetchNct() {
  const sm = await get('https://www.nct.org.uk/sitemap.xml');
  const roots = [...new Set([...sm.matchAll(/<loc>(https:\/\/www\.nct\.org\.uk\/local-activities-meet-ups\/[^/<]+)<\/loc>/g)].map((m) => m[1]))];
  console.log('NCT branch/area roots:', roots.length);
  const events = [];
  let n = 0;
  for (const root of roots) {
    if (n++ >= LIMIT) break;
    let html;
    try {
      html = await get(root);
    } catch (e) {
      console.warn(String(e));
      continue;
    }
    const branch = strip((html.match(/<title>([^<|]+)/) || [])[1] || root.split('/').pop());
    const pages = [html];
    const key = (html.match(/block_config_key=(block_events_listing_branch[^&"]+)/) || [])[1];
    const lastPage = Math.max(0, ...[...html.matchAll(/block_config_key=[^"]*?&amp;page=(\d+)/g)].map((m) => +m[1]));
    for (let p = 1; key && p <= Math.min(lastPage, 3); p++) {
      try {
        pages.push(await get(`${root}?block_config_key=${key}&page=${p}`));
      } catch (e) {
        console.warn(String(e));
      }
    }
    for (const h of pages) {
      for (const a of h.matchAll(/<article[^>]*node--type-event[\s\S]*?<\/article>/g)) {
        const art = a[0];
        const mon = strip((art.match(/uppercase text-lg[^>]*>([^<]+)</) || [])[1]);
        const day = strip((art.match(/text-3xl[^>]*>([^<]+)</) || [])[1]);
        const title = strip((art.match(/<span>([\s\S]*?)<\/span>/) || [])[1]);
        const lines = [...art.matchAll(/<div class="text-base font-normal[^>]*>([\s\S]*?)<\/div>/g)].map((m) => strip(m[1]));
        events.push({ root, branch, title, mon, day, time: lines[0] || '', venue: lines[1] || '' });
      }
    }
  }
  fs.writeFileSync(path.join(WORK, 'nct-events.json'), JSON.stringify(events, null, 1));
  console.log('NCT event cards:', events.length);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function nctRows() {
  const f = path.join(WORK, 'nct-events.json');
  if (!fs.existsSync(f)) return [];
  const evs = JSON.parse(fs.readFileSync(f, 'utf8'));
  const EXCLUDE = /nearly new|sale|first aid|antenatal|course|workshop|volunteer|agm|quiz|fundrais|coffee morning for volunteers|raffle|gala|market|fair\b|sling library|nappy library|bundle|training|meeting for|committee|zoom|online|virtual/i;
  const groups = new Map();
  const now = new Date('2026-09-15');
  for (const e of evs) {
    if (!e.title || EXCLUDE.test(e.title)) continue;
    const mi = MONTHS.indexOf(e.mon.toLowerCase().slice(0, 3));
    if (mi < 0) continue;
    let y = now.getFullYear();
    const d = new Date(Date.UTC(y, mi, +e.day));
    if (d < new Date(now.getTime() - 60 * 864e5)) d.setUTCFullYear(y + 1);
    const wd = DAYS[(d.getUTCDay() + 6) % 7];
    const k = [e.root, e.title.toLowerCase(), e.venue.toLowerCase(), e.time].join('|');
    if (!groups.has(k)) groups.set(k, { ...e, dates: new Set(), wds: new Set() });
    const g = groups.get(k);
    g.dates.add(d.toISOString().slice(0, 10));
    g.wds.add(wd);
  }
  const rows = [];
  for (const g of groups.values()) {
    if (g.dates.size < 2) continue; // recurring only
    const pc = normPc(g.venue);
    if (!pc) continue;
    const t = parseTimeRange(g.time);
    const days = [...g.wds];
    const dates = [...g.dates].sort();
    const gaps = dates.slice(1).map((d, i) => (new Date(d) - new Date(dates[i])) / 864e5);
    const minGap = Math.min(...gaps);
    const note = days.length > 1 ? 'Days vary; check the listing' : minGap >= 25 ? 'Monthly' : minGap >= 13 ? 'Fortnightly' : '';
    const title = g.title;
    const isFeed = /feed|breast|baby caf|milk/i.test(title);
    const isPlay = /toddler|play|stay|sensory|music|sing/i.test(title);
    const isWalk = /walk|buggy|pram/i.test(title);
    const venueParts = g.venue.split(',').map((s) => s.trim()).filter(Boolean);
    const branchName = g.branch.replace(/\s*\|.*$/, '').trim();
    rows.push({
      name: title.replace(/^NCT\s+/i, 'NCT ').trim(),
      provider: /^nct/i.test(branchName) ? branchName : `NCT ${branchName}`,
      category: isPlay && !isFeed ? 'stayplay' : 'support',
      venue: venueParts[0] || '',
      address: g.venue,
      postcode: pc,
      sessions: days.length === 1 ? [{ day: days[0], start: t?.start ?? null, end: t?.end ?? null }] : days.map((d) => ({ day: d, start: t?.start ?? null, end: t?.end ?? null })),
      schedule_note: note,
      age_min_months: 0,
      age_max_months: isPlay ? 48 : 12,
      price: '',
      free: false,
      booking: 'book',
      indoor: !isWalk,
      description: isFeed
        ? 'Volunteer-run NCT drop-in offering infant feeding support and a chance to meet other parents.'
        : isWalk
          ? 'Volunteer-led NCT walk and chat for parents with babies.'
          : isPlay
            ? 'Volunteer-run NCT play and chat session for parents and young children.'
            : 'Relaxed volunteer-run NCT meet-up for expectant parents and families with babies.',
      url: g.root,
      phone: '',
      source: 'nct.org.uk',
      confidence: t ? 'high' : 'medium',
    });
  }
  return rows;
}

// ---------------------------------------------------------------- BfN (WP Store Locator, category 272 = Drop-in Centre)
async function fetchBfn() {
  const centres = [[51.5, -0.1], [51.0, -3.5], [52.5, -1.5], [53.6, -2.2], [55.0, -1.8], [56.0, -3.8], [57.5, -4.5], [52.3, -4.0], [54.6, -6.5], [52.5, 1.0], [50.5, -4.8], [58.5, -3.5], [50.8, -1.0], [53.8, -0.5]];
  const all = new Map();
  for (const [la, lo] of centres) {
    const d = await get(`https://www.breastfeedingnetwork.org.uk/wp-admin/admin-ajax.php?action=store_search&lat=${la}&lng=${lo}&max_results=100&search_radius=200&filter=272`, { json: true });
    for (const x of d) all.set(x.id, x);
  }
  fs.writeFileSync(path.join(WORK, 'bfn.json'), JSON.stringify([...all.values()], null, 1));
  console.log('BfN drop-ins:', all.size);
}
function bfnRows() {
  const f = path.join(WORK, 'bfn.json');
  if (!fs.existsSync(f)) return [];
  const rows = [];
  for (const x of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    if (!/drop-in/i.test(x.terms || '')) continue;
    const hours = strip(x.hours);
    const parts = hours.split(/(?<=\d(?:am|pm)?)\s+(?=(?:mon|tue|wed|thu|fri|sat|sun))/i);
    const sessions = [];
    for (const p of parts.length ? parts : [hours]) {
      const days = parseDays(p);
      const t = parseTimeRange(p);
      for (const d of days) sessions.push({ day: d, start: t?.start ?? null, end: t?.end ?? null });
    }
    const city = strip(x.city) || strip(x.state);
    rows.push({
      name: `Breastfeeding drop-in – ${strip(x.store)}`,
      provider: city ? `Breastfeeding Network ${city}` : 'Breastfeeding Network',
      category: 'support',
      venue: strip(x.store),
      address: [x.address, x.address2, x.city].map(strip).filter(Boolean).join(', '),
      postcode: normPc(x.zip),
      srcLat: +x.lat, srcLng: +x.lng,
      sessions: dedupeSessions(sessions),
      schedule_note: monthlyNote(hours),
      age_min_months: 0,
      age_max_months: 24,
      price: 'Free',
      free: true,
      booking: 'drop-in',
      indoor: true,
      description: 'Breastfeeding drop-in run with trained peer supporters; no appointment needed.',
      url: /^https?:/.test(x.url || '') ? x.url : 'https://www.breastfeedingnetwork.org.uk/drop-in-centres-map/',
      phone: orgPhone(x.phone),
      source: 'breastfeedingnetwork.org.uk',
      confidence: sessions.some((s) => s.start) ? 'high' : 'medium',
    });
  }
  return rows;
}

// ---------------------------------------------------------------- ABM (WP Store Locator, adaptive sweep)
async function fetchAbm() {
  const all = new Map();
  let queries = 0, saturated = 0;
  async function q(la, lo, r) {
    if (queries++ >= LIMIT) return;
    const d = await get(`https://abm.me.uk/wp-admin/admin-ajax.php?action=store_search&lat=${la.toFixed(3)}&lng=${lo.toFixed(3)}&max_results=100&search_radius=${r}`, { json: true });
    for (const x of d) all.set(x.id, x);
    if (d.length >= 100) {
      if (r <= 5) { saturated++; return; }
      const nr = r >= 50 ? 25 : r >= 25 ? 10 : 5;
      const dLat = (nr / 69) * 1.1, dLng = dLat / Math.cos((la * Math.PI) / 180);
      for (const a of [-1, 1]) for (const b of [-1, 1]) await q(la + (a * dLat) / 2 * 1.2, lo + (b * dLng) / 2 * 1.2, nr);
      await q(la, lo, nr);
    }
  }
  // ~50-mile circles on a grid covering the UK
  for (let la = 50.0; la <= 60.9; la += 1.0)
    for (let lo = -8.2; lo <= 1.9; lo += 1.4) await q(la, lo, 50);
  fs.writeFileSync(path.join(WORK, 'abm.json'), JSON.stringify([...all.values()], null, 1));
  console.log('ABM stores via finder:', all.size, 'queries', queries, 'saturated 5mi cells', saturated);
  // REST total for coverage comparison
  const ids = [];
  for (let p = 1; p <= 20; p++) {
    let d;
    try {
      d = await get(`https://abm.me.uk/wp-json/wp/v2/wpsl_stores?per_page=100&page=${p}&_fields=id`, { json: true });
    } catch {
      break;
    }
    if (!d.length) break;
    ids.push(...d.map((x) => String(x.id)));
    if (d.length < 100) break;
  }
  const missing = ids.filter((i) => !all.has(i));
  fs.writeFileSync(path.join(WORK, 'abm-coverage.json'), JSON.stringify({ rest: ids.length, finder: all.size, missing: missing.length }, null, 1));
  console.log('ABM REST ids:', ids.length, 'missing from finder sweep:', missing.length);
}
function abmRows() {
  const f = path.join(WORK, 'abm.json');
  if (!fs.existsSync(f)) return [];
  const rows = [];
  for (const x of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    const name = strip(x.store);
    const text = [x.phone, x.hours, x.description].map(strip).filter(Boolean).join(' ');
    const isGroup = /group|drop|caf[eé]|support|peer|hub|meet|circle|bumps|baby|babies|feeding|breast|mums|club|social|clinic/i.test(name + ' ' + text);
    if (!isGroup) continue;
    if (/maternity unit|labour ward|hospital\b(?!.*group)|helpline|infant feeding team\b(?!.*group)/i.test(name) && !/group|drop|caf/i.test(name)) continue;
    if (/zoom|online|virtual|facebook group only/i.test(name)) continue;
    const days = parseDays(text);
    if (days.length >= 5) continue; // service opening hours rather than a group
    const t = parseTimeRange(text);
    const sessions = days.map((d) => ({ day: d, start: t?.start ?? null, end: t?.end ?? null }));
    const isNct = /\bNCT\b/.test(name);
    const isBfn = /\bBfN\b|breastfeeding network/i.test(name);
    rows.push({
      name,
      provider: isNct ? 'NCT' : isBfn ? 'Breastfeeding Network' : 'Local breastfeeding support group',
      category: 'support',
      venue: name,
      address: [x.address, x.address2, x.city].map(strip).filter(Boolean).join(', '),
      postcode: normPc(x.zip),
      srcLat: +x.lat, srcLng: +x.lng,
      sessions,
      schedule_note: monthlyNote(text),
      age_min_months: 0,
      age_max_months: 24,
      price: /£\s?\d/.test(text) ? (text.match(/£\s?\d+(?:\.\d\d)?/) || [''])[0] : 'Free',
      free: !/£\s?\d/.test(text),
      booking: /book|booking|register|appointment/i.test(text) ? 'book' : 'drop-in',
      indoor: !/walk/i.test(name),
      description: 'Local breastfeeding support group listed in the Association of Breastfeeding Mothers directory.',
      url: /^https?:/.test(x.url || '') ? x.url : 'https://abm.me.uk/find-a-local-breastfeeding-support-group/',
      phone: orgPhone(x.fax) || orgPhone(/^[\d\s+()]+$/.test(x.phone || '') ? x.phone : ''),
      source: 'abm.me.uk',
      confidence: t && days.length ? 'medium' : 'low',
    });
  }
  return rows;
}

// ---------------------------------------------------------------- La Leche League GB (curated from cached group pages, 2026-09-15)
// Only in-person, recurring meetings whose venue postcode is stated on the group page.
// Private homes and online meetings are excluded. Volunteer names/phones are not stored.
const LLL = [
  ['la-leche-league-barnet', 'La Leche League Barnet', 'Hope Corner Community Centre', '185 Mays Lane, Barnet', 'EN5 2DY', 'Fri', '10:00', '11:30', 'Fortnightly; dates on group website'],
  ['la-leche-league-berkshire', 'LLL Berkshire', 'Tutus Cafe, Palmer Park', 'Palmer Park, Reading', 'RG6 1LF', 'Wed', '10:30', null, 'Monthly (usually first Wed of the month)'],
  ['la-leche-league-berkshire', 'LLL Berkshire', 'IKEA Reading cafe', 'IKEA, Reading', 'RG31 7SD', 'Wed', '10:30', null, 'Monthly (usually third Wed of the month)'],
  ['la-leche-league-bristol', 'LLL Bristol', 'Divine Ceremony, The Sanctuary', '2 Zetland Rd, Bishopston, Bristol', 'BS6 7AE', 'Fri', '10:30', '12:00', 'Monthly (second Fri of the month); donations welcome'],
  ['la-leche-league-cotswolds', 'LLL Cotswolds (Cheltenham)', "Oakwood Children's Centre", 'Clyde Crescent, Cheltenham', 'GL52 5QH', 'Mon', '13:45', null, 'Monthly (usually last working Mon of the month)'],
  ['lll-cotswolds-nailsworth-meeting', 'LLL Cotswolds (Nailsworth)', 'Churchill Rd meeting venue', '20 Churchill Rd, Nailsworth', 'GL6 0HL', 'Wed', '11:00', null, 'Monthly (usually second Wed of the month)'],
  ['la-leche-league-east-london', 'LLL East London (Ilford)', 'Brisbane Road venue, Ilford', 'Brisbane Road, Ilford', 'IG1 4SL', 'Fri', '10:00', '12:00', 'Monthly (last Fri of the month); book via Eventbrite for full address', 'book'],
  ['la-leche-league-frome', 'LLL Frome', 'Little Origins Playroom', 'J19 Jenson Avenue, Commerce Park, Frome', 'BA11 2FQ', 'Wed', '14:00', '15:30', 'Usually weekly; about once a month meets elsewhere, check Facebook'],
  ['la-leche-league-harrogate', 'LLL Harrogate', 'The Village', 'Off Skipton Rd, Harrogate', 'HG1 3HE', 'Tue', '11:30', '13:00', 'Monthly (first Tue of the month); term time only'],
  ['la-leche-league-harrogate', 'LLL Harrogate (Starbeck)', 'The Living Room cafe', '93b High Street, Starbeck, Harrogate', 'HG2 7HL', 'Tue', '11:00', '12:30', 'Monthly (third Tue of the month); term time only'],
  ['la-leche-league-kent-6', 'LLL West Kent (Rochester)', "Messy Play, St Peter's Church", 'Delce Rd, Rochester', 'ME1 2EH', 'Wed', '10:00', '11:00', 'Leader attends a volunteer-run playgroup; confirm dates before attending'],
  ['la-leche-league-manchester', 'LLL Manchester (Cheadle)', 'Cheadle Library community room', 'Cheadle Library, Cheadle', 'SK8 1BB', 'Mon', '10:00', '11:45', 'Monthly (second Mon of the month); £1 donation requested', 'drop-in', 'Donation requested'],
  ['la-leche-league-manchester', 'LLL Manchester (Altrincham)', 'West Beverley Cafe', "20 Shaw's Rd, Altrincham", 'WA14 1QY', 'Thu', '12:00', '13:30', 'Monthly (first Thu of the month); £1 donation requested', 'drop-in', 'Donation requested'],
  ['la-leche-league-sheffield', 'LLL Sheffield', 'Sharrow Community Forum', 'Sheffield', 'S7 1DB', 'Mon', '12:45', '14:30', 'Monthly (second Mon of the month)'],
  ['la-leche-league-shipley', 'LLL Shipley', 'The Lodge, Roberts Park', 'Higher Coach Road, Saltaire', 'BD17 7LU', 'Thu', '09:30', '11:30', 'Monthly (third Thu of the month)'],
  ['lll-se-london-coin-st-community-centre-meetings', 'LLL South East London', 'Coin Street Community Centre', '108 Stamford St, London', 'SE1 9NH', 'Tue', '13:00', '15:00', 'Fortnightly; pre-register via the group form', 'book'],
  ['la-leche-league-southampton', 'LLL Southampton', "St James' Road Methodist Church", "St James' Road, Shirley, Southampton", 'SO15 5HE', 'Thu', '10:00', '12:00', 'Weekly in term time; monthly cafe meet-up on site'],
  ['la-leche-league-southampton', 'LLL Southampton (Fair Oak)', 'Fair Oak Village Hall', 'Shorts Road, Fair Oak', 'SO50 7EJ', 'Fri', '12:45', '14:45', 'Monthly (third Fri of the month)'],
  ['leatherhead-ashted', 'LLL East Surrey (Dorking)', 'Cafe Connect, Meadowbank Park', 'Next to Silvermere Softplay, Meadowbank Park, Dorking', 'RH4 1DX', 'Mon', '11:30', '13:00', 'Second and fourth Mon of the month; not on bank holidays'],
  ['lll-hertfordshire-wheathampstead-meetings', 'LLL Hertfordshire (St Albans)', 'Marshalswick Family Centre', 'Sherwood Park, Sherwood Avenue, St Albans', 'AL4 9QL', 'Fri', '10:00', '12:00', 'Monthly (usually third Fri of the month)'],
  ['lll-kent-canterbury-meetings', 'LLL East Kent (Canterbury)', 'Stag Coffee and Kitchen', 'Unit 10-11 Marlowe Arcade, Canterbury', 'CT1 2TJ', 'Wed', '10:00', '11:30', 'Monthly (second Wed of the month); no meeting in August'],
  ['lll-kent-gravesend-meetings', 'LLL West Kent (Gravesend)', 'Vegan Antics', '11 Windmill St, Gravesend', 'DA12 1AD', 'Fri', '10:00', '11:30', 'Monthly (first Fri of the month)'],
  ['lll-leeds', 'LLL Leeds (Wetherby children’s centre)', "Wetherby Children's Centre", 'Wetherby', 'LS22 6JS', 'Tue', '13:00', '14:30', 'Monthly (first Tue of the month); term time'],
  ['lll-leeds', 'LLL Leeds (The Cub nursery)', 'The Cub nursery cafe', 'Wetherby', 'LS22 5HG', 'Tue', '12:15', '13:45', 'Monthly (third Tue of the month); term time'],
  ['lll-margate', 'LLL Margate', 'All Saints Church', 'All Saints Avenue, Margate', 'CT9 5QL', 'Wed', '10:30', '12:00', 'Monthly (third Wed of the month)'],
  ['lll-newcastle-north-tyne', 'LLL Newcastle & North of Tyne', 'Baltic Centre for Contemporary Art', 'S Shore Rd, Gateshead', 'NE8 3BA', 'Sat', '10:30', '12:30', 'Monthly (usually third Sat of the month); check dates first'],
  ['lll-penzance', 'LLL Penzance', "St John's Hall", 'Penzance', 'TR18 2QW', 'Sat', '10:00', '11:30', 'Monthly (first Sat of the month)'],
  ['lll-south-east-london-bexleyheath-meetings', 'LLL West Kent (Dartford)', 'Orchard Shopping Centre', 'Dartford', 'DA1 1DN', 'Fri', '10:00', '11:30', 'Monthly (usually third Fri of the month)'],
  ['lll-warrington', 'LLL Warrington (Burtonwood)', 'Burtonwood Community Centre', 'Green Jones Brow, Burtonwood, Warrington', 'WA5 4LH', 'Fri', '09:30', '11:20', 'Monthly (last Fri of the month); low-cost playgroup', 'drop-in', 'Low cost'],
  ['lll-warrington', 'LLL Warrington', 'The Old School', '17 Fairfield St, Warrington', 'WA1 3AJ', 'Sat', '10:00', '12:00', 'Monthly (first Sat of the month)'],
  ['lll-widnes-st-helens', 'LLL Widnes & St Helens (St Helens)', 'Wonderland Community Centre', 'St Helens', 'WA10 3JQ', 'Sat', '10:00', '12:00', 'Monthly (first Sat of the month)'],
  ['lll-widnes-st-helens', 'LLL Widnes & St Helens (Widnes)', 'Warrington Road Family Hub', 'Widnes', 'WA8 0BS', 'Thu', '15:00', '17:00', 'Monthly (third Thu of the month)'],
  ['lll-widnes-st-helens', 'LLL Widnes & St Helens (bumps & fourth trimester)', 'Warrington Hospital maternity, Croft Wing', 'Warrington', 'WA5 1QG', 'Mon', '16:00', '17:00', 'Monthly (last Mon of the month); for pregnant parents and babies up to about 3 months', 'drop-in', 'Free', 3],
  ['lll-woking', 'LLL Woking', 'Knaphill Methodist Church', 'Broadway, Knaphill, Woking', 'GU21 2DR', 'Wed', '10:00', '12:00', 'Monthly (second Wed of the month)'],
  ['la-leche-league-farnham', 'La Leche League Farnham', '40 Degreez', 'Mike Hawthorn Drive, Farnham', 'GU9 7UT', 'Mon', '10:00', '12:00', 'Weekly; not on bank holidays'],
  ['lll-hambleton-district', 'LLL Hambleton District', 'Thirsk Community Library', '1 Chapel Street, Thirsk', 'YO7 1LU', 'Fri', '13:00', '15:00', 'Monthly (third Fri of the month)'],
];
function lllRows() {
  return LLL.map(([slug, provider, venue, address, pc, day, start, end, note, booking = 'drop-in', price = 'Free', ageMax = 36]) => ({
    name: 'Breastfeeding support meeting',
    provider,
    category: 'support',
    venue,
    address: `${address} ${pc}`,
    postcode: pc,
    sessions: [{ day, start, end }],
    schedule_note: note,
    age_min_months: 0,
    age_max_months: ageMax,
    price,
    free: price === 'Free' || price === 'Donation requested',
    booking,
    indoor: true,
    description: 'Free parent-to-parent breastfeeding support meeting led by accredited La Leche League volunteers.',
    url: `https://laleche.org.uk/supportgroup/${slug}/`,
    phone: '',
    source: 'laleche.org.uk',
    confidence: /usually|check|confirm/i.test(note) ? 'medium' : 'high',
  }));
}

// ---------------------------------------------------------------- build
function dedupeSessions(ss) {
  const seen = new Set();
  return ss.filter((s) => {
    const k = `${s.day}|${s.start}|${s.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
async function geocode(pcs) {
  const out = {};
  const list = [...new Set(pcs)];
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100);
    const r = await get('https://api.postcodes.io/postcodes', { json: true, method: 'POST', body: JSON.stringify({ postcodes: batch }), maxAge: 30 * 864e5 });
    for (const x of r.result) if (x.result) out[x.query] = { lat: x.result.latitude, lng: x.result.longitude, country: x.result.country, region: x.result.region || x.result.country };
  }
  return out;
}
async function build() {
  const parts = { nct: nctRows(), bfn: bfnRows(), abm: abmRows(), lll: lllRows() };
  for (const [k, v] of Object.entries(parts)) console.log(`${k}: ${v.length} candidate rows`);
  let rows = Object.values(parts).flat().filter((r) => r.postcode);
  const geo = await geocode(rows.map((r) => r.postcode));
  const dropped = rows.filter((r) => !geo[r.postcode]).length;
  rows = rows.filter((r) => geo[r.postcode]);
  // de-duplicate: same postcode + day + start (keep higher-confidence / structured source)
  const rank = { 'laleche.org.uk': 0, 'nct.org.uk': 1, 'breastfeedingnetwork.org.uk': 2, 'abm.me.uk': 3 };
  const conf = { high: 0, medium: 1, low: 2 };
  rows.sort((a, b) => conf[a.confidence] - conf[b.confidence] || rank[a.source] - rank[b.source]);
  const seen = new Set();
  const final = [];
  let dup = 0;
  for (const r of rows) {
    const keys = r.sessions.length ? r.sessions.map((s) => `${r.postcode}|${s.day}|${s.start}`) : [`${r.postcode}|${r.name.toLowerCase()}`];
    if (keys.some((k) => seen.has(k))) { dup++; continue; }
    keys.forEach((k) => seen.add(k));
    const g = geo[r.postcode];
    const sessions = dedupeSessions(r.sessions);
    final.push({
      name: r.name,
      provider: r.provider,
      category: r.category,
      venue: r.venue,
      address: r.address,
      postcode: r.postcode,
      lat: g.lat,
      lng: g.lng,
      sessions,
      tier: sessions.some((s) => s.day && s.start) ? 'timetable' : 'venue',
      schedule_note: r.schedule_note,
      age_min_months: r.age_min_months,
      age_max_months: r.age_max_months,
      price: r.price,
      free: r.free,
      booking: r.booking,
      indoor: r.indoor,
      description: r.description,
      url: r.url,
      phone: r.phone,
      source: r.source,
      confidence: r.confidence,
      _country: g.country,
      _region: g.region,
    });
  }
  const stats = { bySource: {}, byTier: {}, byCountry: {}, byRegion: {}, droppedInvalidPostcode: dropped, duplicates: dup };
  for (const r of final) {
    stats.bySource[r.source] = (stats.bySource[r.source] || 0) + 1;
    stats.byTier[r.tier] = (stats.byTier[r.tier] || 0) + 1;
    stats.byCountry[r._country] = (stats.byCountry[r._country] || 0) + 1;
    stats.byRegion[r._region] = (stats.byRegion[r._region] || 0) + 1;
    delete r._country;
    delete r._region;
  }
  fs.writeFileSync(OUT, JSON.stringify(final, null, 1));
  fs.writeFileSync(path.join(WORK, 'stats.json'), JSON.stringify(stats, null, 1));
  console.log(JSON.stringify(stats, null, 1));
  console.log('wrote', final.length, 'rows to', OUT);
}

const steps = { 'fetch-nct': fetchNct, 'fetch-abm': fetchAbm, 'fetch-bfn': fetchBfn, build };
if (cmd === 'all') {
  await fetchBfn();
  await fetchAbm();
  await fetchNct();
  await build();
} else if (steps[cmd]) await steps[cmd]();
else console.error('unknown command', cmd);
