#!/usr/bin/env node
// Little Days — UK baby swimming directory crawler.
// Polite: robots.txt respected, <=1 request/second per host, identifying UA, raw pages cached.
// Usage: node swim.mjs [--limit N] [--only waterbabies,puddleducks,better,places,littledippers]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)';
const CACHE = process.env.SWIM_CACHE || '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/swim/cache';
const OUT = process.env.SWIM_OUT || '/Users/marcos/little-days/data/uk-research/swim.json';
const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : Infinity;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
fs.mkdirSync(CACHE, { recursive: true });

const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- polite fetch ----------
const lastHit = new Map();
const robotsRules = new Map();
const blocked = [];

async function rawFetch(url) {
  const host = new URL(url).host;
  const prev = lastHit.get(host) || Promise.resolve(0);
  let release;
  const slot = new Promise(r => (release = r));
  lastHit.set(host, prev.then(() => slot));
  const t = await prev;
  const wait = t + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xml;q=0.9,*/*;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    return { status: res.status, body, finalUrl: res.url };
  } catch (e) {
    return { status: 0, body: '', error: String(e) };
  } finally {
    release(Date.now());
  }
}

async function robotsAllowed(url) {
  const u = new URL(url);
  if (!robotsRules.has(u.host)) {
    const r = await rawFetch(`${u.protocol}//${u.host}/robots.txt`);
    const rules = [];
    if (r.status === 200 && !/<html/i.test(r.body.slice(0, 500))) {
      let applies = false, inGroupUAs = false;
      for (const line of r.body.split(/\r?\n/)) {
        const m = line.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'user-agent') {
          if (!inGroupUAs) applies = false;
          inGroupUAs = true;
          if (v === '*' || /littledaysbot/i.test(v)) applies = true;
        } else {
          inGroupUAs = false;
          if (applies && k === 'disallow' && v) rules.push(v);
        }
      }
    }
    robotsRules.set(u.host, rules);
  }
  const p = u.pathname + u.search;
  return !robotsRules.get(u.host).some(rule => {
    const re = new RegExp('^' + rule.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$'));
    return re.test(p);
  });
}

async function get(url) {
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const slug = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 90);
  const file = path.join(CACHE, `${slug}__${key}.html`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  if (!(await robotsAllowed(url))) { log('robots disallow', url); return null; }
  const r = await rawFetch(url);
  if (r.status !== 200) {
    log('HTTP', r.status, url, r.error || '');
    if ([401, 403, 429].includes(r.status)) blocked.push({ url, status: r.status });
    return null;
  }
  fs.writeFileSync(file, r.body);
  return r.body;
}

// ---------- helpers ----------
const decode = s => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&#xA3;|&pound;/gi, '£').replace(/&#8211;|&ndash;/g, '–').replace(/&#x2B;/g, '+').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const toText = h => decode(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '\n')).split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
const locs = xml => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => decode(m[1]));
const PC_RE = /\b(GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?[0-9][0-9A-HJKMNPR-Y]? ?[0-9][ABD-HJLNP-UW-Z]{2})\b/i;
const normPc = pc => { const s = pc.toUpperCase().replace(/\s+/g, ''); return s.slice(0, -3) + ' ' + s.slice(-3); };
function jsonLd(h) {
  const out = [];
  for (const m of h.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]); const arr = Array.isArray(j) ? j : j['@graph'] || [j]; out.push(...arr); } catch { /* ignore */ }
  }
  return out;
}
const findAddressNode = h => jsonLd(h).find(n => n && n.address && (n.address.postalCode || n.address.streetAddress));
const take = (arr) => arr.slice(0, LIMIT);
const DAYS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

const items = [];
const stats = {};
const bump = (k, n = 1) => (stats[k] = (stats[k] || 0) + n);

// ---------- Water Babies ----------
async function waterBabies() {
  const regionXml = await get('https://www.waterbabies.co.uk/region-sitemap.xml');
  const regionNames = {};
  for (const u of locs(regionXml || '')) {
    const h = await get(u);
    if (!h) continue;
    const biz = jsonLd(h).find(n => n['@type'] === 'SportsActivityLocation' && /#business$/.test(n['@id'] || ''));
    const slug = u.split('/').filter(Boolean).pop();
    regionNames[slug] = biz?.name ? decode(biz.name) : slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    regionNames[slug + ':phone'] = biz?.telephone || '';
  }
  const locXml = await get('https://www.waterbabies.co.uk/location-sitemap.xml');
  const urls = locs(locXml || '').filter(u => /\/baby-swimming\/[^/]+\/[^/]+\/$/.test(u));
  bump('waterbabies_pages', take(urls).length);
  for (const u of take(urls)) {
    const h = await get(u);
    if (!h) continue;
    const n = jsonLd(h).find(x => x['@type'] === 'SportsActivityLocation' && x.address);
    if (!n) { bump('waterbabies_no_address'); continue; }
    const region = u.split('/').filter(Boolean).slice(-2)[0];
    const a = n.address;
    items.push({
      name: 'Water Babies', provider: `Water Babies ${regionNames[region] || region}`, category: 'swim',
      venue: decode(n.name), address: [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).map(decode).join(', '),
      postcode: a.postalCode || '', lat: +n.geo?.latitude || null, lng: +n.geo?.longitude || null,
      sessions: [], tier: 'venue', schedule_note: 'Lesson times on the booking page',
      age_min_months: 0, age_max_months: 48, price: '', free: false, booking: 'term', indoor: true,
      description: 'Progressive weekly baby and toddler swimming lessons in small groups, with a parent in the water.',
      url: u, phone: n.telephone || regionNames[region + ':phone'] || '', source: 'waterbabies.co.uk', confidence: 'medium',
    });
  }
}

// ---------- Puddle Ducks ----------
const PD_BABY = /^(Floaties|Splashers|Floaties (and|&) Splashers|Kickers|Little Dippers|Dippers (and|&) Dabblers|Dabblers|Dippers)$/i;
async function puddleDucks() {
  const xml = await get('https://www.puddleducks.com/sitemap.xml');
  const teams = locs(xml || '').filter(u => /\/local-teams\/[^/]+\/our-pools-classes\/$/.test(u));
  const pools = new Map();
  for (const t of teams) {
    const h = await get(t);
    if (!h) continue;
    const blocks = h.split('<div class="pools-landing__pool js-pool"').slice(1);
    for (const b of blocks) {
      if (!/data-has-babyandpre="true"/.test(b.slice(0, 400))) continue;
      const href = b.match(/href="([^"]+)" class="js-pool_name">([^<]+)</);
      const team = b.match(/class="js-pool_team js-pool_team_link">([^<]+)</);
      const addr = b.match(/<p class="pools-landing__pool-address">([\s\S]*?)<\/p>/);
      if (!href) continue;
      const url = new URL(href[1], 'https://www.puddleducks.com').href;
      pools.set(url, {
        url, listName: decode(href[2]).trim(), team: team ? decode(team[1]).trim() : '',
        address: addr ? toText(addr[1]).join(', ') : '',
        lat: +(b.match(/data-latitude="([^"]+)"/) || [])[1] || null, lng: +(b.match(/data-longitude="([^"]+)"/) || [])[1] || null,
      });
    }
  }
  bump('puddleducks_baby_pools', pools.size);
  for (const p of take([...pools.values()])) {
    const h = await get(p.url);
    if (!h) continue;
    if (/-closed\/?$/.test(p.url) || /\bclosed\b/i.test(p.listName)) { bump('puddleducks_closed'); continue; }
    const venue = decode((h.match(/<h1>([^<]+)<\/h1>/) || [])[1] || p.listName).trim();
    const full = decode((h.match(/<a href="https:\/\/www\.google\.com\/maps[^"]*"[^>]*>([^<]+)<\/a>/) || [])[1] || p.address).trim();
    const lines = toText(h);
    const start = lines.findIndex(l => l === 'Classes Timetable');
    const end = lines.findIndex((l, i) => i > start && /monthly payment system|Location & Directions/i.test(l));
    const sess = [], ages = [], prices = new Set(), names = new Set();
    let day = null;
    if (start >= 0) {
      const seg = lines.slice(start, end > 0 ? end : undefined);
      for (let i = 0; i < seg.length; i++) {
        const l = seg[i];
        if (DAYS[l.toLowerCase()]) { day = DAYS[l.toLowerCase()]; continue; }
        if (day && PD_BABY.test(l)) {
          let j = i + 1, age = null;
          if (seg[j] && /(months|years)/i.test(seg[j]) && !/^\d\d:\d\d/.test(seg[j])) { age = seg[j]; j++; }
          const tm = seg[j] && seg[j].match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
          if (!tm) continue;
          let hh = +tm[1];
          if (tm[3] && /PM/i.test(tm[3]) && hh < 12) hh += 12;
          if (tm[3] && /AM/i.test(tm[3]) && hh === 12) hh = 0;
          const startT = `${String(hh).padStart(2, '0')}:${tm[2]}`;
          if (!sess.some(s => s.day === day && s.start === startT)) sess.push({ day, start: startT, end: null });
          names.add(l);
          if (age) ages.push(age);
          const pr = seg[j + 1] && seg[j + 1].match(/£\s?[\d.]+ per lesson/i);
          if (pr) prices.add(pr[0]);
        }
      }
    }
    // ages -> months
    let amin = 0, amax = 48;
    const toM = s => { const m = s.match(/(\d+)\s*(months?|years?)/i); return m ? (/year/i.test(m[2]) ? +m[1] * 12 : +m[1]) : null; };
    if (ages.length) {
      const mins = [], maxs = [];
      for (const a of ages) {
        const parts = a.split(/\s*[-–]\s*/);
        const unit = /year/i.test(parts[1] || '') && !/month/i.test(parts[0]) ? 'years' : null;
        const lo = toM(/month|year/i.test(parts[0]) ? parts[0] : `${parts[0]} ${unit || (a.match(/months|years/i) || ['months'])[0]}`);
        const hi = parts[1] ? toM(parts[1]) : null;
        if (lo != null) mins.push(lo); if (hi != null) maxs.push(hi);
      }
      if (mins.length) amin = Math.min(...mins);
      if (maxs.length) amax = Math.max(...maxs);
      if (!names.has('Floaties') && ![...names].some(n => /floaties/i.test(n)) && amin > 0) { /* keep derived */ } else amin = 0;
    }
    const pc = (full.match(PC_RE) || p.address.match(PC_RE) || [])[1] || '';
    bump(sess.length ? 'puddleducks_timetable' : 'puddleducks_no_baby_rows');
    items.push({
      name: 'Puddle Ducks Baby & Pre-school', provider: `Puddle Ducks ${p.team}`.trim(), category: 'swim',
      venue, address: full, postcode: pc, lat: p.lat, lng: p.lng,
      sessions: sess.sort((a, b) => 'MonTueWedThuFriSatSun'.indexOf(a.day) - 'MonTueWedThuFriSatSun'.indexOf(b.day) || a.start.localeCompare(b.start)),
      tier: sess.length ? 'timetable' : 'venue',
      schedule_note: sess.length ? `${[...names].join(', ')} classes; start times from the published timetable, term-time (holiday dates on the venue page)` : 'Lesson times on the booking page',
      age_min_months: amin, age_max_months: amax, price: [...prices].join(' / '), free: false, booking: 'term', indoor: true,
      description: 'Small-group baby and pre-school swimming lessons with a parent in the pool, building water confidence and safety skills.',
      url: p.url, phone: '', source: 'puddleducks.com', confidence: sess.length ? 'high' : 'medium',
    });
  }
}

// ---------- Better (GLL) — SWIMBiES ----------
async function better() {
  const xml = await get('https://www.better.org.uk/sitemap/leisure-centres.xml');
  const lessonPages = [...new Set(locs(xml || '').filter(u => /\/swimming-lessons$/.test(u)))];
  const centres = new Map();
  // (central baby-parent page only carries site-wide nav links, so centres come from per-centre lesson pages)
  bump('better_lesson_pages', lessonPages.length);
  for (const u of take(lessonPages)) {
    const h = await get(u);
    if (!h || !/swimbies/i.test(h)) continue;
    const c = u.replace(/\/swimming-lessons$/, '');
    centres.set(c, { via: 'swimming-lessons page', lessonsUrl: u, html: h });
  }
  bump('better_swimbies_centres', centres.size);
  for (const [c, info] of take([...centres.entries()])) {
    const h = await get(c);
    if (!h) continue;
    const n = findAddressNode(h);
    if (!n) { bump('better_no_address'); continue; }
    const a = n.address;
    let price = '';
    if (info.html) {
      const t = toText(info.html);
      const i = t.findIndex(l => /swimbies/i.test(l));
      const pm = t.slice(Math.max(0, i), i + 40).join(' ').match(/£\s?\d+(\.\d{2})?\s*(per (month|lesson|week))/i);
      if (pm) price = pm[0];
    }
    const bookLink = info.html && (info.html.match(/href="(https:\/\/betterflow\.courseprogress\.co\.uk\/[^"]*swimbies[^"]*)"/i) || [])[1];
    items.push({
      name: 'SWIMBiES', provider: 'Better (GLL)', category: 'swim',
      venue: decode(n.name), address: [a.streetAddress, a.addressLocality, a.postalCode].filter(Boolean).map(decode).join(', '),
      postcode: a.postalCode || '', lat: +n.geo?.latitude || null, lng: +n.geo?.longitude || null,
      sessions: [], tier: 'venue', schedule_note: 'Lesson times on the booking page',
      age_min_months: 3, age_max_months: 36, price, free: false, booking: 'term', indoor: true,
      description: 'Parent-and-child swimming lessons for babies and toddlers from 3 months, taught in the learner pool.',
      url: info.lessonsUrl || c, phone: n.telephone || '', source: 'better.org.uk',
      confidence: info.lessonsUrl ? 'medium' : 'low', _booking_link: bookLink ? decode(bookLink) : undefined,
    });
  }
}

// ---------- Places Leisure — adult & baby lessons ----------
async function places() {
  const xml = await get('https://www.placesleisure.org/sitemap/');
  const pages = [...new Set(locs(xml || '').filter(u => /\/centres\/[^/]+\/centre-activities\/swimming-lessons\/$/.test(u)))];
  bump('places_lesson_pages', pages.length);
  for (const u of take(pages)) {
    const h = await get(u);
    if (!h) continue;
    const t = toText(h);
    const line = t.find(l => /(adult|parent)\s*(and|&)\s*(baby|child|toddler)|baby swim|parent and baby/i.test(l));
    if (!line) continue;
    const c = u.replace(/centre-activities\/swimming-lessons\/$/, '');
    const ch = await get(c);
    if (!ch) continue;
    const n = findAddressNode(ch);
    if (!n) { bump('places_no_address'); continue; }
    const a = n.address;
    const street = decode(String(a.streetAddress || '')).replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/\.$/, '').trim();
    const pc = (street.match(PC_RE) || String(a.postalCode || '').match(PC_RE) || [])[1] || '';
    items.push({
      name: 'Adult and baby swimming lessons', provider: 'Places Leisure', category: 'swim',
      venue: decode(n.name), address: street, postcode: pc, lat: +n.geo?.latitude || null, lng: +n.geo?.longitude || null,
      sessions: [], tier: 'venue', schedule_note: 'Lesson times on the booking page',
      age_min_months: 0, age_max_months: 48, price: '', free: false, booking: 'term', indoor: true,
      description: 'Adult-and-baby/child lessons at the centre pool to help little ones get familiar with the water.',
      url: u, phone: n.telephone || '', source: 'placesleisure.org', confidence: 'low',
    });
  }
}

// ---------- Little Dippers ----------
async function littleDippers() {
  const base = 'https://littledippers.co.uk/index.php/';
  const pools = [
    // slug from their Our Pools page; outcode fallback from the same page's headings
    { slug: 'little-dippers-swim-centre', venue: 'Little Dippers Swim Centre, Brighton', out: 'BN1' },
    // Patcham page only quotes the Brighton centre's postcode, so outcode only
    { slug: 'patcham-courses', venue: 'Little Dippers Patcham pool, Ridgeside Avenue, Brighton', out: 'BN1', noPc: true },
    { slug: 'oxshott', venue: 'Little Dippers Oxshott pool', out: 'KT22' },
    { slug: 'pbsc', venue: 'Putney Aqua-Hub', out: 'SW18' },
  ];
  const poolsPage = await get(base + 'our-pools');
  const bookPage = await get(base + 'book-now');
  const pt = toText(poolsPage || '').join('\n');
  // extra pools named on Our Pools with a full postcode in their blurb (e.g. Hassocks)
  for (const m of pt.matchAll(/^([^\n]*?),?\s*(?:West Sussex )?(BN\d+)\n([^\n]*)$/gm)) {
    const pc = (m[3].match(PC_RE) || [])[1];
    if (pc) pools.push({ slug: null, venue: `Little Dippers ${m[1].trim()} pool`, pc, out: m[2] });
  }
  pools.push({ slug: null, venue: 'Darwin Court Healthy Living Centre, Elephant & Castle', out: 'SE17' });
  for (const p of pools) {
    let pc = p.pc || '', text = '';
    if (p.slug) {
      const h = await get(base + p.slug);
      if (h && !p.noPc) { text = toText(h).join('\n'); pc = pc || (text.match(PC_RE) || [])[1] || ''; }
    }
    items.push({
      name: 'Little Dippers baby swimming', provider: 'Little Dippers', category: 'swim',
      venue: p.venue, address: p.venue + (pc ? `, ${normPc(pc)}` : ''), postcode: pc ? normPc(pc) : '', _outcode: p.out,
      lat: null, lng: null, sessions: [], tier: 'venue', schedule_note: 'Lesson times on the booking page; 6–7 week courses',
      age_min_months: 0, age_max_months: 48, price: '', free: false, booking: 'term', indoor: true,
      description: 'Small baby swimming courses in private warm-water pools, with one parent in the water.',
      url: p.slug ? base + p.slug : base + 'book-now', phone: '01273 229390', source: 'littledippers.co.uk', confidence: pc ? 'medium' : 'low',
    });
  }
  void bookPage;
}

// ---------- geocode ----------
async function geocode() {
  const pcs = [...new Set(items.map(i => i.postcode && normPc(i.postcode)).filter(Boolean))];
  const res = new Map();
  for (let i = 0; i < pcs.length; i += 100) {
    const batch = pcs.slice(i, i + 100);
    const r = await fetch('https://api.postcodes.io/postcodes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ postcodes: batch }) });
    const j = await r.json();
    for (const x of j.result || []) if (x.result) res.set(normPc(x.query), x.result);
    await sleep(1100);
  }
  const outs = new Map();
  const out = [];
  for (const it of items) {
    const pc = it.postcode ? normPc(it.postcode) : '';
    const g = res.get(pc);
    if (g) {
      Object.assign(it, { postcode: g.postcode, lat: g.latitude, lng: g.longitude, _country: g.country });
    } else {
      const oc = (pc.split(' ')[0]) || it._outcode;
      if (!oc) { bump('dropped_no_postcode'); continue; }
      if (!outs.has(oc)) {
        const r = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(oc)}`, { headers: { 'User-Agent': UA } });
        outs.set(oc, r.ok ? (await r.json()).result : null);
        await sleep(1100);
      }
      const o = outs.get(oc);
      if (!o) { bump('dropped_invalid_postcode'); log('drop', it.venue, it.postcode); continue; }
      Object.assign(it, { postcode: oc, lat: o.latitude, lng: o.longitude, confidence: 'low', _country: (o.country || [])[0] });
      bump('outcode_fallback');
    }
    out.push(it);
  }
  return out;
}

// ---------- main ----------
const runners = { waterbabies: waterBabies, puddleducks: puddleDucks, better, places, littledippers: littleDippers };
const selected = Object.entries(runners).filter(([k]) => !ONLY || ONLY.includes(k));
await Promise.all(selected.map(async ([k, fn]) => {
  try { await fn(); log('done', k); } catch (e) { log('FAILED', k, e.stack); bump('failed_' + k); }
}));

let finalItems = await geocode();
// dedupe programme-at-venue (e.g. two pool entries at same site)
const seen = new Set();
finalItems = finalItems.filter(i => {
  const k = `${i.name}|${i.venue.toLowerCase()}|${i.postcode}`;
  if (seen.has(k)) { bump('deduped'); return false; }
  seen.add(k); return true;
});
const countries = {};
for (const i of finalItems) { countries[i._country || '?'] = (countries[i._country || '?'] || 0) + 1; delete i._country; delete i._outcode; delete i._booking_link; }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(finalItems, null, 1));
const byBrand = {}, byTier = {};
for (const i of finalItems) { byBrand[i.source] = (byBrand[i.source] || 0) + 1; byTier[i.tier] = (byTier[i.tier] || 0) + 1; }
console.log(JSON.stringify({ total: finalItems.length, byBrand, byTier, countries, stats, blocked }, null, 1));
