#!/usr/bin/env node
// Little Days - UK TODDLER classes (roughly 12 months to 4 years) from brands already crawled.
// Node 22, built-in fetch only.
//
// Politeness: honest UA, robots.txt checked per origin before any network fetch, >= 1.1s between
// network requests, no retries on 401/403/429, nothing worked around. Page caches from the earlier
// music / movement / sensory runs are reused; only missing pages are fetched (cached under uk/toddler).
//
// Brands added here (toddler stages the earlier crawls left out):
//   Monkey Music   Jiggety-Jig (2 + 3 year olds), Ding-Dong (3 + 4 year olds)   - music cache
//   Mini Mozart    Toddlers (16 months - 4 years)                                 - music cache
//   TinyTalk       Toddler classes (from around 18 months)                        - movement cache + toddler-only search
//   Tumble Tots    Walking-2 years, 2-3 years, 3 years-school age per venue       - movement cache
//   Toddler Sense  WOW World Group venue index + toddlersense.com timetable feed  - fetched
// Already covered by existing rows (checked, not re-added): Jo Jingles Jingle Toddlers / Family Time,
// Jiggy Wrigglers (0-60 rows), Musical Bumps (0-48 rows), Sing and Sign (0-24 rows include Stage Two 14-24m),
// Puddle Ducks (Kickers + Little Dippers already in swim.json), Basking Babies (no toddler classes).
//
// Usage: node toddler-classes.mjs [--only monkey,minimozart,tinytalk,tumbletots,toddlersense] [--limit N]
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const UA = 'LittleDaysBot/1.0 (family app; links back to providers)';
const SCRATCH = '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk';
const CACHE = path.join(SCRATCH, 'toddler/cache');
const DATA = '/Users/marcos/little-days/data/uk-research';
const OUT = process.env.OUT || path.join(DATA, 'toddler-classes.json');
const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const ONLY = opt('only') ? opt('only').split(',') : null;
const LIMIT = opt('limit') ? Number(opt('limit')) : Infinity;
const take = (a) => a.slice(0, LIMIT);
fs.mkdirSync(CACHE, { recursive: true });

const log = (...a) => console.error('[toddler]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const stats = { net: 0, cache: 0, errors: [], blocked: [] };

// ---------------------------------------------------------------- cache lookup (earlier runs' schemes)
function fromEarlierCaches(url) {
  const tries = [
    [path.join(SCRATCH, 'music', sha1(url) + '.html'), 'raw'],
    [path.join(SCRATCH, 'movement/cache', sha1('GET ' + url + ' ') + '.json'), 'raw'],
    [path.join(SCRATCH, 'movement/cache', sha1('GET ' + url + ' ') + '.html'), 'raw'],
    [path.join(SCRATCH, 'sensory/cache', `${url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}_${sha1('GET ' + url + ' ').slice(0, 16)}`), 'wrapped'],
    [path.join(CACHE, sha1(url) + '.txt'), 'raw'],
  ];
  for (const [f, kind] of tries) {
    if (!fs.existsSync(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    if (!t.length) continue;
    if (kind === 'wrapped') {
      try { const j = JSON.parse(t); if (j.status === 200) return j.text; } catch {}
      continue;
    }
    return t;
  }
  return null;
}

// ---------------------------------------------------------------- polite fetch
let lastNet = 0;
async function throttle() {
  const wait = lastNet + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastNet = Date.now();
}
async function netFetch(url, init = {}) {
  await throttle();
  stats.net++;
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: '', error: e.message };
  }
}
async function get(url, { skipRobots = false } = {}) {
  const hit = fromEarlierCaches(url);
  if (hit != null) { stats.cache++; return hit; }
  if (!skipRobots && !(await robotsAllowed(url))) { stats.blocked.push(`robots.txt disallows ${url}`); return null; }
  const r = await netFetch(url, { headers: { Accept: 'text/html,application/json,*/*' } });
  if ([401, 403, 429].includes(r.status)) { stats.blocked.push(`HTTP ${r.status} ${url} (not retried)`); return null; }
  if (r.status !== 200) { stats.errors.push(`HTTP ${r.status || r.error} ${url}`); return null; }
  fs.writeFileSync(path.join(CACHE, sha1(url) + '.txt'), r.text);
  return r.text;
}

// ---------------------------------------------------------------- robots.txt (group for our UA, else *; longest match wins)
const robotsCache = new Map();
function parseRobots(txt) {
  const groups = [];
  let cur = null, lastUA = false;
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastUA = true;
    } else {
      lastUA = false;
      if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', path: v });
    }
  }
  const blocksAI = groups.some((g) => g.agents.some((a) => /claudebot|anthropic-ai|claude-web/.test(a)) && g.rules.some((r) => !r.allow && r.path === '/'));
  const aiTrainNo = /ai-train\s*=\s*no/i.test(txt);
  const mine = groups.filter((g) => g.agents.some((a) => a && a !== '*' && 'littledaysbot'.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  return { rules, blockAll: blocksAI || aiTrainNo };
}
function robotsMatch(pattern, p) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : '')).test(p);
}
async function robotsAllowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    const r = await netFetch(u.origin + '/robots.txt');
    let parsed = { rules: [], blockAll: false };
    if (r.status === 200 && !/<html/i.test(r.text.slice(0, 500))) parsed = parseRobots(r.text);
    else if (r.status === 401 || r.status === 403) parsed = { rules: [], blockAll: true };
    robotsCache.set(u.origin, parsed);
  }
  const { rules, blockAll } = robotsCache.get(u.origin);
  if (blockAll) return false;
  const p = u.pathname + u.search;
  let best = null;
  for (const r of rules) {
    if (!r.path || !robotsMatch(r.path, p)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

// ---------------------------------------------------------------- text helpers
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };
const decode = (s) => String(s ?? '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const clean = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const PC_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
function normPc(s) {
  const m = String(s || '').toUpperCase().match(PC_RE);
  return m ? `${m[1].replace(/^([A-Z])0(\d)/, '$1O$2')} ${m[2]}` : null;
}
const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const DAY = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n) => String(n).padStart(2, '0');
function to24(h, m, ap) {
  h = Number(h); m = Number(m || 0);
  if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}
function dedupeSessions(list) {
  const seen = new Map();
  for (const s of list) {
    const k = `${s.day}|${s.start}`;
    if (!seen.has(k) || (!seen.get(k).end && s.end)) seen.set(k, s);
  }
  return [...seen.values()].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || String(a.start).localeCompare(String(b.start)));
}
const money = (n) => `£${Number(n).toFixed(2)}`;

// ---------------------------------------------------------------- row builder
const DESC = {
  jiggety: 'Weekly music class for two and three year olds with songs, percussion and movement games.',
  dingdong: 'Weekly music class for three and four year olds building rhythm, singing and listening skills.',
  mozart: 'Nursery rhyme and classical music class for toddlers, led by live musicians.',
  tinytalk: 'Toddler signing class using songs, stories and puppets to build early language and BSL signs.',
  tt_walk: 'Active play session for newly walking toddlers on soft equipment, with a grown-up joining in.',
  tt_23: 'Physical play session for two to three year olds building balance, climbing and coordination with a grown-up.',
  tt_3: 'Physical play session for pre-schoolers building confidence and coordination, with parents staying on site.',
  toddlersense: 'Sensory and physical play class for toddlers with themed activities, music and equipment.',
};
function row(o) {
  const sessions = dedupeSessions(o.sessions || []);
  return {
    name: o.name,
    provider: o.provider,
    category: o.category,
    venue: clean(o.venue),
    address: clean(o.address).replace(/\s+,/g, ',').replace(/(,\s*)+,/g, ',').replace(/^,\s*|,\s*$/g, ''),
    postcode: o.postcode,
    lat: 0,
    lng: 0,
    sessions,
    tier: sessions.some((s) => s.day && s.start) ? 'timetable' : 'venue',
    schedule_note: (o.schedule_note || '').slice(0, 240),
    age_min_months: o.age_min_months,
    age_max_months: o.age_max_months,
    price: o.price || '',
    free: false,
    booking: o.booking || 'term',
    indoor: true,
    description: o.description,
    url: o.url,
    phone: o.phone || '',
    source: o.source,
    confidence: o.confidence || 'high',
    _brand: o.brand,
  };
}

// ---------------------------------------------------------------- Monkey Music (older stages)
async function monkeyMusic() {
  const list = await get('https://www.monkeymusic.co.uk/franchise-list');
  if (!list) return [];
  const townBySlug = new Map();
  for (const r of list.split('class="views-row').slice(1)) {
    const town = clean(r.match(/field-franchisee-town"><div class="field-content">([\s\S]*?)<\/div>/)?.[1]);
    const slug = r.match(/href="(\/area\/[a-z0-9-]+)"/)?.[1];
    if (town && slug && !townBySlug.has(slug)) townBySlug.set(slug, town);
  }
  const areas = [...new Set([...list.matchAll(/href="(\/area\/[a-z0-9-]+)"/g)].map((m) => 'https://www.monkeymusic.co.uk' + m[1]))];
  const byKey = new Map();
  for (const url of take(areas)) {
    const html = await get(url);
    const tt = html?.split('<div id="timetable">')[1];
    if (!tt) continue;
    const area = townBySlug.get(new URL(url).pathname) || titleCase(url.split('/').pop());
    for (const dayBox of tt.split('class="daybox"').slice(1)) {
      const day = DAY[clean(dayBox.match(/<h3>([\s\S]*?)<\/h3>/)?.[1]).toLowerCase().replace(/s$/, '')] || null;
      for (const venueBox of dayBox.split('class="venuebox"').slice(1)) {
        const address = clean(venueBox.match(/<h4>([\s\S]*?)<\/h4>/)?.[1]);
        for (const cr of venueBox.split('class="classrow"').slice(1)) {
          const time = clean(cr.match(/class="classtime">([\s\S]*?)<\/div>/)?.[1]);
          const details = cr.match(/class="classdetails">([\s\S]*?)<\/div>/)?.[1] || '';
          const cls = clean(details.match(/<strong>([\s\S]*?)<\/strong>/)?.[1]);
          const label = clean(details.replace(/<strong>[\s\S]*?<\/strong>/, ''));
          const ym = label.match(/(\d)\s*(?:\+|&|and)\s*(\d)\s*year olds/i);
          if (!ym || !/jiggety|ding.?dong/i.test(cls)) continue; // Rock'n'Roll + Heigh-Ho already in music.json
          const ages = [Number(ym[1]) * 12, (Number(ym[2]) + 1) * 12];
          const tm = time.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)/i);
          const key = `${cls}|${address}`;
          const rec = byKey.get(key) || row({
            brand: 'Monkey Music', name: `Monkey Music ${cls}`, provider: `Monkey Music ${area}`, category: 'music',
            venue: address.split(',')[0], address, postcode: normPc(address), sessions: [],
            schedule_note: `For ${label.toLowerCase()}; term-time weekly class, first class free`,
            age_min_months: ages[0], age_max_months: ages[1], booking: 'term',
            description: /jiggety/i.test(cls) ? DESC.jiggety : DESC.dingdong,
            url, source: 'monkeymusic.co.uk',
          });
          if (day && tm) rec.sessions = dedupeSessions([...rec.sessions, { day, start: to24(tm[1], tm[2], tm[3]), end: null }]);
          rec.tier = rec.sessions.length ? 'timetable' : 'venue';
          byKey.set(key, rec);
        }
      }
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------- Mini Mozart (Toddlers)
async function miniMozart() {
  const sm = await get('https://www.minimozart.com/venue-sitemap.xml');
  if (!sm) return [];
  const venues = [...sm.matchAll(/<loc>([^<]*\/venue\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  const out = [];
  for (const url of take(venues)) {
    const html = await get(url);
    const det = html?.match(/<div class="product-det">([\s\S]*?)<\/div>/)?.[1];
    if (!det) continue;
    const timeSpan = det.match(/<span class="time">([\s\S]*?)<\/span>/)?.[1] || '';
    const locText = clean(det.match(/<span class="location">([\s\S]*?)<\/span>/)?.[1]).replace(/\(see on Google Maps\)/i, '').trim();
    const lm = locText.match(/^(.+?)\s*\(([A-Za-z]+)\)\s*,\s*(.+)$/);
    if (!lm) continue;
    const [, area, dayWord, restRaw] = lm;
    const rest = restRaw.replace(/(\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\s+\1\s*$/i, '$1').trim();
    const first = rest.split(',')[0].trim();
    const day = DAY[dayWord.toLowerCase().replace(/s$/, '')] || null;
    for (const part of timeSpan.split(/<br\s*\/?>/i)) {
      const m = clean(part.replace(/<a [^>]*>\s*\(book now\)\s*<\/a>/i, '')).match(/^[–-]?\s*(.+?)\s+(\d{1,2})[:.](\d{2})\s*(am|pm)/i);
      if (!m || !/^toddlers$/i.test(m[1].trim())) continue; // Babies / Babies & Toddlers already in music.json
      out.push(row({
        brand: 'Mini Mozart', name: 'Mini Mozart Toddlers', provider: `Mini Mozart ${area}`, category: 'music',
        venue: /^\d/.test(first) ? `Mini Mozart ${area}` : first, address: rest, postcode: normPc(rest),
        sessions: day ? [{ day, start: to24(m[2], m[3], m[4]), end: null }] : [],
        schedule_note: 'For children from 16 months who are confidently toddling; term-time weekly class, monthly membership',
        age_min_months: 16, age_max_months: 48, booking: 'term', description: DESC.mozart,
        url: part.match(/href="([^"]+)"/)?.[1] || url, source: 'minimozart.com',
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- TinyTalk (toddler classes)
async function tinyTalk() {
  const bon = encodeURIComponent('((49.8, -8.7), (60.9, 1.8))');
  const venues = new Map();
  for (const sf of ['tc', 'nb%2Cbsc%2Ctc']) { // toddler-only search (under the 190-result cap) + the earlier combined search
    const txt = await get(`https://www.tinytalk.co.uk/ajax-search-classes.php?skpb=true&setb=false&ubon=true&bon=${bon}&sf=${sf}`);
    let j = {};
    try { j = JSON.parse(txt || '{}'); } catch {}
    for (const [k, v] of Object.entries(j)) if (k !== 'count' && !venues.has(`${v.ID}|${v.ClassType}`)) venues.set(`${v.ID}|${v.ClassType}`, v);
  }
  const out = [];
  for (const v of take([...venues.values()])) {
    const txt = await get(`https://www.tinytalk.co.uk/ajax-venue-details.php?cid=${v.ID}&type=${v.ClassType}`);
    let d;
    try { d = JSON.parse(txt || ''); } catch { continue; }
    if (d?.status !== 'ok' || !d.data) continue;
    const addrLines = [...new Set(String(d.data.address || '').split(/<br\s*\/?>/i).map(clean).map((x) => x.replace(/,$/, '')).filter(Boolean))];
    const postcode = normPc(addrLines.join(', '));
    const ns = d.data.nextsetps || {};
    if (/private|nursery children only|members only/i.test(`${v.Name} ${addrLines.join(' ')}`)) { stats.errors.push(`skipped private class: TinyTalk ${clean(v.Name)}`); continue; }
    if (/online|e-class|tinytalktv|zoom/i.test(clean(v.Name))) { stats.errors.push(`skipped online listing: TinyTalk ${clean(v.Name)}`); continue; }
    for (const cls of Object.values(d.data.when || {})) {
      if (!/toddler/i.test(cls.name)) continue;
      const sessions = [];
      let online = 0, inperson = 0;
      for (const t of cls.times || []) {
        const s = clean(String(t));
        if (/online/i.test(s)) { online++; continue; }
        inperson++;
        const m = s.match(/^([A-Za-z]+)\s*,\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap]m)\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap]m)/i);
        if (m && DAY[m[1].toLowerCase()]) sessions.push({ day: DAY[m[1].toLowerCase()], start: to24(m[2], m[3], m[4]), end: to24(m[5], m[6], m[7]) });
      }
      if (online && !inperson) continue;
      out.push(row({
        brand: 'TinyTalk', name: 'TinyTalk Toddler Talking', provider: `TinyTalk ${clean(v.townName)}`.trim(), category: 'sensory',
        venue: clean(v.Name) || addrLines[0], address: addrLines.join(', '), postcode, sessions,
        schedule_note: sessions.length ? 'Generally suitable from around 18 months' : 'Generally suitable from around 18 months; check the local page for class times',
        age_min_months: 18, age_max_months: 48, booking: 'term', description: DESC.tinytalk,
        url: ns.website || ns.print_url || 'https://www.tinytalk.co.uk/toddler-activity-classes.php',
        phone: ns.phone ? String(ns.phone).trim() : '', source: 'tinytalk.co.uk',
        confidence: sessions.length ? 'high' : 'medium',
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- Tumble Tots (walking to school age)
const TT_STAGES = [
  { name: 'Tumble Tots Walking to 2 Years', min: 12, max: 24, desc: 'tt_walk', page: 'walking-to-2-years-class' },
  { name: 'Tumble Tots 2 to 3 Years', min: 24, max: 36, desc: 'tt_23', page: '2-to-3-years' },
  { name: 'Tumble Tots 3 Years to School Age', min: 36, max: 60, desc: 'tt_3', page: '3-years-to-school-age' },
];
async function tumbleTots() {
  const txt = await get('https://www.tumbletots.com/wp-admin/admin-ajax.php?action=wd_tt_all_locations_data&limit=500');
  let d = {};
  try { d = JSON.parse(txt || '{}'); } catch {}
  const out = [];
  for (const r of take(d?.data?.rows || [])) {
    const lines = String(r.address || '').split('\n').map(clean).map((x) => x.replace(/,$/, '')).filter(Boolean);
    const postcode = normPc(lines.join(', '));
    const days = (r.class_days || []).map((x) => DAY[String(x).toLowerCase()]).filter(Boolean);
    for (const st of TT_STAGES) {
      out.push(row({
        brand: 'Tumble Tots', name: st.name, provider: `Tumble Tots ${clean(r.franchise_title)}`, category: 'movement',
        venue: lines[0], address: lines.join(', '), postcode,
        sessions: days.map((day) => ({ day, start: null, end: null })),
        schedule_note: days.length
          ? `Tumble Tots runs at this venue on ${days.join(', ')}; check the branch booking page for which age groups run and times`
          : 'Check the branch booking page for which age groups run and times',
        age_min_months: st.min, age_max_months: st.max, booking: 'book', description: DESC[st.desc],
        url: r.franchise_url || `https://www.tumbletots.com/class/${st.page}/`, phone: clean(r.tel),
        source: 'tumbletots.com', confidence: 'medium',
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- Toddler Sense (WOW World Group)
function parseAgeRange(str) {
  const s = clean(str).toLowerCase();
  const part = (t) => {
    if (!t) return null;
    if (/birth|newborn/.test(t)) return 0;
    const y = t.match(/(\d+)\s*(?:years?|yrs?)/), mo = t.match(/(\d+)\s*(?:months?|mths?)/), w = t.match(/(\d+)\s*(?:weeks?|wks?)/);
    if (!y && !mo && !w) { const n = t.match(/(\d+)/); return n ? Number(n[1]) : null; }
    return (y ? Number(y[1]) * 12 : 0) + (mo ? Number(mo[1]) : 0) + (w ? Math.floor(Number(w[1]) / 4.345) : 0);
  };
  const [a, b] = s.split(/\s+(?:to|until)\s+|\s*[-–]\s*/);
  let lo = part(a), hi = part(b);
  if (lo != null && hi != null && !/month|year|week/.test(a) && /year/.test(b) && !/month/.test(b)) lo *= 12;
  return [lo, hi];
}
async function toddlerSense() {
  const idx = await get('https://www.wowworldgroup.com/find-a-class') || (fs.existsSync(path.join(SCRATCH, 'sensory/wow_find.html')) ? fs.readFileSync(path.join(SCRATCH, 'sensory/wow_find.html'), 'utf8') : null);
  if (!idx) return [];
  const at = idx.indexOf('const allVenues');
  const all = JSON.parse(idx.slice(idx.indexOf('[', at)).match(/^\[[\s\S]*?\}\](?=\s*;|\s*\n)/)[0]);
  const bySlug = new Map();
  for (const v of all) {
    if (v.SiteID !== 3 || v.ProductStream !== 2) continue;
    let u; try { u = new URL(v.MiniSiteUrl); } catch { continue; }
    if (u.host !== 'www.toddlersense.com') continue;
    const slug = u.pathname.replace(/\//g, '').toLowerCase();
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(v);
  }
  log(`Toddler Sense: ${[...bySlug.values()].flat().length} UK index venues across ${bySlug.size} area sites`);
  const norm = (s) => clean(s).toLowerCase().replace(/\b(the|st|saint|church|hall|centre|center|community|village|parish|and)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const out = [];
  let n = 0;
  for (const [slug, venues] of take([...bySlug.entries()])) {
    n++;
    const forSale = venues.every((v) => /for sale/i.test(v.ClassLeader || ''));
    const base = `https://www.toddlersense.com/${slug}/`;
    const home = await get(base);
    if (!home) continue;
    const cid = home.match(/CompanyID=(\d+)/)?.[1];
    const title = clean(home.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
    const h1 = clean(home.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
    // "Toddler Sense - award winning toddler classes in Bexley" or <h1>Welcome to Toddler Sense Bournemouth</h1>
    let area = title.match(/\bclasses in\s+(.+?)\s*$/i)?.[1] || h1.match(/^Welcome to Toddler Sense\s+(.+)$/i)?.[1] || titleCase(slug);
    area = area.replace(/\s*[-–|:]\s*(franchise|now|new|coming|welcome).*$/i, '').replace(/[!.]+$/, '').trim();
    if (!area || area.length > 45 || /award|toddler|classes|for sale/i.test(area)) area = titleCase(slug);
    const provider = `Toddler Sense ${area}`;
    const phone = clean(home.match(/href="tel:([^"]+)"/i)?.[1] || '');
    const url = new RegExp(`href="(?:https://www\\.toddlersense\\.com)?/${slug}/timetable/?"`, 'i').test(home) ? `${base}timetable` : base;
    let tt = { timetable: [] };
    if (cid) {
      const api = await get(`https://www.toddlersense.com/api/v1/minisite/loadTimeTable?companyID=${cid}&customerID=0`);
      try { tt = JSON.parse(api || '{}'); } catch { stats.errors.push(`timetable not JSON ${slug}`); }
    }
    const matchVenue = (name, address) => {
      const pc = normPc(address);
      if (pc) { const v = venues.find((x) => normPc(x.PostCode) === pc); if (v) return v; }
      const nn = norm(name);
      return venues.find((x) => { const vn = norm(x.Name); return vn && nn && (vn === nn || vn.includes(nn) || nn.includes(vn)); }) || null;
    };
    const groups = new Map();
    for (const e of tt.timetable || []) {
      if (e.ProductStreamID !== 2 || e.PriorityProductClassType === 2) continue; // toddler stream; skip one-off specials
      const [lo, hi] = parseAgeRange(e.AgeRange);
      const key = `${e.VenueID}|${lo}|${hi}`;
      if (!groups.has(key)) groups.set(key, { e0: e, lo, hi, entries: [] });
      groups.get(key).entries.push(e);
    }
    const used = new Set();
    for (const g of groups.values()) {
      const v = matchVenue(g.e0.Venue, g.e0.Address);
      if (v) used.add(v.VenueID);
      const postcode = normPc(g.e0.Address) || normPc(v?.PostCode);
      const sessions = [];
      let payg = null, term = null, fixed = false;
      for (const e of g.entries) {
        for (const sch of e.SchedulesFormatted || []) {
          const m = clean(sch).match(/^(\w+day)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i);
          if (m && DAY[m[1].toLowerCase()]) sessions.push({ day: DAY[m[1].toLowerCase()], start: to24(m[2], m[3]), end: to24(m[4], m[5]) });
        }
        for (const p of e.Products || []) {
          if (p.fixedTerm) { fixed = true; term = term ?? p.price; }
          else if (!p.trial && p.productSessions === 1) payg = payg ?? p.price;
        }
      }
      const price = [payg != null && `${money(payg)} per class`, term != null && `${money(term)} per term`].filter(Boolean).join('; ');
      const addr = clean(g.e0.Address) || (v ? [v.AddressLine1, v.AddressLine2, v.City].map(clean).filter(Boolean).join(', ') : '');
      out.push(row({
        brand: 'Toddler Sense', name: 'Toddler Sense', provider, category: 'sensory',
        venue: g.e0.Venue, address: addr, postcode, sessions,
        schedule_note: `Ages ${clean(g.e0.AgeRange)}; ${fixed ? 'termly booking, see site for term dates' : 'see site for dates'}`,
        age_min_months: g.lo ?? 13, age_max_months: g.hi ?? 48, price, booking: fixed ? 'term' : 'book',
        description: DESC.toddlersense, url, phone, source: 'toddlersense.com',
        confidence: sessions.length && g.lo != null ? 'high' : 'medium',
      }));
    }
    // index venues with no current timetable entries -> venue tier (skip areas listed as for sale)
    if (!forSale) {
      for (const v of venues) {
        if (used.has(v.VenueID) || !v.Name || /for sale/i.test(v.ClassLeader || '')) continue;
        const days = (v.RunningDays || []).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d - 1]).filter(Boolean);
        if (!days.length) continue; // no running days and no timetable: likely not active
        out.push(row({
          brand: 'Toddler Sense', name: 'Toddler Sense', provider, category: 'sensory', venue: v.Name,
          address: [v.AddressLine1, v.AddressLine2, v.City].map(clean).filter(Boolean).join(', '), postcode: normPc(v.PostCode),
          sessions: days.map((day) => ({ day, start: null, end: null })),
          schedule_note: `Runs ${days.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)).join(', ')}; times not currently listed online`,
          age_min_months: 13, age_max_months: 48, booking: 'term', description: DESC.toddlersense, url, phone,
          source: 'toddlersense.com', confidence: 'medium',
        }));
      }
    }
    log(`  [${n}/${bySlug.size}] ${slug}: ${groups.size} timetabled classes`);
  }
  return out;
}

// ---------------------------------------------------------------- geocoding (postcodes.io bulk, strict)
async function geocode(items) {
  const UK = new Set(['England', 'Scotland', 'Wales', 'Northern Ireland']);
  const pcs = [...new Set(items.map((i) => i.postcode).filter(Boolean))];
  const found = new Map();
  for (let i = 0; i < pcs.length; i += 100) {
    const body = JSON.stringify({ postcodes: pcs.slice(i, i + 100) });
    const f = path.join(CACHE, sha1('POST postcodes ' + body) + '.json');
    let json;
    if (fs.existsSync(f)) json = JSON.parse(fs.readFileSync(f, 'utf8'));
    else {
      const r = await netFetch('https://api.postcodes.io/postcodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (r.status !== 200) { stats.errors.push(`postcodes.io HTTP ${r.status}`); continue; }
      json = JSON.parse(r.text);
      fs.writeFileSync(f, r.text);
    }
    for (const x of json.result || []) if (x.result) found.set(x.query.toUpperCase(), x.result);
  }
  for (const it of items) {
    const g = it.postcode && found.get(it.postcode);
    if (!g) { it._drop = it.postcode ? `invalid postcode ${it.postcode}` : 'no postcode'; continue; }
    if (!UK.has(g.country)) { it._drop = `country ${g.country}`; continue; }
    it.postcode = g.postcode;
    it.lat = g.latitude;
    it.lng = g.longitude;
    it._region = g.country === 'England' ? g.region || 'England' : g.country;
  }
}

// ---------------------------------------------------------------- main
const BRANDS = { monkey: monkeyMusic, minimozart: miniMozart, tinytalk: tinyTalk, tumbletots: tumbleTots, toddlersense: toddlerSense };
let all = [];
for (const [k, fn] of Object.entries(BRANDS)) {
  if (ONLY && !ONLY.includes(k)) continue;
  try { const r = await fn(); log(`${k}: ${r.length} raw rows`); all.push(...r); }
  catch (e) { stats.errors.push(`${k} failed: ${e.stack}`); log(`${k} FAILED`, e); }
}

// age scope: overlaps 12-48 months and starts at 10 months or later
const outOfScope = all.filter((i) => !(i.age_min_months >= 10 && i.age_min_months <= 48 && i.age_max_months >= 12));
all = all.filter((i) => !outOfScope.includes(i));

await geocode(all);
const dropped = all.filter((i) => i._drop);
all = all.filter((i) => !i._drop);

// merge duplicates within this file (same class + venue + postcode + ages)
const merged = new Map();
for (const it of all) {
  const k = [it.name, it.venue.toLowerCase(), it.postcode, it.age_min_months, it.age_max_months].join('|');
  const prev = merged.get(k);
  if (!prev) { merged.set(k, it); continue; }
  prev.sessions = dedupeSessions([...prev.sessions, ...it.sessions]);
  prev.tier = prev.sessions.some((s) => s.day && s.start) ? 'timetable' : 'venue';
}

// skip anything already present in the existing files with the same class name, postcode and age range
const existing = new Set();
for (const f of ['music', 'movement', 'sensory', 'swim']) {
  for (const r of JSON.parse(fs.readFileSync(path.join(DATA, `${f}.json`), 'utf8'))) existing.add([r.name, r.postcode, r.age_min_months, r.age_max_months].join('|'));
}
const final = [...merged.values()].filter((r) => !existing.has([r.name, r.postcode, r.age_min_months, r.age_max_months].join('|')));
const alreadyPresent = merged.size - final.length;

const summary = {};
const regions = {};
for (const it of final) {
  const s = (summary[it._brand] ||= { rows: 0, timetable: 0, venue: 0 });
  s.rows++; s[it.tier]++;
  regions[it._region] = (regions[it._region] || 0) + 1;
}
const clean_ = final.map(({ _brand, _region, _drop, ...rest }) => rest);
fs.writeFileSync(OUT, JSON.stringify(clean_, null, 1) + '\n');
console.log(JSON.stringify({
  out: OUT, total: clean_.length, summary, regions,
  out_of_age_scope: outOfScope.length, dropped_no_valid_postcode: dropped.length,
  dropped_detail: dropped.slice(0, 40).map((d) => `${d._brand} | ${d.venue} | ${d.postcode} | ${d._drop}`),
  already_present_in_existing_files: alreadyPresent,
  requests: { network: stats.net, cache: stats.cache }, blocked: stats.blocked, errors: stats.errors.slice(0, 40),
}, null, 2));
