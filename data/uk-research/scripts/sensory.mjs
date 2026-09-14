#!/usr/bin/env node
// Little Days — UK baby sensory class directory crawler.
// Brands: Baby Sensory (+ Hello Baby), Bloom Baby Classes, Baby Sparks. Hartbeeps is behind a
// Cloudflare challenge (403) and is skipped on purpose.
// Polite: robots.txt respected, max 1 request/second, raw pages cached so re-runs don't re-fetch.
// Usage: node sensory.mjs [--limit N]   (N = max areas per brand, for testing)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)';
const CACHE = '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/sensory/cache';
const OUT = '/Users/marcos/little-days/data/uk-research/sensory.json';
const STATS = path.join(path.dirname(CACHE), 'stats.json');
const onlySlugs = process.argv.includes('--slugs') ? process.argv[process.argv.indexOf('--slugs') + 1].split(',') : null;
const argLimit = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) : Infinity; })();
fs.mkdirSync(CACHE, { recursive: true });

// ---------- polite fetch ----------
let lastReq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const robotsCache = new Map();
const log = (...a) => console.error(...a);
const skipped = [];

function cacheFile(url, method, body) {
  const h = crypto.createHash('sha1').update(method + ' ' + url + ' ' + (body || '')).digest('hex').slice(0, 16);
  const slug = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
  return path.join(CACHE, `${slug}_${h}`);
}

async function rawFetch(url, opts = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = lastReq + 1050 - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await sleep(5000 * (attempt + 1)); continue; }
      return { status: res.status, text, finalUrl: res.url };
    } catch (e) {
      if (attempt === 2) return { status: 0, text: '', error: String(e) };
      await sleep(5000);
    }
  }
}

async function allowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.host)) {
    const r = await get(`${u.protocol}//${u.host}/robots.txt`, { skipRobots: true });
    const rules = [];
    if (r.status === 200 && !/<html/i.test(r.text)) {
      let applies = false;
      for (const line of r.text.split(/\r?\n/)) {
        const m = line.replace(/#.*/, '').trim().match(/^([a-z-]+)\s*:\s*(.*)$/i);
        if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'user-agent') applies = v === '*' || /littledaysbot/i.test(v);
        else if (applies && k === 'disallow' && v) rules.push(v);
      }
    }
    robotsCache.set(u.host, rules);
  }
  const p = u.pathname + u.search;
  return !robotsCache.get(u.host).some((rule) => p.startsWith(rule.replace(/\*.*$/, '')));
}

async function get(url, { skipRobots = false, method = 'GET', body, headers } = {}) {
  const f = cacheFile(url, method, body);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!skipRobots && !(await allowed(url))) { skipped.push({ url, reason: 'robots.txt disallow' }); return { status: -1, text: '' }; }
  const r = await rawFetch(url, { method, body, headers });
  if (r.status !== 0) fs.writeFileSync(f, JSON.stringify(r));
  if (r.status !== 200) log(`  HTTP ${r.status} ${url}`);
  return r;
}

// ---------- helpers ----------
const DAYS = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const decode = (s) => String(s ?? '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&[a-z]+;/g, ' ');
const text = (html) => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const clean = (s) => decode(s).replace(/\s+/g, ' ').trim();
const PC_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const normPc = (s) => { const m = String(s || '').toUpperCase().match(PC_RE); return m ? `${m[1]} ${m[2]}` : null; };
const pad = (n) => String(n).padStart(2, '0');
function to24(h, m, ap) {
  h = Number(h); m = Number(m || 0);
  if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
  return `${pad(h)}:${pad(m)}`;
}
const addMin = (hhmm, mins) => { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m + mins; return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`; };
const titleCase = (slug) => slug.split(/[-_]/).map((w) => (w === 'and' ? 'and' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
function sessionKey(s) { return `${s.day}|${s.start}|${s.end}`; }
function addSessions(item, list) {
  const seen = new Set(item.sessions.map(sessionKey));
  for (const s of list) if (!seen.has(sessionKey(s))) { seen.add(sessionKey(s)); item.sessions.push(s); }
  item.sessions.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || String(a.start).localeCompare(String(b.start)));
}
// "Birth to 13 months", "6 to 13 months", "6 wks - 8 months", "6-36 months", "0-6 Months"
function parseAge(str) {
  if (!str) return [null, null];
  const s = clean(str).toLowerCase();
  const m = s.match(/(birth|newborn|\d+)\s*(weeks?|wks?|months?|mths?|years?|yrs?)?\s*(?:to|-|–|until)\s*(?:approx\.?\s*|around\s*|c\.\s*)?(\d+)\s*(weeks?|wks?|months?|mths?|years?|yrs?)/);
  if (!m) return [null, null];
  const conv = (n, unit, fallbackUnit) => {
    if (n === 'birth' || n === 'newborn') return 0;
    const u = unit || fallbackUnit || 'months';
    n = Number(n);
    if (/^w/.test(u)) return Math.floor(n / 4.345);
    if (/^y/.test(u)) return n * 12;
    return n;
  };
  return [conv(m[1], m[2], m[4]), conv(m[3], m[4])];
}
const money = (n) => `£${Number(n).toFixed(2)}`;

// ---------- Baby Sensory (WOW World Group) ----------
async function crawlBabySensory() {
  const items = [];
  log('Baby Sensory: loading venue index from wowworldgroup.com/find-a-class');
  const idx = await get('https://www.wowworldgroup.com/find-a-class');
  const at = idx.text.indexOf('const allVenues');
  const all = JSON.parse(idx.text.slice(idx.text.indexOf('[', at)).match(/^\[[\s\S]*?\}\](?=\s*;|\s*\n)/)[0]);
  const ukVenues = all.filter((v) => v.SiteID === 1 && [1, 11].includes(v.ProductStream) && /^(www\.)?babysensory\.com$/.test(new URL(v.MiniSiteUrl || 'http://x').host));
  const bySlug = new Map();
  for (const v of ukVenues) {
    const slug = new URL(v.MiniSiteUrl).pathname.replace(/\//g, '').toLowerCase();
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(v);
  }
  log(`  ${ukVenues.length} UK venue rows across ${bySlug.size} area sites`);

  const norm = (s) => clean(s).toLowerCase().replace(/\b(the|st|saint|church|hall|centre|center|community|village|parish|and)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  let n = 0;
  for (const [slug, venues] of bySlug) {
    if (onlySlugs && !onlySlugs.includes(slug)) continue;
    if (n++ >= argLimit) break;
    const base = `https://www.babysensory.com/${slug}/`;
    const home = await get(base);
    if (home.status !== 200) { skipped.push({ url: base, reason: `HTTP ${home.status}` }); continue; }
    const cid = (home.text.match(/CompanyID=(\d+)/) || [])[1];
    const title = clean((home.text.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    let area = (title.match(/^Baby Sensory\s+(.+?)(?:\s+(?:Classes|-|\||–|Baby Classes)\b|$)/i) || [])[1] || titleCase(slug);
    if (area.length > 45 || /^(classes|baby)/i.test(area)) area = titleCase(slug);
    const provider = `Baby Sensory ${area}`.trim();
    const phone = clean((home.text.match(/href="tel:([^"]+)"/i) || [])[1] || (text(home.text).match(/\b(0\d{3,4}\s?\d{3}\s?\d{3,4})\b/) || [])[1] || '');
    const url = `${base}timetable`;
    let tt = { timetable: [] };
    if (cid) {
      const api = await get(`https://www.babysensory.com/api/v1/minisite/loadTimeTable?companyID=${cid}&customerID=0`);
      try { tt = JSON.parse(api.text); } catch { skipped.push({ url: base, reason: 'timetable API not JSON' }); }
    } else skipped.push({ url: base, reason: 'no CompanyID on area page' });

    // Match timetable venue names to indexed venues (which carry postcodes)
    const matchVenue = (name, address) => {
      const nn = norm(name);
      const pcInAddr = normPc(address);
      let best = null;
      for (const v of venues) {
        const vn = norm(v.Name);
        if (pcInAddr && normPc(v.PostCode) === pcInAddr) return v;
        if (vn && nn && (vn === nn || vn.includes(nn) || nn.includes(vn))) best = best || v;
      }
      if (best) return best;
      const a1 = norm((address || '').split(',')[0]);
      for (const v of venues) if (a1 && norm(v.AddressLine1) && (norm(v.AddressLine1) === a1)) return v;
      // token overlap
      const toks = new Set(nn.split(' ').filter((t) => t.length > 3));
      let score = 0;
      for (const v of venues) {
        const s = norm(v.Name).split(' ').filter((t) => toks.has(t)).length;
        if (s > score) { score = s; best = v; }
      }
      return score > 0 ? best : null;
    };

    const groups = new Map(); // key venue|stream
    for (const e of tt.timetable || []) {
      if (![1, 11].includes(e.ProductStreamID)) continue;
      if (e.PriorityProductClassType === 2) continue; // one-off special events
      const key = `${e.VenueID}|${e.ProductStreamID}`;
      if (!groups.has(key)) groups.set(key, { entries: [], venue: e.Venue, address: e.Address, stream: e.ProductStreamID });
      groups.get(key).entries.push(e);
    }
    const usedIdx = new Set();
    for (const g of groups.values()) {
      const v = matchVenue(g.venue, g.address);
      if (v) usedIdx.add(`${v.VenueID}|${g.stream}`), usedIdx.add(`${v.VenueID}|any`);
      const postcode = normPc(g.address) || normPc(v?.PostCode);
      const sessions = [];
      let ageMin = null, ageMax = null, payg = null, term = null, trial = null, fixed = false;
      for (const e of g.entries) {
        for (const sch of e.SchedulesFormatted || []) {
          const m = clean(sch).match(/^(\w+day)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i);
          if (m && DAYS[m[1].toLowerCase()]) sessions.push({ day: DAYS[m[1].toLowerCase()], start: to24(m[2], m[3]), end: to24(m[4], m[5]) });
        }
        const [a, b] = parseAge(e.AgeRange);
        if (a != null) ageMin = ageMin == null ? a : Math.min(ageMin, a);
        if (b != null) ageMax = ageMax == null ? b : Math.max(ageMax, b);
        for (const p of e.Products || []) {
          if (p.fixedTerm) { fixed = true; term = term ?? p.price; }
          else if (p.trial) trial = trial ?? p.price;
          else if (p.productSessions === 1) payg = payg ?? p.price;
        }
      }
      const priceParts = [];
      if (payg != null) priceParts.push(`${money(payg)} per class`);
      if (term != null) priceParts.push(`${money(term)} per term`);
      const addrParts = v ? [v.AddressLine1, v.AddressLine2, v.City].map(clean).filter((x) => x && norm(x) !== norm(g.venue)) : [];
      const item = {
        name: g.stream === 11 ? 'Hello Baby' : 'Baby Sensory',
        provider, category: 'sensory',
        venue: clean(g.venue),
        address: clean(g.address) || addrParts.join(', '),
        postcode, lat: null, lng: null, sessions: [],
        tier: 'venue', schedule_note: '',
        age_min_months: ageMin ?? 0, age_max_months: ageMax ?? (g.stream === 11 ? 3 : 13),
        price: priceParts.join('; '), free: false,
        booking: fixed ? 'term' : 'book', indoor: true,
        description: g.stream === 11 ? DESC.hello : DESC.bs,
        url, phone, source: 'babysensory.com', confidence: 'high',
        _brand: g.stream === 11 ? 'Hello Baby (Baby Sensory)' : 'Baby Sensory',
      };
      addSessions(item, sessions);
      item.tier = item.sessions.length ? 'timetable' : 'venue';
      item.schedule_note = fixed ? 'Termly booking; see site for term dates' : 'See site for dates';
      if (!item.sessions.length) item.confidence = 'medium';
      if (!postcode) item._needsOutcode = v?.PostCode || null;
      items.push(item);
    }
    // Indexed venues with no current timetable entries -> venue tier
    for (const v of venues) {
      if (usedIdx.has(`${v.VenueID}|${v.ProductStream}`) || !v.Name) continue;
      const days = (v.RunningDays || []).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d - 1]).filter(Boolean);
      items.push({
        name: v.ProductStream === 11 ? 'Hello Baby' : 'Baby Sensory',
        provider, category: 'sensory', venue: clean(v.Name),
        address: [v.AddressLine1, v.AddressLine2, v.City].map(clean).filter((x) => x && x !== clean(v.Name)).join(', '),
        postcode: normPc(v.PostCode), lat: null, lng: null, sessions: [], tier: 'venue',
        schedule_note: days.length ? `Runs ${days.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)).join(', ')}; times not currently listed online` : 'Times not currently published online',
        age_min_months: 0, age_max_months: v.ProductStream === 11 ? 3 : 13, price: '', free: false,
        booking: 'term', indoor: true, description: v.ProductStream === 11 ? DESC.hello : DESC.bs,
        url, phone, source: 'babysensory.com', confidence: days.length ? 'medium' : 'low',
        _brand: v.ProductStream === 11 ? 'Hello Baby (Baby Sensory)' : 'Baby Sensory',
      });
    }
    log(`  [${n}/${bySlug.size}] ${slug}: ${groups.size} timetabled venue-classes, ${venues.length} indexed venues`);
  }
  return items;
}

// ---------- Bloom Baby Classes ----------
async function crawlBloom() {
  const items = [];
  const finder = await get('https://www.bloombabyclasses.com/class-finder/');
  const nonArea = new Set(['about-the-classes', 'best-baby-class', 'best-baby-classes', 'blog', 'booking-terms-and-conditions', 'charity', 'class-finder', 'faqs', 'join-the-franchise', 'music', 'privacy-policy', 'common', 'shop', 'gift-vouchers']);
  const slugs = [...new Set([...finder.text.matchAll(/href="\/([a-z0-9-]+)\/"/g)].map((m) => m[1]))].filter((s) => !nonArea.has(s));
  log(`Bloom: ${slugs.length} area sites`);
  let n = 0;
  for (const slug of slugs) {
    if (onlySlugs && !onlySlugs.includes(slug)) continue;
    if (n++ >= argLimit) break;
    const cards = [];
    let phone = '', provider = `Bloom Baby Classes ${titleCase(slug)}`;
    for (let page = 1; page <= 15; page++) {
      const url = `https://www.bloombabyclasses.com/${slug}/classes-and-timetable?permalink=${slug}&page=${page}`;
      const r = await get(url);
      if (r.status !== 200) break;
      if (page === 1) {
        const t = text(r.text);
        const pm = t.match(/Bloom Baby Classes ([^\n]+?)\s+(0\d{3,4}\s?\d{3}\s?\d{3,4})/);
        if (pm) { provider = `Bloom Baby Classes ${pm[1].trim()}`; phone = pm[2]; }
      }
      const blocks = r.text.split(/<div class="card-body[^"]*">/).slice(1);
      for (const b of blocks) {
        const href = (b.match(/href="(\/classes-and-timetable-detail\.php\?[^"]+)"/) || [])[1];
        if (!href) continue;
        const lines = text(b.split(/<\/div>/)[0]).split('\n').map((x) => x.trim()).filter(Boolean);
        if (lines.length > 1 && /[–-]$/.test(lines[0])) lines.splice(0, 2, `${lines[0]} ${lines[1]}`);
        const title = lines[0] || '';
        const card = { href: decode(href), title, lines };
        for (const l of lines.slice(1)) {
          let m;
          if ((m = l.match(/^Every (\w+day) at (\d{1,2})[:.](\d{2})\s*(am|pm)/i))) { card.day = DAYS[m[1].toLowerCase()]; card.start = to24(m[2], m[3], m[4]); card.term = true; }
          else if ((m = l.match(/^(\d{1,2} \w+ \d{4})\s+(\d{1,2})[:.](\d{2})\s*(am|pm)/i))) { const d = new Date(m[1] + ' 12:00'); card.day = DAY_ORDER[(d.getDay() + 6) % 7]; card.start = to24(m[2], m[3], m[4]); card.payg = true; }
          else if ((m = l.match(/^Cost:\s*£\s*([\d.]+)/i))) card.cost = Number(m[1]);
          else if (PC_RE.test(l) && l.includes(',')) { card.postcode = normPc(l); card.venue = clean(l.slice(0, l.lastIndexOf(','))); }
        }
        cards.push(card);
      }
      if (!new RegExp(`page=${page + 1}\\b`).test(r.text)) break;
    }
    // group into class-at-venue
    const groups = new Map();
    for (const c of cards) {
      if (!c.postcode || !c.day) continue;
      let type = (c.title.includes('–') ? c.title.slice(c.title.lastIndexOf('–') + 1) : '').replace(/[^\p{L}\p{N}&' -]/gu, '').trim();
      if (!/^[A-Za-z][A-Za-z&' ]{2,30}$/.test(type) || /spaces|term|payg/i.test(type)) type = 'Baby Class';
      if (/special/i.test(type)) continue; // one-off themed specials
      const key = `${c.postcode}|${type.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { type, cards: [] });
      groups.get(key).cards.push(c);
    }
    for (const g of groups.values()) {
      const item = {
        name: `Bloom ${g.type}`.replace(/^Bloom Bloom/, 'Bloom'), provider, category: 'sensory',
        venue: g.cards[0].venue, address: '', postcode: g.cards[0].postcode, lat: null, lng: null, sessions: [],
        tier: 'timetable', schedule_note: '', age_min_months: null, age_max_months: null, price: '', free: false,
        booking: 'term', indoor: true, description: DESC.bloom,
        url: `https://www.bloombabyclasses.com/${slug}/classes-and-timetable`, phone,
        source: 'bloombabyclasses.com', confidence: 'high', _brand: 'Bloom Baby Classes',
      };
      let payg = null, term = null, anyTerm = false;
      const seenSlot = new Set();
      for (const c of g.cards) {
        const [a, b] = parseAge(c.title);
        if (a != null) { item.age_min_months = item.age_min_months == null ? a : Math.min(item.age_min_months, a); item.age_max_months = Math.max(item.age_max_months ?? 0, b); }
        if (c.payg && c.cost != null) payg = payg ?? c.cost;
        if (c.term) { anyTerm = true; if (c.cost != null && c.cost < 150) term = term ?? c.cost; }
        const slot = `${c.day}|${c.start}`;
        let end = null;
        if (!seenSlot.has(slot)) {
          seenSlot.add(slot);
          const d = await get(`https://www.bloombabyclasses.com${c.href}`);
          if (d.status === 200) {
            const t = text(d.text);
            const em = t.match(/(\d{1,2})[.:](\d{2})\s*(am|pm)\s*[–-]\s*(\d{1,2})[.:](\d{2})\s*(am|pm)/i);
            if (em) end = to24(em[4], em[5], em[6]);
            const vm = t.match(/\nVenue\n([\s\S]*?)\nDate/);
            if (vm && !item.address) {
              const parts = vm[1].split('\n').map((x) => x.trim()).filter(Boolean);
              item.address = parts.filter((p) => p !== item.venue && !PC_RE.test(p)).slice(item.venue ? 0 : 1).join(', ').replace(new RegExp('^' + (item.venue || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ',?\\s*', 'i'), '');
            }
            if (!item.age_max_months) { const [a, b] = parseAge(t.slice(0, 600)); if (a != null) { item.age_min_months = a; item.age_max_months = b; } }
          }
          addSessions(item, [{ day: c.day, start: c.start, end }]);
        }
      }
      // drop exact duplicates where an end-less copy of a slot exists alongside one with end
      item.sessions = item.sessions.filter((s, _, arr) => s.end || !arr.some((o) => o !== s && o.day === s.day && o.start === s.start && o.end));
      const pp = [];
      if (payg != null) pp.push(`${money(payg)} per class`);
      if (term != null) pp.push(`${money(term)} per term block`);
      item.price = pp.join('; ');
      item.booking = anyTerm ? 'term' : 'book';
      item.schedule_note = anyTerm ? 'Termly booking; see site for dates' + (payg != null ? ' (some pay-as-you-go spaces)' : '') : 'Pay-as-you-go dates listed on site';
      if (item.age_min_months == null) { item.age_min_months = 0; item.age_max_months = 15; item.confidence = 'medium'; }
      items.push(item);
    }
    log(`  [${n}/${slugs.length}] ${slug}: ${cards.length} cards -> ${groups.size} class-at-venue`);
  }
  return items;
}

// ---------- Baby Sparks (bookabee embeds) ----------
async function crawlBabySparks() {
  const items = [];
  const finder = await get('https://www.babysparks.co.uk/find-a-class');
  const slugs = [...finder.text.matchAll(/<option value="\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  log(`Baby Sparks: ${slugs.length} area sites`);
  let n = 0;
  for (const slug of slugs) {
    if (onlySlugs && !onlySlugs.includes(slug)) continue;
    if (n++ >= argLimit) break;
    const pageUrl = `https://www.babysparks.co.uk/${slug}`;
    const p = await get(pageUrl);
    const provider = clean((text(p.text).match(/Welcome to (Baby Sparks [^!.\n]+)/) || [])[1] || `Baby Sparks ${titleCase(slug)}`).replace(/\\u0026/g, '&');
    const embed = (p.text.match(/data-bookabee-embed="([^"]+)"/) || [])[1];
    if (!embed) { skipped.push({ url: pageUrl, reason: 'no bookabee timetable embed on area page' }); log(`  ${slug}: no embed`); continue; }
    const r = await get(`https://www.bookabee.co/embed/${encodeURIComponent(embed)}`);
    const chunks = [...r.text.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => JSON.parse(`"${m[1]}"`)).join('');
    const grab = (marker) => { const i = chunks.indexOf(marker); if (i < 0) return []; try { const s = chunks.slice(i + marker.length); return new Function(`return ${s.slice(0, matchBracket(s) + 1)}`)(); } catch { return []; } };
    const classes = grab('"classes":');
    const events = grab('"calendar":{"events":');
    const byClass = new Map();
    for (const e of events) { if (!byClass.has(e.classId)) byClass.set(e.classId, []); byClass.get(e.classId).push(e); }
    const groups = new Map();
    for (const c of classes) {
      const desc = clean(c.description || '');
      if (/special|party|christmas|halloween|easter|stroll|pumpkin|meet ?up|farm/i.test(desc + ' ' + c.name)) continue;
      const program = clean(desc.replace(/\(.*?\)/g, '').replace(/^.*?\bcourse\s+(?:for\s+)?/i, '')) || 'Baby Sparks';
      if (program.length > 45 || !/spark/i.test(program)) { skipped.push({ url: pageUrl, reason: `non-class event skipped: ${c.name.slice(0, 60)}` }); continue; }
      const key = `${c.locationName}|${program.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { program, classes: [] });
      groups.get(key).classes.push(c);
    }
    for (const g of groups.values()) {
      const c0 = g.classes[0];
      const addr = clean(c0.locationAddress || '').replace(/,\s*United Kingdom$/i, '');
      const item = {
        name: `Baby Sparks ${g.program}`.replace(/^Baby Sparks Baby Sparks/, 'Baby Sparks'), provider,
        category: /massage/i.test(g.program) ? 'massage' : 'sensory',
        venue: clean(c0.locationName), address: addr.replace(PC_RE, '').replace(/,\s*,/g, ',').replace(/,\s*$/, '').trim(),
        postcode: normPc(addr), lat: null, lng: null, sessions: [], tier: 'venue', schedule_note: '',
        age_min_months: null, age_max_months: null, price: '', free: false, booking: 'term', indoor: true,
        description: /massage/i.test(g.program) ? DESC.massage : DESC.sparks,
        url: pageUrl, phone: '', source: 'babysparks.co.uk', confidence: 'high', _brand: 'Baby Sparks',
      };
      let payg = null, term = null;
      for (const c of g.classes) {
        let [a, b] = parseAge(c.description);
        if (a == null) { // programme defaults published on babysparks.co.uk class listings
          const P = { 'little sparks': [1, 9], 'spark shakers': [6, 13], 'spark movers': [8, 36] };
          for (const [k, [x, y]] of Object.entries(P)) if (g.program.toLowerCase().includes(k)) { a = Math.min(a ?? 99, x); b = Math.max(b ?? 0, y); }
        }
        if (a != null) { item.age_min_months = Math.min(item.age_min_months ?? 99, a); item.age_max_months = Math.max(item.age_max_months ?? 0, b); }
        if (c.payAsYouGoEnabled && c.payAsYouGoSessionPriceInPence) payg = payg ?? c.payAsYouGoSessionPriceInPence / 100;
        if (c.priceInPence && c.sessionCount > 1) term = term ?? c.priceInPence / 100;
        const evs = byClass.get(c.id) || [];
        const sess = evs.map((e) => {
          const m = String(e.timeLabel || '').match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
          if (!m || !e.dayKey) return null;
          const d = new Date(e.dayKey + 'T12:00:00Z');
          const start = to24(m[1], m[2], m[3]);
          return { day: DAY_ORDER[(d.getUTCDay() + 6) % 7], start, end: e.durationMinutes ? addMin(start, e.durationMinutes) : null };
        }).filter(Boolean);
        if (!sess.length) { // fall back to "(10am Thursday)" in class name
          const m = c.name.match(/\((\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)\s+(\w+day)\)/i);
          if (m && DAYS[m[4].toLowerCase()]) sess.push({ day: DAYS[m[4].toLowerCase()], start: to24(m[1], m[2], m[3]), end: null });
        }
        addSessions(item, sess);
      }
      const pp = [];
      if (payg != null) pp.push(`${money(payg)} per class (pay as you go)`);
      if (term != null) pp.push(`${money(term)} per term block`);
      item.price = pp.join('; ');
      item.booking = term != null ? 'term' : 'book';
      item.tier = item.sessions.length ? 'timetable' : 'venue';
      item.schedule_note = term != null ? 'Termly booking; see site for dates' : 'See site for dates';
      if (item.age_min_months == null) { item.age_min_months = 0; item.age_max_months = 36; item.confidence = 'medium'; }
      if (!item.sessions.length) item.confidence = 'medium';
      items.push(item);
    }
    log(`  [${n}/${slugs.length}] ${slug}: ${classes.length} classes -> ${groups.size} class-at-venue`);
  }
  return items;
}
function matchBracket(s) {
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const DESC = {
  bs: 'Weekly sensory development class for babies with music, lights, signing and play activities.',
  hello: 'Gentle sensory and bonding class for newborns and very young babies.',
  bloom: 'Baby development class with songs, sensory props and signing, grouped by age.',
  sparks: 'Sensory play class for babies and toddlers with songs, instruments, lights and bubbles.',
  massage: 'Baby massage and newborn support class for parents and young babies.',
};

// ---------- geocoding (postcodes.io) ----------
async function geocode(items) {
  const pcs = [...new Set(items.map((i) => i.postcode).filter(Boolean))];
  const result = new Map();
  for (let i = 0; i < pcs.length; i += 100) {
    const batch = pcs.slice(i, i + 100);
    const r = await get('https://api.postcodes.io/postcodes', { method: 'POST', body: JSON.stringify({ postcodes: batch }), headers: { 'Content-Type': 'application/json' }, skipRobots: true });
    try { for (const x of JSON.parse(r.text).result) if (x.result) result.set(x.query, x.result); } catch { log('  postcodes.io batch failed'); }
  }
  // Fallback: invalid/terminated full postcode, or no postcode -> outcode centroid (low confidence)
  const outcodes = new Map();
  for (const it of items) {
    const pc = it.postcode;
    if (pc && result.has(pc)) {
      const g = result.get(pc);
      it.lat = g.latitude; it.lng = g.longitude; it._region = g.country === 'England' ? g.region : g.country;
      if (!['England', 'Scotland', 'Wales', 'Northern Ireland'].includes(g.country)) it._drop = true;
      if (!it.address) it.address = g.admin_district || '';
      continue;
    }
    const oc = (pc || it._needsOutcode || '').toUpperCase().match(/^([A-Z]{1,2}\d[A-Z\d]?)\b/);
    if (!oc || /^(GY|JE|IM)/.test(oc[1])) { it._drop = true; continue; } // Channel Islands / Isle of Man out of scope
    if (!outcodes.has(oc[1])) {
      const r = await get(`https://api.postcodes.io/outcodes/${oc[1]}`, { skipRobots: true });
      try { outcodes.set(oc[1], JSON.parse(r.text).result || null); } catch { outcodes.set(oc[1], null); }
    }
    const o = outcodes.get(oc[1]);
    if (!o || o.latitude == null) { it._drop = true; continue; }
    it.lat = o.latitude; it.lng = o.longitude; it.confidence = 'low';
    it.postcode = oc[1];
    it._region = (o.country || [])[0] === 'England' ? `England (${(o.admin_district || [])[0] || 'unknown'})` : (o.country || [])[0];
  }
}

// ---------- main ----------
const brands = [
  ['Baby Sensory', crawlBabySensory],
  ['Bloom', crawlBloom],
  ['Baby Sparks', crawlBabySparks],
];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
let items = [];
for (const [name, fn] of brands) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) continue;
  try { items.push(...(await fn())); } catch (e) { log(`${name} crawl failed:`, e); skipped.push({ brand: name, reason: String(e) }); }
}
skipped.push({ url: 'https://www.hartbeeps.com/', reason: 'Cloudflare managed challenge (HTTP 403) for automated clients; not crawled' });

await geocode(items);
const dropped = items.filter((i) => i._drop).length;
items = items.filter((i) => !i._drop);
// de-duplicate identical class-at-venue rows
const seen = new Map();
for (const it of items) {
  const k = [it.name, it.provider, it.postcode, clean(it.venue).toLowerCase()].join('|');
  if (seen.has(k)) { const a = seen.get(k); addSessions(a, it.sessions); if (a.sessions.length) a.tier = 'timetable'; continue; }
  seen.set(k, it);
}
items = [...seen.values()];

const stats = { total: items.length, dropped_no_valid_postcode: dropped, byBrand: {}, byTier: {}, byRegion: {}, skipped };
for (const it of items) {
  stats.byBrand[it._brand] = (stats.byBrand[it._brand] || 0) + 1;
  const bt = `${it._brand} / ${it.tier}`; stats.byTier[bt] = (stats.byTier[bt] || 0) + 1;
  const region = (it._region || 'unknown').replace(/^England \(.*\)$/, 'England (outcode only)');
  stats.byRegion[region] = (stats.byRegion[region] || 0) + 1;
}
const KEYS = ['name', 'provider', 'category', 'venue', 'address', 'postcode', 'lat', 'lng', 'sessions', 'tier', 'schedule_note', 'age_min_months', 'age_max_months', 'price', 'free', 'booking', 'indoor', 'description', 'url', 'phone', 'source', 'confidence'];
for (const it of items) {
  it.address = clean(String(it.address || '').replace(new RegExp(PC_RE.source, 'gi'), '').replace(/\b[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}\b/gi, ''))
    .replace(/\s*,(\s*,)+/g, ',').replace(/^[,\s]+|[,\s]+$/g, '');
}
const out = items.map((it) => Object.fromEntries(KEYS.map((k) => [k, it[k] ?? (k === 'sessions' ? [] : k === 'lat' || k === 'lng' ? null : '')])));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
fs.writeFileSync(STATS, JSON.stringify(stats, null, 1));
console.log(JSON.stringify({ ...stats, skipped: skipped.length }, null, 1));
