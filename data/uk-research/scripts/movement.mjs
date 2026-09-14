#!/usr/bin/env node
// Little Days — UK baby movement / signing / massage / fitness directory crawler.
// Node 22 (global fetch). Polite: <=1 req/s per host, identifying UA, raw pages cached.
//
// Usage: node movement.mjs [--only=tinytalk,tumbletots,...] [--limit=N]
//
// Sources and access notes (checked 2026-09-15):
//   tinytalk.co.uk      — public class-finder JSON endpoints used by its own map (robots: allowed)
//   tumbletots.com      — all-locations JSON used by its own map (robots: allowed). Branch timetables
//                         live on classforkids.io (Crawl-delay 120, /api disallowed) -> not crawled.
//   singandsign.co.uk   — venue list embedded in the classes-near-you page (robots: allowed).
//                         Times sit behind ASP.NET postbacks on bookmyclass.co.uk -> not crawled.
//   babyballet.co.uk    — school pages (robots: allowed; www host returns 403, bare host works).
//                         Timetables are iframes on thinksmartsoftwareuk.com (robots: Disallow /) -> not crawled.
//   baskingbabies.co.uk — branch pages list venues + days (robots: allowed).
//   babybeats           — see crawlBabyBeats (Pebble booking pages).

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)';
const CACHE = '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/movement/cache';
const OUT = '/Users/marcos/little-days/data/uk-research/movement.json';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const LIMIT = args.limit ? Number(args.limit) : Infinity;

// ---------- polite cached fetch ----------
const lastHit = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function politeWait(host, gapMs = 1100) {
  const prev = lastHit.get(host) || 0;
  const wait = prev + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

async function get(url, { method = 'GET', body, headers = {}, json = false, noCache = false } = {}) {
  await mkdir(CACHE, { recursive: true });
  const key = createHash('sha1').update(method + ' ' + url + ' ' + (body || '')).digest('hex');
  const file = path.join(CACHE, key + (json ? '.json' : '.html'));
  if (!noCache && existsSync(file)) {
    const txt = await readFile(file, 'utf8');
    return json ? JSON.parse(txt) : txt;
  }
  const host = new URL(url).host;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await politeWait(host);
    try {
      const res = await fetch(url, {
        method, body,
        headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html,*/*', ...headers },
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 403 || res.status === 401 || res.status === 429) {
        throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { fatal: true });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const txt = await res.text();
      if (!noCache) await writeFile(file, txt);
      return json ? JSON.parse(txt) : txt;
    } catch (e) {
      if (e.fatal || attempt === 3) throw e;
      await sleep(2000 * attempt);
    }
  }
}

// ---------- helpers ----------
const decode = s => String(s ?? '')
  .replace(/&#0*39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#038;|&amp;/g, '&')
  .replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;/g, '–').replace(/&#8217;/g, '’')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const clean = s => decode(s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
const textLines = html => decode(String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, '\n')).split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);

const PC_FULL = /\b(GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/i;
const PC_OUT = /\b([A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?)\b/i;
function findPostcode(s) {
  const m = String(s).toUpperCase().match(PC_FULL);
  if (m) { const p = m[1].replace(/\s+/g, ''); return { postcode: p.slice(0, -3) + ' ' + p.slice(-3), kind: 'full' }; }
  return null;
}
function findOutcode(s) {
  // only trust an outcode when it is a stand-alone token at the end of an address chunk
  const parts = String(s).toUpperCase().split(/[,.\n]/).map(x => x.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = parts[i].match(/(?:^|\s)([A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?)$/);
    if (m) return { postcode: m[1], kind: 'out' };
  }
  return null;
}

const DAY = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
function to24(t) {
  const m = String(t).trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1]; const min = m[2] || '00';
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return String(h).padStart(2, '0') + ':' + min;
}
function daysFrom(s) {
  const out = [];
  for (const [k, v] of Object.entries(DAY)) if (new RegExp(k.slice(0, 3) + '(?:' + k.slice(3) + ')?s?\\b', 'i').test(s)) out.push(v);
  return out;
}

const DESC = {
  tinytalk: 'Baby signing classes where parents learn simple signs through songs and rhymes to use with their baby.',
  tumbletots: 'Structured active-play sessions for babies from around six months who are not yet walking, using soft play equipment with a parent.',
  singandsign: 'Baby signing classes built around songs, where parents pick up everyday signs to support early communication.',
  babyballet: 'Ballet and sensory play class for babies from 6 to 18 months, done alongside a parent or carer.',
  baskingbabies: 'Small-group baby massage, reflexology and gentle baby yoga classes for parents and young babies.',
  babybeats: 'Postnatal exercise class for mums with their baby, mixing gentle movement, baby massage, yoga and sensory play.',
};

function row(o) {
  const sessions = o.sessions || [];
  return {
    name: o.name, provider: o.provider, category: o.category,
    venue: o.venue || '', address: o.address || '', postcode: o.postcode, lat: 0, lng: 0,
    sessions,
    tier: sessions.some(s => s.day && s.start) ? 'timetable' : 'venue',
    schedule_note: o.schedule_note || '',
    age_min_months: o.age_min_months, age_max_months: o.age_max_months,
    price: o.price || '', free: false, booking: o.booking || 'term', indoor: o.indoor ?? true,
    description: o.description, url: o.url, phone: o.phone || '', source: o.source,
    confidence: o.confidence || 'high',
    _pckind: o._pckind || 'full',
  };
}

// ---------- TinyTalk ----------
async function crawlTinyTalk() {
  const bon = encodeURIComponent('((49.8, -8.7), (60.9, 1.8))');
  const search = await get(`https://www.tinytalk.co.uk/ajax-search-classes.php?skpb=true&setb=false&ubon=true&bon=${bon}&sf=nb%2Cbsc%2Ctc`, { json: true });
  const venues = Object.entries(search).filter(([k]) => k !== 'count').map(([, v]) => v).slice(0, LIMIT);
  console.log(`[tinytalk] ${venues.length} venues`);
  const rows = [];
  for (const v of venues) {
    let d;
    try { d = await get(`https://www.tinytalk.co.uk/ajax-venue-details.php?cid=${v.ID}&type=${v.ClassType}`, { json: true }); }
    catch (e) { console.warn('[tinytalk]', e.message); continue; }
    if (!d || d.status !== 'ok' || !d.data) continue;
    const addrLines = String(d.data.address || '').split(/<br\s*\/?>/i).map(clean).filter(Boolean);
    const pc = findPostcode(addrLines.join(', ')) || findOutcode(addrLines.join(', '));
    if (!pc) continue;
    const venue = clean(v.Name) || addrLines[0];
    const address = [...new Set(addrLines)].map(x => x.replace(/,$/, '')).join(', ');
    const ns = d.data.nextsetps || {};
    const url = ns.website || ns.print_url || 'https://www.tinytalk.co.uk/baby-signing-classes.php';
    for (const cls of Object.values(d.data.when || {})) {
      const cname = clean(cls.name);
      const kind = /toddler/i.test(cname) ? 'toddler' : /newborn/i.test(cname) ? 'newborn' : /baby/i.test(cname) ? 'baby' : 'other';
      if (kind === 'toddler' || kind === 'other') continue;
      const sessions = []; let online = 0, inperson = 0;
      for (const t of cls.times || []) {
        const txt = clean(String(t).replace(/<[^>]+>/g, ' '));
        if (/online/i.test(txt)) { online++; continue; }
        inperson++;
        const m = txt.match(/^([A-Za-z]+)\s*,\s*([\d:.]+\s*[ap]m)\s*[-–]\s*([\d:.]+\s*[ap]m)/i);
        if (m && DAY[m[1].toLowerCase()]) sessions.push({ day: DAY[m[1].toLowerCase()], start: to24(m[2]), end: to24(m[3]) });
        else { const ds = daysFrom(txt); if (ds.length) sessions.push({ day: ds[0], start: null, end: null }); }
      }
      if (online && !inperson) continue; // online-only listing at this venue
      rows.push(row({
        name: kind === 'newborn' ? 'TinyTalk Newborn Class' : 'TinyTalk Baby Signing',
        provider: `TinyTalk ${clean(v.townName) || ''}`.trim(),
        category: 'sensory', venue, address, postcode: pc.postcode, _pckind: pc.kind,
        sessions,
        schedule_note: sessions.length ? '' : 'Check the teacher’s page for current class times.',
        ...(kind === 'newborn' ? AGES.tinytalkNewborn : AGES.tinytalkBaby),
        booking: 'term', description: DESC.tinytalk, url,
        phone: ns.phone ? String(ns.phone).trim() : '', source: 'tinytalk.co.uk',
        confidence: pc.kind === 'full' ? 'high' : 'low',
      }));
    }
  }
  return rows;
}
// From tinytalk.co.uk: newborn classes are for babies up to 12 weeks; toddler classes from ~18 months,
// so baby signing covers the span between.
const AGES = {
  tinytalkBaby: { age_min_months: 3, age_max_months: 18 },
  tinytalkNewborn: { age_min_months: 0, age_max_months: 3 },
};

// ---------- Tumble Tots ----------
async function crawlTumbleTots() {
  const d = await get('https://www.tumbletots.com/wp-admin/admin-ajax.php?action=wd_tt_all_locations_data&limit=500', { json: true });
  const rows = [];
  for (const r of (d?.data?.rows || []).slice(0, LIMIT)) {
    const lines = String(r.address || '').split('\n').map(clean).map(x => x.replace(/,$/, '')).filter(Boolean);
    const pc = findPostcode(lines.join(', '));
    if (!pc) continue;
    const days = (r.class_days || []).map(x => DAY[String(x).toLowerCase()]).filter(Boolean);
    rows.push(row({
      name: 'Tumble Tots 6 Months to Walking',
      provider: `Tumble Tots ${clean(r.franchise_title)}`,
      category: 'movement', venue: lines[0], address: lines.join(', '), postcode: pc.postcode,
      sessions: days.map(day => ({ day, start: null, end: null })),
      schedule_note: days.length
        ? `Tumble Tots runs at this venue on ${r.class_days.join(', ')}; check the branch booking page for baby session times.`
        : 'Check the branch booking page for session times.',
      age_min_months: 6, age_max_months: 15,
      booking: 'book', description: DESC.tumbletots, url: r.franchise_url || 'https://www.tumbletots.com/all-locations/',
      phone: clean(r.tel), source: 'tumbletots.com', confidence: 'medium',
    }));
  }
  console.log(`[tumbletots] ${rows.length} venues`);
  return rows;
}

// ---------- Sing and Sign ----------
async function crawlSingAndSign() {
  const html = await get('https://singandsign.co.uk/classes/classes-near-you');
  const m = html.match(/var classes_list = (\[.*?\]);/s);
  if (!m) throw new Error('Sing and Sign: classes_list not found');
  const list = JSON.parse(m[1]);
  const skip = /(@ ?home|online|register (your )?interest|zoom|virtual|stream|taster for date|summer class)/i;
  const seen = new Set(); const rows = [];
  for (const x of list.slice(0, LIMIT)) {
    const vname = clean(x.VenueName), addr = clean(x.VenueAddress);
    if (skip.test(vname + ' ' + addr)) continue;
    let pc = findPostcode(addr), conf = 'medium';
    if (!pc) { pc = findOutcode(addr); conf = 'low'; }
    if (!pc) continue;
    const venue = vname.replace(/^stage\s*\d+\s*[-–:]\s*[^()]*\(([^)]+)\)\s*$/i, '$1').replace(/\s*\((main)\)\s*$/i, '').trim();
    const key = x.FranchiseeID + '|' + pc.postcode.replace(/\s/g, '') + '|' + venue.toLowerCase().replace(/\W/g, '').slice(0, 12);
    const key2 = x.FranchiseeID + '|' + pc.postcode.replace(/\s/g, '');
    if (seen.has(key) || (pc.kind === 'full' && seen.has(key2))) continue;
    seen.add(key); if (pc.kind === 'full') seen.add(key2);
    rows.push(row({
      name: 'Sing and Sign', provider: 'Sing and Sign', category: 'sensory',
      venue, address: addr, postcode: pc.postcode, _pckind: pc.kind,
      sessions: [], schedule_note: 'Stages for babies under 6 months, 6–14 months and 14–24 months; see availability for days and times.',
      age_min_months: 0, age_max_months: 24, booking: 'term', description: DESC.singandsign,
      url: `https://www.bookmyclass.co.uk/singandsign/AboutMe.aspx?FID=${x.FranchiseeID}`,
      source: 'singandsign.co.uk', confidence: conf,
    }));
  }
  console.log(`[singandsign] ${rows.length} venues (from ${list.length} listings)`);
  return rows;
}

// ---------- babyballet ----------
async function crawlBabyballet() {
  const list = await get('https://babyballet.co.uk/full-list-of-babyballet-schools/');
  const urls = [...new Set([...list.matchAll(/href="(https:\/\/babyballet\.co\.uk\/babyballet-school\/[^"#?]+)"/g)].map(m => m[1].replace(/\/?$/, '/')))].slice(0, LIMIT);
  console.log(`[babyballet] ${urls.length} school pages`);
  const rows = []; let noTots = 0, noPc = 0;
  for (const u of urls) {
    let html;
    try { html = await get(u); } catch (e) { console.warn('[babyballet]', e.message); continue; }
    if (!/Tots:\s*6\s*[-–]\s*18\s*months/i.test(html)) { noTots++; continue; }
    const title = clean((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s*[|»–-].*$/, '');
    const slugName = u.split('/').filter(Boolean).pop().replace(/-/g, ' ');
    const provider = /babyballet\s+\S/i.test(title) ? title.replace(/^babyballet/i, 'babyballet') : `babyballet ${slugName}`;
    const i = html.indexOf('Get directions to our venues');
    if (i < 0) { noPc++; continue; }
    const block = html.slice(i, html.indexOf('</article>', i) > 0 ? html.indexOf('</article>', i) : i + 6000);
    // Each venue is a <p><a href="google maps link">Venue name[, postcode]</a></p>, sometimes under an <h3> town heading.
    // The postcode is taken from the visible text, or from the address spelled out in the page's own
    // google.com/maps/dir|place link (the link itself is never followed; goo.gl short links carry no address).
    const items = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => {
      const href = decode((m[1].match(/href="([^"]+)"/) || [])[1] || '');
      const text = clean(m[1].replace(/<[^>]+>/g, ' '));
      let hrefAddr = '';
      const hm = href.match(/google\.[a-z.]+\/maps\/(?:dir\/[^/]*\/|place\/)([^/@]+)/);
      if (hm) { try { hrefAddr = decodeURIComponent(hm[1].replace(/\+/g, ' ')); } catch { hrefAddr = hm[1].replace(/\+/g, ' '); } }
      return { text, hrefAddr };
    }).filter(x => x.text && !/listed our venues|tap to get directions/i.test(x.text));
    for (const { text: it, hrefAddr } of items) {
      if (it.length > 160) continue;
      const pc = findPostcode(it) || findPostcode(hrefAddr) || findOutcode(it);
      if (!pc) { noPc++; continue; }
      const venue = it.replace(PC_FULL, '').replace(/[,\s-]+$/, '').trim();
      const address = hrefAddr && findPostcode(hrefAddr) ? clean(hrefAddr) : it;
      rows.push(row({
        name: 'babyballet Tots', provider, category: 'movement', venue, address, postcode: pc.postcode, _pckind: pc.kind,
        sessions: [], schedule_note: 'Tots class (6–18 months) — see the school timetable for which venues and times run it.',
        age_min_months: 6, age_max_months: 18, booking: 'term', description: DESC.babyballet,
        url: u, source: 'babyballet.co.uk', confidence: pc.kind === 'full' ? 'medium' : 'low',
      }));
    }
  }
  console.log(`[babyballet] ${rows.length} venue rows; schools without Tots: ${noTots}; venues without postcode dropped: ${noPc}`);
  return rows;
}

// ---------- Basking Babies ----------
async function crawlBaskingBabies() {
  const loc = await get('https://www.baskingbabies.co.uk/locations');
  const NON = new Set(['awards', 'franchise', 'franchisee-prospectus', 'location-finder', 'online-only', 'locations', 'contact', 'about',
    'baby-yoga-classes', 'baby-reflexology', 'baby-massage-classes', 'reviews', 'meet-head-office', 'instructor-opportunities',
    'view-our-policies', 'terms-conditions', 'sharing-and-support-circles', 'privacy-policy', 'pregnancy-relaxation-classes',
    'memberships-accreditations', 'events', 'shop', 'blog', 'book']);
  const slugs = [...new Set([...loc.matchAll(/href="https:\/\/www\.baskingbabies\.co\.uk\/([a-z0-9-]+)\?hsLang/g)].map(m => m[1]))]
    .filter(s => !NON.has(s)).slice(0, LIMIT);
  console.log(`[baskingbabies] ${slugs.length} branches`);
  const rows = [];
  for (const slug of slugs) {
    const url = `https://www.baskingbabies.co.uk/${slug}`;
    let html;
    try { html = await get(url); } catch (e) { console.warn('[baskingbabies]', e.message); continue; }
    const t = textLines(html);
    const branch = (t.find(x => /^Basking Babies\s+\S/.test(x) && x.length < 60) || `Basking Babies ${slug}`);
    const phoneIdx = t.indexOf('Phone:');
    const phone = phoneIdx >= 0 ? t[phoneIdx + 1] : '';
    const a = t.indexOf('Timetable by venue');
    const b = t.findIndex((x, i) => i > a && /^Hello!/.test(x));
    if (a < 0) continue;
    const seg = t.slice(a + 1, b > a ? b : a + 80);
    // groups are separated by "Find a class"
    const groups = []; let cur = [];
    for (const x of seg) { if (x === 'Find a class') { if (cur.length) groups.push(cur); cur = []; } else cur.push(x); }
    for (const g of groups) {
      const pIdx = g.findIndex(x => findPostcode(x));
      if (pIdx < 0) continue;
      const pc = findPostcode(g[pIdx]);
      const venue = g.slice(0, pIdx).join(' ').replace(/,\s*$/, '') || g[pIdx];
      const rest = g.slice(pIdx + 1);
      const dayTxt = rest.find(x => daysFrom(x).length) || '';
      const days = daysFrom(dayTxt);
      const classes = rest.filter(x => x !== dayTxt);
      const mk = (name, amin, amax) => rows.push(row({
        name, provider: branch, category: 'massage', venue, address: `${venue}, ${pc.postcode}`, postcode: pc.postcode,
        sessions: days.map(day => ({ day, start: null, end: null })),
        schedule_note: dayTxt ? `${dayTxt} at this venue; see the branch booking page for times.` : 'See the branch booking page for days and times.',
        age_min_months: amin, age_max_months: amax, booking: 'book', description: DESC.baskingbabies,
        url, phone, source: 'baskingbabies.co.uk', confidence: 'medium',
      }));
      if (classes.some(x => /massage/i.test(x))) mk('Basking Babies Baby Massage & Reflexology', 0, 12);
      if (classes.some(x => /yoga/i.test(x))) mk('Basking Babies Pre-crawling Baby Yoga', 3, 9);
    }
  }
  console.log(`[baskingbabies] ${rows.length} class-at-venue rows`);
  return rows;
}

// ---------- BabyBeats (Pebble booking pages) ----------
// babybeats.co.uk area pages embed Pebble (activities.bookpebble.co.uk). Activity pages are listed in
// Pebble's public sitemaps (robots allows /activity/) and server-render their details as __NEXT_DATA__.
async function crawlBabyBeats() {
  const idx = await get('https://activities.bookpebble.co.uk/sitemap_index.xml');
  const maps = [...idx.matchAll(/<loc>([^<]*activity\.xml\?p=\d+)<\/loc>/g)].map(m => m[1]);
  const acts = new Set();
  for (const sm of maps) {
    let xml; try { xml = await get(sm); } catch (e) { console.warn('[babybeats]', e.message); continue; }
    for (const m of xml.matchAll(/<loc>(https:\/\/activities\.bookpebble\.co\.uk\/activity\/babybeats-[^<]+)<\/loc>/gi)) acts.add(m[1]);
  }
  console.log(`[babybeats] ${acts.size} Pebble activities`);
  const rows = []; const seen = new Set();
  for (const u of [...acts].slice(0, LIMIT)) {
    let html; try { html = await get(u); } catch (e) { console.warn('[babybeats]', e.message); continue; }
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) continue;
    const ad = JSON.parse(m[1])?.props?.pageProps?.activityDetails;
    const a = ad?.activity;
    if (!a || a.isOnline || a.status !== 'PUBLISHED') continue;
    const franchise = a.supplier?.franchise?.name || '';
    if (!/babybeats/i.test(franchise + ' ' + a.supplier?.name)) continue;
    if (a.ageMonthsStart != null && a.ageMonthsStart > 12) continue;           // toddler programmes
    if (/mindful movers|functional foundations|before birth|walks?\b|meets?\b/i.test(a.name)) continue; // non-baby-class programmes
    const loc = a.location || {};
    const pc = findPostcode(loc.postCode || '');
    if (!pc) continue;
    const sessions = []; let price = '';
    for (const c of ad.classes || []) {
      for (const b of [...(c.blocks || []), ...(c.sessions || [])]) {
        for (const wd of b.weekdays || c.weekdays || []) {
          const day = DAY[String(wd).toLowerCase().replace(/s$/, '')];
          if (day && !sessions.some(s => s.day === day && s.start === (b.startTime || null)))
            sessions.push({ day, start: b.startTime || null, end: a.hideEndTimes ? null : (b.endTime || null) });
        }
      }
      const t = [...(c.tickets?.block || []), ...(c.tickets?.individual || [])].find(t => !t.isDeleted && t.price != null);
      if (t && !price) price = `£${(t.price / 100).toFixed(2)}${t.pricingPolicy === 'PER_SESSION' ? ' per session' : ''}`;
    }
    const key = a.supplier.id + '|' + pc.postcode + '|' + sessions.map(s => s.day + s.start).sort().join(',');
    if (seen.has(key)) continue; seen.add(key);
    const venue = clean(a.locationName || loc.addressLine1).replace(/\s*\(.*\)\s*$/, '');
    rows.push(row({
      name: 'BabyBeats', provider: clean(a.supplier.name), category: 'fitness',
      venue, address: [loc.addressLine1, loc.addressLine2, loc.city, pc.postcode].map(clean).filter(Boolean).join(', '),
      postcode: pc.postcode, sessions,
      schedule_note: ad.dateRange ? `Block booking, ${clean(ad.dateRange)}.` : '',
      age_min_months: a.ageMonthsStart ?? 0, age_max_months: a.ageMonthsEnd ?? 12,
      price, booking: a.activityType === 'BLOCK' ? 'term' : 'book',
      description: DESC.babybeats, url: u, source: 'babybeats.co.uk', confidence: 'high',
    }));
  }
  console.log(`[babybeats] ${rows.length} class-at-venue rows`);
  return rows;
}

// ---------- geocoding ----------
async function geocode(rows) {
  const full = [...new Set(rows.filter(r => r._pckind === 'full').map(r => r.postcode))];
  const out = [...new Set(rows.filter(r => r._pckind === 'out').map(r => r.postcode))];
  const geo = new Map();
  for (let i = 0; i < full.length; i += 100) {
    const batch = full.slice(i, i + 100);
    await politeWait('api.postcodes.io');
    const res = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ postcodes: batch }),
    }).then(r => r.json());
    for (const r of res.result || []) if (r.result) geo.set(r.query, { lat: r.result.latitude, lng: r.result.longitude, country: r.result.country, region: r.result.region, pc: r.result.postcode });
  }
  // terminated / mistyped postcodes: fall back to outcode, low confidence
  const missing = full.filter(p => !geo.has(p));
  const outs = new Set(out);
  for (const p of missing) outs.add(p.split(' ')[0]);
  for (const o of outs) {
    await politeWait('api.postcodes.io');
    try {
      const r = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(o)}`, { headers: { 'User-Agent': UA } }).then(r => r.json());
      if (r.status === 200 && r.result) geo.set('OUT:' + o, { lat: r.result.latitude, lng: r.result.longitude, country: (r.result.country || [])[0], region: '', pc: o });
    } catch { /* ignore */ }
  }
  const kept = []; const dropped = { nopostcode: 0, notUK: 0 };
  const UKC = new Set(['England', 'Scotland', 'Wales', 'Northern Ireland']);
  for (const r of rows) {
    let g = r._pckind === 'full' ? geo.get(r.postcode) : null, low = false;
    if (!g) { g = geo.get('OUT:' + r.postcode.split(' ')[0]); low = true; }
    if (!g || g.lat == null) { dropped.nopostcode++; continue; }
    if (!UKC.has(g.country)) { dropped.notUK++; continue; }
    r.lat = +g.lat.toFixed(6); r.lng = +g.lng.toFixed(6);
    if (!low && g.pc) r.postcode = g.pc;
    if (low) { r.confidence = 'low'; r.postcode = r.postcode.split(' ')[0]; }
    r._country = g.country; r._region = g.region || '';
    kept.push(r);
  }
  return { kept, dropped };
}

// ---------- main ----------
const CRAWLERS = {
  tinytalk: crawlTinyTalk, tumbletots: crawlTumbleTots, singandsign: crawlSingAndSign,
  babyballet: crawlBabyballet, baskingbabies: crawlBaskingBabies, babybeats: crawlBabyBeats,
};

const all = []; const errors = {};
for (const [name, fn] of Object.entries(CRAWLERS)) {
  if (ONLY && !ONLY.has(name)) continue;
  try { all.push(...await fn()); } catch (e) { errors[name] = e.message; console.error(`[${name}] FAILED:`, e.message); }
}
const { kept, dropped } = await geocode(all);

const stats = { bySource: {}, tier: {}, country: {}, confidence: {}, dropped, errors };
for (const r of kept) {
  stats.bySource[r.source] = (stats.bySource[r.source] || 0) + 1;
  stats.tier[r.tier] = (stats.tier[r.tier] || 0) + 1;
  stats.country[r._country] = (stats.country[r._country] || 0) + 1;
  stats.confidence[r.confidence] = (stats.confidence[r.confidence] || 0) + 1;
}
const final = kept.map(({ _pckind, _country, _region, ...r }) => r);
if (!args.dry) {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(final, null, 1));
} else {
  await writeFile(path.join(path.dirname(CACHE), 'movement.dry.json'), JSON.stringify(final, null, 1));
}
console.log(JSON.stringify(stats, null, 1));
console.log(`wrote ${final.length} rows${args.dry ? ' (dry run, not saved)' : ' -> ' + OUT}`);
