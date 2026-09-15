#!/usr/bin/env node
// Little Days — UK toddler (roughly 18 months to 4 years) classes from national chains and group directories.
// Node 22 (global fetch). Polite: robots.txt checked per host (incl. ClaudeBot / anthropic-ai groups and ai-train=no),
// >=1.1 s between requests to any one host (Crawl-delay honoured), identifying UA, pages cached, no retries on blocks.
//
// Usage: node toddler-chains.mjs [--only=littlekickers,rugbytots,...] [--limit=N] [--offline]
//
// Sources (checked 2026-09-15):
//   littlekickers.co.uk   venue sitemap -> venue pages with a class table (robots: allowed)
//   rugbytots.co.uk       sitemap -> /Class/Details pages (robots: allowed)
//   socatots.co.uk        venues sitemap -> venue pages (class phases written in text; robots: allowed)
//   miniprofessors.com    venue index on wowworldgroup.com/find-a-class + area timetable API (robots: /booking only disallowed)
//   hartbeeps.com         area /venues pages (venue list only; timetables come from api.uk.prod.franscape.services,
//                         whose robots.txt is Disallow: / -> not crawled)
//   careforthefamily.org.uk  Who Let The Dads Out? directory JSON used by its own map (robots: allowed, Crawl-delay 10)
//   stagecoach.co.uk      school pages for Mini Stages (2-4 yrs) (robots: allowed for paths without query strings)
//   meithrin.cymru        Cylch Ti a Fi listing (robots: allowed)
// Skipped (see report): minimovers.co.uk (403 bot block), booking.diddidance.com (robots Disallow /),
//   the-bugs-group.classforkids.io (Dance Bugs; classforkids robots), secure.clubmanagercentral.com (Razzamataz; Disallow /),
//   thinksmartsoftwareuk.com (ARTventurers; Disallow /), franscape API (Hartbeeps and Rhythm Time timetables; Disallow /).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'LittleDaysBot/1.0 (family app; links back to providers)';
const SCRATCH = '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/toddler-chains/';
const CACHE = SCRATCH + 'cache/';
const OUT = '/Users/marcos/little-days/data/uk-research/toddler-chains.json';
const REPORT = SCRATCH + 'report.json';
fs.mkdirSync(CACHE, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const OFFLINE = !!args.offline;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const SKIPPED = [];
const skip = (site, reason) => { if (!SKIPPED.some((s) => s.site === site && s.reason === reason)) SKIPPED.push({ site, reason }); };

// ---------------- polite fetch ----------------
const hostNext = new Map();
const hostDelay = new Map();
const deadHosts = new Map();
const robots = new Map();
const AI_AGENTS = ['littledaysbot', 'claudebot', 'claude-web', 'claude-user', 'anthropic-ai'];

function parseRobots(txt) {
  const groups = []; let cur = null; let lastUA = false; let delay = 0;
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastUA = true; continue; }
    lastUA = false;
    if (!cur) continue;
    if (k === 'allow' || k === 'disallow') cur.rules.push({ allow: k === 'allow', p: v });
    if (k === 'crawl-delay' && (cur.agents.includes('*') || cur.agents.some((a) => AI_AGENTS.includes(a)))) delay = Math.max(delay, parseFloat(v) || 0);
  }
  const specific = groups.filter((g) => g.agents.some((a) => AI_AGENTS.includes(a)));
  const rules = (specific.length ? specific : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  const aiBlocked = specific.some((g) => g.rules.some((r) => !r.allow && r.p === '/')) || /ai-train\s*=\s*no/i.test(txt);
  return { rules, delay, aiBlocked };
}
const ruleRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));

async function robotsFor(origin) {
  if (robots.has(origin)) return robots.get(origin);
  const r = await rawFetch(origin + '/robots.txt', {});
  let parsed = { rules: [], delay: 0, aiBlocked: false };
  if (r.status === 200 && !/<html/i.test(r.text.slice(0, 300))) parsed = parseRobots(r.text);
  else if (r.status === 401 || r.status === 403) parsed = { rules: [{ allow: false, p: '/' }], delay: 0, aiBlocked: true };
  if (parsed.delay) hostDelay.set(new URL(origin).host, Math.min(parsed.delay, 15) * 1000);
  robots.set(origin, parsed);
  return parsed;
}
async function allowed(url) {
  const u = new URL(url);
  const rb = await robotsFor(u.origin);
  if (rb.aiBlocked) return false;
  const p = u.pathname + u.search; let best = null;
  for (const r of rb.rules) { if (!r.p) continue; if (ruleRe(r.p).test(p) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r; }
  return !best || best.allow;
}
const cacheFile = (url, method, body) => CACHE + crypto.createHash('sha1').update(method === 'GET' && !body ? url : method + ' ' + url + ' ' + body).digest('hex') + '.json';

async function rawFetch(url, { method = 'GET', body, headers = {} }) {
  const f = cacheFile(url, method, body);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  if (OFFLINE) return { url, status: 0, text: '', offline: true };
  const host = new URL(url).host;
  if (deadHosts.has(host)) return { url, status: -2, text: '' };
  const wait = (hostNext.get(host) || 0) - Date.now(); if (wait > 0) await sleep(wait);
  hostNext.set(host, Date.now() + Math.max(1100, hostDelay.get(host) || 0));
  let res;
  try {
    const r = await fetch(url, { method, body, headers: { 'User-Agent': UA, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(40000) });
    res = { url, final: r.url, status: r.status, text: await r.text() };
  } catch (e) { return { url, status: 0, text: '', error: String(e) }; }
  hostNext.set(host, Date.now() + Math.max(1100, hostDelay.get(host) || 0));
  const challenge = /<title>\s*(Just a moment|Attention Required|Access Blocked)/i.test(res.text.slice(0, 3000)) || /cf-challenge|captcha-delivery/i.test(res.text.slice(0, 3000));
  if ([401, 403, 429].includes(res.status) || challenge) {
    deadHosts.set(host, `${res.status}${challenge ? ' challenge' : ''}`);
    skip(host, `blocked (${res.status}${challenge ? ', challenge page' : ''}) — not retried`);
    return { ...res, blocked: true };
  }
  if (res.status > 0 && res.status < 500) fs.writeFileSync(f, JSON.stringify(res));
  return res;
}
async function get(url, opts = {}) {
  if (!opts.skipRobots && !(await allowed(url))) { skip(new URL(url).host, `robots.txt disallows ${new URL(url).pathname}`); return { url, status: -1, text: '', robots: true }; }
  return rawFetch(url, opts);
}

// ---------------- helpers ----------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…', pound: '£' };
const decode = (s) => String(s ?? '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const strip = (h) => decode(String(h ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '));
const clean = (s) => decode(String(s ?? '')).replace(/\s+/g, ' ').trim();
const PC_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const normPc = (s) => { const m = String(s || '').toUpperCase().match(PC_RE); return m ? `${m[1]} ${m[2]}` : ''; };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayAbbr = (s) => { const m = String(s || '').match(/\b(mon|tue|wed|thu|fri|sat|sun)/i); return m ? m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase() : null; };
const pad = (n) => String(n).padStart(2, '0');
function hm(h, m, ap) {
  h = +h; m = +(m || 0); if (!(h >= 0 && h < 24 && m < 60)) return null;
  if (ap) { ap = ap.toLowerCase(); if (ap[0] === 'p' && h < 12) h += 12; if (ap[0] === 'a' && h === 12) h = 0; }
  else if (h >= 1 && h <= 6) h += 12; // un-marked 1-6 o'clock are afternoon sessions
  return `${pad(h)}:${pad(m)}`;
}
const addMins = (t, mins) => { if (!t) return null; const [h, m] = t.split(':').map(Number); const x = h * 60 + m + mins; return x >= 24 * 60 ? null : `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`;
function parseRange(s) {
  s = String(s || '').replace(/\b12\s*noon\b|\bnoon\b|\bmidday\b/gi, '12:00pm');
  const m = s.match(new RegExp(TIME + String.raw`\s*(?:-|–|—|to|till|til|until)\s*` + TIME, 'i'));
  if (!m) return null;
  const endAp = m[6] ? m[6].replace(/\./g, '') : null; const startAp = m[3] ? m[3].replace(/\./g, '') : null;
  if (!m[2] && !startAp && !m[5] && !endAp) return null; // bare "3-5" is usually an age range
  let start = hm(m[1], m[2], startAp || endAp); let end = hm(m[4], m[5], endAp || (+m[4] === 12 ? 'pm' : startAp));
  if (!startAp && endAp && start && end && start > end) start = hm(m[1], m[2], 'am');
  if (!endAp && start && end && end <= start) end = hm(m[4], m[5], 'pm');
  return start && end && end > start ? { start, end } : start ? { start, end: null } : null;
}
function parseSingle(s) { const m = String(s || '').match(new RegExp(String.raw`\b` + TIME, 'i')); return m && (m[2] || m[3]) ? hm(m[1], m[2], m[3] && m[3].replace(/\./g, '')) : null; }
const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const items = [];
function add(it) {
  const sessions = (it.sessions || []).filter((s) => s.day);
  const uniq = [...new Map(sessions.map((s) => [`${s.day}|${s.start}|${s.end}`, { day: s.day, start: s.start || null, end: s.end || null }])).values()]
    .sort((a, b) => ((DAYS.indexOf(a.day) + 6) % 7) - ((DAYS.indexOf(b.day) + 6) % 7) || String(a.start).localeCompare(String(b.start)));
  items.push({
    name: it.name, provider: it.provider, category: it.category, venue: clean(it.venue), address: clean(it.address), postcode: normPc(it.postcode),
    lat: 0, lng: 0, sessions: uniq, tier: uniq.some((s) => s.start) ? 'timetable' : 'venue', schedule_note: it.schedule_note || '',
    age_min_months: it.age_min_months, age_max_months: it.age_max_months, price: it.price || '', free: !!it.free, booking: it.booking,
    indoor: it.indoor ?? true, description: it.description, url: it.url, phone: it.phone || '', source: it.source, confidence: it.confidence || 'high',
  });
}
// merge several rows for the same class at the same venue into one item with several sessions
function groupAdd(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = [r.name, r.provider, normPc(r.postcode), clean(r.venue).toLowerCase(), r.age_min_months, r.age_max_months].join('|');
    if (!by.has(k)) by.set(k, { ...r, sessions: [...(r.sessions || [])] }); else by.get(k).sessions.push(...(r.sessions || []));
  }
  for (const r of by.values()) add(r);
}
const counts = {};
const note = (src, k, n = 1) => { counts[src] = counts[src] || {}; counts[src][k] = (counts[src][k] || 0) + n; };
const sitemapLocs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decode(m[1]));

// ---------------- Little Kickers ----------------
// Venue titles are franchise-edited and can carry promotions, day tags, room notes or a coach's first name; keep the place only.
const LK_PLACE_WORDS = /\b(hall|centre|center|school|academy|church|club|gym|gymnasium|leisure|park|pavilion|village|community|college|sports?|arena|studio|house|room|library|chapel|scout|hut|institute|trust|dome|barn|court|rooms?|primary|junior|infant|high|grammar|free|methodist|baptist|united|parish|memorial|recreation|ground|field|pitch|campus|university|hub|lodge|garden|farm|fc|rfc|cc)\b/i;
function cleanLKVenue(raw, address) {
  let s = decode(raw).replace(/[   ]/g, ' ').replace(/\*\*[^*]*\*\*/g, ' ')
    .replace(/\(\s*see notes[^)]*\)/gi, ' ').replace(/\bclasses\s*(?=\()/gi, ' ')
    .replace(/\b(?:classes\s+)?for\s+(?:children\s+)?(?:aged\s+)?[\d.]+\s*(?:months?|years?)?\s*(?:to|-|–)\s*[\d.]+\+?\s*(?:months?|years?)(?:\s+of\s+age)?(?:\s+at\b)?/gi, ' ')
    .replace(/[–-]?\s*[\d.]+\s*(?:months?|years?)\s*(?:to|-|–)\s*[\d.]+\+?\s*(?:months?|years?)\b/gi, ' ')
    .replace(/\bfrom\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s*@\s*/gi, ' ').replace(/[–-]?\s*\bclasses\s+ou[rt]side\b.*$/i, ' ').replace(/\bclasses\s*[–-]\s*$/i, ' ')
    .replace(/["“]\s*summer\b.*$/i, ' ').replace(/\bnow\s+available\s+to\s+book\b/gi, ' ').replace(/\bsummer\s+hol[’']?s\b/gi, ' ').replace(/\b[AP]\.M\b\.?/g, ' ')
    .replace(/\b(e-?mail|registration|classes\s+available|free\s+parking|coming\s+soon)\b.*$/i, ' ')
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\s*(?:\/\s*\w+\s*)?start\b.*$/i, ' ')
    .replace(/\(\s*year[\s-]+round[^)]*\)/gi, ' ').replace(/\b(mon|tues|wednes|thurs|fri|satur|sun)days?\s*(?:’|')s\b/gi, ' ')
    .replace(/\*\*[^*]*\*\*/g, ' ').replace(/\b1st month free\b!*/gi, ' ').replace(/\busually\s*£?\s*\d+\b!*/gi, ' ').replace(/\bfree (trial|taster)s?\b/gi, ' ')
    .replace(/\b(re-?)?opening\b.*$/i, ' ').replace(/\b(now open|new venue|coming soon|new|email for)\b!*/gi, ' ')
    .replace(/\b(mon|tues|wednes|thurs|fri|satur|sun)days?\b/gi, ' ').replace(/\((?:\s*(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\s*[/&,]?\s*)+\)/gi, ' ')
    .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b\.?/gi, ' ').replace(/\b(am|pm|morning|afternoon)s?\b/gi, ' ')
    .replace(/\(\s*(?:indoors?|outdoors?)\s*\)|\b(?:indoors?|outdoors?)\b(?![\s-]*(?:sports|hall|centre|arena|pitch))/gi, ' ')
    .replace(/[!*]+/g, ' ')
    .replace(/\b(inside|outside)\b/gi, ' ').replace(/\(\s*(?:indoor|outdoor)?\s*venue\s*\)/gi, ' ').replace(/\bterm time only\b/gi, ' ')
    .replace(/[   ]/g, ' ')
    .replace(/\b(opens?|launching|starting|starts?|register|join|book\s+now|enquire|e-?mail|waitlist|classes?\s+(?:running|starts?)|new\s+classes?)\b.*$/i, ' ')
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+start\b.*$/i, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b.*$/i, ' ').replace(/\bschool year\b.*$/i, ' ')
    .replace(/\b(?:girls?|boys?)\s+(?:only|class(?:es)?|football)\b(?:\s+class(?:es)?)?/gi, ' ').replace(/\b(?:mega|mighty|junior|little)\s+kick(?:er)?s?\b.*$/i, ' ')
    .replace(/\s+class(?:es)?\s*\)/gi, ')').replace(/\(\s*class(?:es)?\s*\)/gi, ' ').replace(/[–—-]\s*class(?:es)?\s*$/i, ' ').replace(/\s+classes\s*$/i, ' ');
  s = s.replace(/^\s*\(([^()]+)\)\s*$/, '$1');
  // tidy brackets: drop symbol-only openings, unbalanced or empty brackets
  s = s.replace(/\(\s*[&/–—-]+\s*/g, '(').replace(/\(\s*\)/g, ' ');
  if ((s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length) s = s.replace(/\([^)]*$/, ' ');
  let segs = s.split(/\s+[–—-]\s+|\s*[–—]\s*|\s+-(?=[A-Z])/).map((x) => x.replace(/^[^\p{L}\d(]+|[^\p{L}\d)]+$/gu, '').trim()).filter(Boolean);
  segs = segs.filter((seg) => !(segs.length > 1 && /^[A-Z][a-z]{1,11}$/.test(seg) && !LK_PLACE_WORDS.test(seg))); // lone first names between dashes
  const addrLc = String(address || '').toLowerCase();
  if (segs.length > 1 && segs.some((x) => LK_PLACE_WORDS.test(x))) segs = segs.filter((seg) => LK_PLACE_WORDS.test(seg) || !addrLc.includes(seg.toLowerCase().replace(/\s+[a-z]{1,2}\d{1,2}[a-z]?$/i, '')));
  s = segs.join(' – ').replace(/\s*[–—-]\s*(?=\()/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,)])/g, '$1').replace(/\(\s+/g, '(').replace(/^[\s,–-]+|[\s,–-]+$/g, '');
  const lead = s.match(/^([A-Z][A-Z'’&-]{2,}(?:\s+[A-Z][A-Z'’&-]{2,})*)\s+(?=[A-Z][a-z])/); // e.g. "BEXLEYHEATH Townley Grammar School"
  if (lead && new RegExp(lead[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(address || '')) s = s.slice(lead[0].length);
  return s.trim();
}
async function crawlLittleKickers() {
  const SRC = 'littlekickers.co.uk';
  const sm = await get('https://www.littlekickers.co.uk/jpl_venue-sitemap.xml');
  const urls = sitemapLocs(sm.text).filter((u) => /\/en-gb\/locations\/[^/]+\/venues\/[^/]+/.test(u)).slice(0, LIMIT);
  log(`Little Kickers: ${urls.length} venue pages`);
  const PROG = { 'Little Kicks': [18, 30], 'Junior Kickers': [30, 42], 'Mighty Kickers': [42, 60] };
  const rows = [];
  for (const url of urls) {
    const r = await get(url); if (r.status !== 200) { note(SRC, `http_${r.status}`); continue; }
    const t = r.text;
    const loc = t.match(/<div class="locator-location">\s*<div class="name">([\s\S]*?)<\/div>\s*<address>([\s\S]*?)<\/address>/);
    if (!loc) { note(SRC, 'no_address_block'); continue; }
    const rawName = clean(strip(loc[1]));
    const addrLines = strip(loc[2]).split('\n').map(clean).filter(Boolean);
    const pc = normPc(addrLines.join(' '));
    const title = clean(strip((t.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ''));
    const provider = clean((title.split('|')[1] || '').trim()) || 'Little Kickers';
    const venue = cleanLKVenue(rawName, addrLines.join(' ')) || rawName.replace(/[*!]+/g, '').trim();
    const phone = clean((t.match(/href="tel:([^"]+)"/) || [])[1] || '').replace(/[^\d+ ]/g, '');
    const trs = [...t.matchAll(/<tr\s+data-class_program="([^"]+)"\s+data-class_day="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)];
    if (!trs.length) note(SRC, 'venue_without_classes');
    for (const [, prog, day, body] of trs) {
      const ages = PROG[decode(prog)]; if (!ages) continue;
      const tds = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      const timeTxt = clean(strip((tds[0] || '').split(/<br\s*\/?>/i)[1] || ''));
      const range = parseRange(timeTxt);
      const dates = clean(strip((tds[2] || '').split(/<br|<span/i)[0]));
      rows.push({
        name: `Little Kickers ${decode(prog)}`, provider, category: 'movement', venue, address: addrLines.join(', '), postcode: pc,
        sessions: [{ day: dayAbbr(day), start: range?.start, end: range?.end }], age_min_months: ages[0], age_max_months: ages[1],
        booking: /rolling/i.test(dates) ? 'book' : 'term', indoor: !/\b(park|field|pitch|outdoor)\b/i.test(venue) || /\b(hall|centre|center|school|leisure)\b/i.test(venue),
        description: 'Play-based football classes for toddlers and pre-schoolers, grouped by age.', url, phone, source: SRC, confidence: 'high',
        schedule_note: /rolling/i.test(dates) ? 'Rolling monthly enrolment.' : '',
      });
    }
    note(SRC, 'pages');
  }
  groupAdd(rows);
}

// ---------------- Rugbytots ----------------
async function crawlRugbytots() {
  const SRC = 'rugbytots.co.uk';
  const sm = await get('https://www.rugbytots.co.uk/sitemap.xml');
  const urls = sitemapLocs(sm.text).filter((u) => /\/Class\/Details\/\d+$/i.test(u)).slice(0, LIMIT);
  log(`Rugbytots: ${urls.length} class pages`);
  const rows = [];
  for (const url of urls) {
    const r = await get(url); if (r.status !== 200) { note(SRC, `http_${r.status}`); continue; }
    const txt = clean(strip(r.text));
    const sum = txt.match(/Class Summary\s+(?:.*?\d{4}\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}:\d{2}\s*[ap]m)\s+Age\s+([\d.]+)\s*-\s*([\d.]+)\s+(\d+)\s*mins/i);
    if (!sum) { note(SRC, 'no_summary'); continue; }
    const aMin = Math.round(parseFloat(sum[3]) * 12), aMax = Math.round(parseFloat(sum[4]) * 12);
    if (aMin > 48) { note(SRC, 'older_class'); continue; }
    const start = parseSingle(sum[2]);
    const provider = clean((txt.match(/This class is run by:\s*(.+?)\s+(?:Call|Email|This class takes place)/i) || [])[1] || 'Rugbytots');
    const phone = clean((txt.match(/This class is run by:.*?Call\s+([\d ]{10,14})/i) || [])[1] || '');
    // "This class takes place at:<br /><strong>venue label</strong><br /><strong>address</strong></p>"
    const placeHtml = (r.text.match(/This class takes place at:([\s\S]*?)<\/p>/i) || [])[1] || '';
    const strongs = [...placeHtml.matchAll(/<strong>([\s\S]*?)<\/strong>/gi)].map((m) => clean(strip(m[1])));
    const noEmail = (s) => s.replace(/\S+@\S+/g, ' ').replace(/\s+/g, ' ').trim();
    let address = noEmail(strongs.slice(1).join(', '));
    const fullLabel = noEmail(decode(strongs[0] || ''));
    if (/private\s+class|attending\s+the\s+nursery|pupils\s+only|children\s+only|closed\s+school|lunchtime\s+club|after[\s-]?school\s+club|breakfast\s+club|nursery\s+children|school\s+pupils/i.test(fullLabel)) { note(SRC, 'school_only_class'); continue; }
    let label = fullLabel.split(/\s*●\s*/)[0];
    label = label.replace(/^[A-Z][A-Z &'’-]{2,}\s*(?::|\s-\s)\s*(?=\S)/, '') // "HALESOWEN: Leasowes Sports Centre"
      .replace(/\([^)]*\b(session|click|link|available|spaces?)\b[^)]*\)/gi, ' ').replace(/["“]?\b(summer|autumn|spring|winter)\s+term\b.*$/i, ' ')
      .replace(/[–—-]?\s*\bclasses\s+only\b/gi, ' ').replace(/,?\s*\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, ' ');
    let venue = cleanLKVenue(label, address).replace(/[.,;:"\s–-]+$/, '').replace(/^[.,;:"\s–-]+/, '');
    if (!venue || venue.length < 3 || /^(book|contact|join|call)\b/i.test(venue)) venue = (address.split(',')[0] || '').trim();
    if (!address && normPc(venue)) { address = venue; }
    const pc = normPc(address) || normPc(label);
    const price = (txt.match(/£\s?(\d+(?:\.\d{2})?)\s*per session/i) || [])[1];
    rows.push({
      name: 'Rugbytots', provider, category: 'movement', venue, address: address || venue, postcode: pc,
      sessions: [{ day: dayAbbr(sum[1]), start, end: addMins(start, +sum[5]) }], age_min_months: aMin, age_max_months: aMax,
      price: price ? `£${price} per session` : '', booking: 'term', indoor: !/\b(park|field|pitch|playing fields|recreation ground|rec)\b/i.test(venue + ' ' + address),
      description: 'Play-based rugby sessions that build coordination, confidence and social skills.', url, phone, source: SRC, confidence: 'high',
    });
    note(SRC, 'toddler_class_pages');
  }
  groupAdd(rows);
}

// ---------------- Socatots ----------------
async function crawlSocatots() {
  const SRC = 'socatots.co.uk';
  const sm = await get('https://socatots.co.uk/venues-sitemap1.xml');
  const urls = sitemapLocs(sm.text).filter((u) => /\/venues\/[^/]+\/?$/.test(u)).slice(0, LIMIT);
  log(`Socatots: ${urls.length} venue pages`);
  const rows = [];
  for (const url of urls) {
    const r = await get(url); if (r.status !== 200) { note(SRC, `http_${r.status}`); continue; }
    const t = r.text;
    const town = clean(strip((t.match(/<h2[^>]*dmach-post-title">([\s\S]*?)<\/h2>/) || [])[1] || '')).replace(/^.*?\bin\s+/i, '').replace(/\b(toddlers?|kids|children'?s?)?\s*football\s*(classes|clubs?)\b/gi, '').replace(/\s+/g, ' ').trim();
    const addrOf = (v) => [...new Set([v, town])].filter(Boolean).concat(pc ? [] : []).join(', ');
    const body = (t.match(/<div class="dmach-acf-value\s*">([\s\S]*?)<\/div>/) || [])[1] || '';
    const txt = clean(strip(body));
    const pc = normPc(decode((t.match(/[?&](?:amp;)?Postcode=([A-Z0-9+%]+)/i) || [])[1] || '').replace(/\+|%20/g, ' ')) || normPc(txt);
    if (!pc) { note(SRC, 'no_postcode'); continue; }
    const venueM = txt.match(/\b(?:runs|run|held|takes place|are held)\b[^.]*?\b(?:in|at)\s+(?:the\s+)?([A-Z][A-Za-z0-9'’&\- ]{3,60}?)(?:,|\.|\s+(?:a|an|which|on|every|from)\b)/);
    const venue = venueM ? venueM[1].trim() : town;
    const days = [...new Set([...txt.matchAll(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/gi)].map((m) => dayAbbr(m[1])))];
    const phases = [...txt.matchAll(/Phase\s*(\d)\s*[–—-]\s*Ages?\s*(.+?)\s*@\s*([^P]+?)(?=Phase\s*\d|$)/gi)];
    const band = (n) => ({ 1: [6, 12], 2: [12, 36], 3: [36, 60] }[n]);
    let any = false;
    for (const [, n, , times] of phases) {
      const ages = band(+n); if (!ages || ages[0] > 48 || +n === 1) continue;
      const starts = [...times.matchAll(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/gi)].map((m) => hm(m[1], m[2], m[3]));
      const sessions = days.length === 1 ? starts.map((s) => ({ day: days[0], start: s, end: addMins(s, 45) && null })) : days.map((d) => ({ day: d, start: null, end: null }));
      rows.push({
        name: `Socatots Phase ${n}`, provider: `Socatots ${town}`, category: 'movement', venue, address: `${venue}, ${town}, ${pc}`, postcode: pc,
        sessions, age_min_months: ages[0], age_max_months: ages[1], booking: 'term',
        schedule_note: days.length > 1 ? `Runs on ${days.join(' and ')}; check the venue page for times.` : '',
        description: 'Football-themed play classes where toddlers build balance and ball skills with a parent or carer.', url, source: SRC, confidence: venueM ? 'medium' : 'low',
      });
      any = true;
    }
    if (!any) {
      rows.push({
        name: 'Socatots', provider: `Socatots ${town}`, category: 'movement', venue, address: `${venue}, ${town}, ${pc}`, postcode: pc,
        sessions: days.map((d) => ({ day: d, start: null, end: null })), age_min_months: 12, age_max_months: 60, booking: 'term',
        schedule_note: 'Check the venue page for class times by age.', description: 'Football-themed play classes where toddlers build balance and ball skills with a parent or carer.',
        url, source: SRC, confidence: 'low',
      });
    }
    note(SRC, 'pages');
  }
  groupAdd(rows);
}

// ---------------- Mini Professors (WOW World Group) ----------------
async function crawlMiniProfessors() {
  const SRC = 'miniprofessors.com';
  const idx = await get('https://www.wowworldgroup.com/find-a-class');
  const at = idx.text.indexOf('const allVenues');
  if (at < 0) { skip('wowworldgroup.com', 'venue index not found'); return; }
  const all = JSON.parse(idx.text.slice(idx.text.indexOf('[', at)).match(/^\[[\s\S]*?\}\](?=\s*;|\s*\n)/)[0]);
  const venues = all.filter((v) => v.SiteID === 7 && /miniprofessors\.com\/[^/]+/.test(v.MiniSiteUrl || ''));
  const areas = [...new Set(venues.map((v) => v.MiniSiteUrl))].slice(0, LIMIT);
  log(`Mini Professors: ${venues.length} venues across ${areas.length} areas`);
  const rows = [];
  const DESC = 'Hands-on science sessions for pre-schoolers with simple experiments, stories and songs.';
  for (const area of areas) {
    const home = await get(area); if (home.status !== 200) { note(SRC, `http_${home.status}`); continue; }
    const title = clean(strip((home.text.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ''));
    const slugName = titleCase(new URL(area).pathname.replace(/\//g, ''));
    const shortTitle = title.replace(/\s*[|–].*$/, '').trim();
    const provider = /^Mini Professors\s+\S/.test(shortTitle) && shortTitle.length <= 50 && !/\b(science|classes|parties|nursery|schools?|programme)\b/i.test(shortTitle) ? shortTitle : `Mini Professors ${slugName}`;
    const phone = clean((home.text.match(/href="tel:([^"]+)"/i) || [])[1] || '');
    const cid = (home.text.match(/CompanyID=(\d+)/) || [])[1];
    const areaVenues = venues.filter((v) => v.MiniSiteUrl === area);
    let tt = [];
    if (cid) { const api = await get(`https://www.miniprofessors.com/api/v1/minisite/loadTimeTable?companyID=${cid}&customerID=0`); try { tt = JSON.parse(api.text).timetable || []; } catch { note(SRC, 'api_not_json'); } }
    const seenVenue = new Set();
    for (const c of tt) {
      const ageTxt = clean(c.AgeRange); const am = ageTxt.match(/(\d+)\s*years?\s*(?:(\d+)\s*months?)?\s*to\s*(\d+)\s*years?\s*(?:(\d+)\s*months?)?/i);
      const aMin = am ? +am[1] * 12 + +(am[2] || 0) : 24, aMax = am ? +am[3] * 12 + +(am[4] || 0) : 71;
      if (aMin > 48) continue;
      const range = parseRange(c.Times);
      const full = (c.Products || []).find((p) => p.fixedTerm && p.price > 0) || (c.Products || []).find((p) => p.price > 0);
      const idxVenue = venues.find((v) => v.VenueID === c.VenueID);
      const pc = normPc(c.Address) || normPc(idxVenue?.PostCode);
      seenVenue.add(c.VenueID);
      rows.push({
        name: 'Mini Professors', provider, category: 'sensory', venue: clean(c.Venue), address: normPc(c.Address) ? clean(c.Address) : [clean(c.Address), pc].filter(Boolean).join(', '), postcode: pc,
        sessions: (c.DayOfWeek || []).map((d) => ({ day: DAYS[(d - 1 + 7) % 7], start: range?.start, end: range?.end })),
        age_min_months: aMin, age_max_months: Math.min(aMax, 71), price: full ? `£${full.price.toFixed(2)} ${full.fixedTerm ? 'per term' : `for ${full.productSessions || 1} session${full.productSessions > 1 ? 's' : ''}`}` : '',
        booking: 'term', description: DESC, url: area, phone, source: SRC, confidence: 'high',
      });
    }
    for (const v of areaVenues) {
      if (seenVenue.has(v.VenueID)) continue;
      rows.push({
        name: 'Mini Professors', provider, category: 'sensory', venue: clean(v.Name), address: [v.AddressLine1, v.AddressLine2, v.City, v.PostCode].map(clean).filter(Boolean).join(', '),
        postcode: v.PostCode, sessions: (v.RunningDays || []).map((d) => ({ day: DAYS[(d - 1 + 7) % 7], start: null, end: null })),
        age_min_months: 24, age_max_months: 60, booking: 'term', schedule_note: 'Class times are on the area timetable.', description: DESC, url: area, phone, source: SRC, confidence: 'medium',
      });
    }
    note(SRC, 'areas');
  }
  groupAdd(rows);
}

// ---------------- Hartbeeps (venue lists) ----------------
async function crawlHartbeeps() {
  const SRC = 'hartbeeps.com';
  const sm = await get('https://www.hartbeeps.com/sitemap.xml');
  const urls = sitemapLocs(sm.text).filter((u) => /hartbeeps\.com\/[^/]+\/venues$/.test(u)).slice(0, LIMIT);
  log(`Hartbeeps: ${urls.length} area venue pages`);
  const rows = [];
  for (const url of urls) {
    const r = await get(url); if (r.status !== 200) { note(SRC, `http_${r.status}`); continue; }
    const title = clean(strip((r.text.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ''));
    const area = title.split('|')[0].trim() || titleCase(url.split('/')[3]);
    const vs = [...r.text.matchAll(/<a href="(https:\/\/www\.hartbeeps\.com\/[^"]+\/venues\/[^"]+)">([\s\S]*?)<\/a>\s*<\/div>\s*<div[^>]*>\s*<a class="regular" href="\1">([\s\S]*?)<\/a>/g)];
    for (const [, , nm, ad] of vs) {
      const address = clean(strip(ad)).replace(/`/g, '').replace(/\.\s*,/g, ',').replace(/\s*,\s*,/g, ','); const pc = normPc(address);
      if (!pc) { note(SRC, 'no_postcode'); continue; }
      const venue = clean(strip(nm)).replace(/\.$/, '');
      rows.push({
        name: 'Hartbeeps', provider: `Hartbeeps ${area}`, category: 'sensory', venue, address: address.startsWith(venue) ? address : `${venue}, ${address}`, postcode: pc,
        sessions: [], age_min_months: 0, age_max_months: 48, booking: 'term',
        schedule_note: 'Venue used by this Hartbeeps area; baby and toddler class times are on the area classes page.',
        description: 'Multi-sensory music, story and play classes for babies and toddlers.', url: url.replace(/\/venues$/, '/classes'), source: SRC, confidence: 'medium',
      });
    }
    note(SRC, 'areas');
  }
  groupAdd(rows);
}

// ---------------- Who Let The Dads Out? (Care for the Family directory) ----------------
function monthsFromAgeText(s) {
  s = clean(s).toLowerCase(); if (!s) return null;
  if (/under\s*(\d+)/.test(s)) return [0, +s.match(/under\s*(\d+)/)[1] * 12];
  const m = s.match(/(\d+)\s*(months?|m)?\s*(?:-|–|to)\s*(\d+)\s*(months?|m)?/);
  if (!m) return null;
  const a = /month|^m$/.test(m[2] || '') ? +m[1] : +m[1] * 12; const b = /month|^m$/.test(m[4] || '') ? +m[3] : +m[3] * 12;
  return a <= b ? [a, b] : null;
}
async function crawlWLTDO() {
  const SRC = 'careforthefamily.org.uk';
  const r = await get('https://www.careforthefamily.org.uk/wp-json/directories/v1/get/');
  let list = []; try { list = JSON.parse(r.text).result || []; } catch { skip(SRC, 'directory JSON not parseable'); return; }
  log(`Who Let The Dads Out?: ${list.length} directory entries`);
  for (const g of list.slice(0, LIMIT)) {
    const pc = normPc(g.address_postcode); if (!pc) { note(SRC, 'no_postcode'); continue; }
    const sched = clean(g.schedule).replace(/\S+@\S+/g, '').replace(/https?:\/\/\S+/g, '');
    const day = dayAbbr((sched.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i) || [])[1]);
    const range = parseRange(sched) || (parseSingle(sched) ? { start: parseSingle(sched), end: null } : null);
    const ord = sched.match(/\b(first|second|third|fourth|last|1st|2nd|3rd|4th)\s+(saturday|sunday|friday|monday|tuesday|wednesday|thursday)/i);
    let freq = '';
    if (ord) freq = `Monthly on the ${ord[1].toLowerCase()} ${titleCase(ord[2].toLowerCase())}`;
    else if (/fortnight/i.test(sched)) freq = 'Fortnightly';
    else if (/month/i.test(sched)) freq = 'Monthly';
    else if (/\b(every|each)\s+(saturday|sunday|friday|monday|tuesday|wednesday|thursday|week)\b|weekly/i.test(sched)) freq = 'Weekly';
    const ages = monthsFromAgeText(g.children_age_range);
    if (ages && ages[0] > 48) { note(SRC, 'older_children_only'); continue; }
    const price = (sched.match(/£\s?\d+(?:\.\d{2})?(?:\s*(?:per|a|each)\s*(?:session|family|child|person))?/i) || [])[0] || '';
    const address = [g.building_name, g.address_line_1, g.address_line_2, g.address_line_3, g.address_town_city, pc].map(clean).filter(Boolean)
      .reduce((acc, p) => (/^\d+[a-z]?$/i.test(acc[acc.length - 1] || '') ? [...acc.slice(0, -1), `${acc[acc.length - 1]} ${p}`] : [...acc, p]), []).join(', ');
    add({
      name: 'Who Let The Dads Out?', provider: clean(decode(g.post_title)) || 'Who Let The Dads Out?', category: 'stayplay', venue: clean(g.building_name) || clean(g.address_town_city),
      address, postcode: pc, sessions: day ? [{ day, start: range?.start, end: range?.end }] : [],
      schedule_note: [freq, 'Check the group listing for upcoming dates.'].filter(Boolean).join('. ') + (freq ? '' : ''),
      age_min_months: ages ? ages[0] : 0, age_max_months: ages ? Math.max(ages[1], 12) : 96, price, free: /\bfree\b/i.test(sched) && !price, booking: 'drop-in',
      description: 'Relaxed groups, often church-hosted, where dads and father figures play and share food with their children.',
      url: decode(g.url) || 'https://www.careforthefamily.org.uk/support-for-you/faith-in-the-family/support-for-churches/wltdo/directories/',
      source: SRC, confidence: ages && day ? 'high' : 'medium',
    });
    note(SRC, 'entries');
  }
}

// ---------------- Stagecoach (Mini Stages 2-4, Early Stages 4-6) ----------------
async function crawlStagecoach() {
  const SRC = 'stagecoach.co.uk';
  const dir = await get('https://www.stagecoach.co.uk/schools/');
  const seg = dir.text.slice(Math.max(0, dir.text.indexOf('class="scdir-school-list')));
  const schools = [...new Set([...seg.matchAll(/<li data-school="[^"]*"><a href="(https:\/\/www\.stagecoach\.co\.uk\/[^"?#]+)"/g)].map((m) => m[1]))].slice(0, LIMIT);
  log(`Stagecoach: ${schools.length} school pages`);
  const seenTerritory = new Set(); const rows = [];
  for (const url of schools) {
    const page = await get(url); if (page.status !== 200) { note(SRC, `http_${page.status}`); continue; }
    const tid = (page.text.match(/id="territory-landing-wrapper"[^>]*data-territory-id="(\d+)"/) || page.text.match(/data-territory-id="(\d+)"/) || [])[1];
    if (!tid) { note(SRC, 'no_territory_id'); continue; }
    if (seenTerritory.has(tid)) continue; seenTerritory.add(tid);
    const api = await get(`https://www.stagecoach.co.uk/api/stagesearch/${tid}`);
    let j; try { j = JSON.parse(api.text); } catch { note(SRC, 'api_not_json'); continue; }
    for (const st of j.Stages || []) {
      const label = clean(st.DisplayName);
      if (!/\b(mini|early)\s+stages\b/i.test(label)) continue;
      const am = clean(st.Description).match(/(\d+)\s*-\s*(\d+)/);
      const ages = am ? [+am[1] * 12, +am[2] * 12] : /mini/i.test(label) ? [24, 48] : [48, 72];
      if (ages[0] > 48) continue;
      for (const v of st.Venues || []) {
        const pc = normPc(v.PostCode); if (!pc) { note(SRC, 'no_postcode'); continue; }
        const schoolsHere = (v.Schools || []).filter((s) => !s.IsAdultClass);
        if (!schoolsHere.length) continue;
        const fee = schoolsHere.map((s) => s.SingleFeeCultured).find((f) => f && f !== '£0.00');
        const local = clean(v.Territory?.LocalPageUrl) || new URL(url).pathname.replace(/\//g, '');
        rows.push({
          name: `Stagecoach ${label}`, provider: `Stagecoach ${clean(v.Territory?.Name) || titleCase(local)}`, category: 'movement', venue: clean(v.Name),
          address: [clean(v.Name), clean(v.AddressLine1).replace(/^\(.*\)$/, ''), clean(v.AddressLine2), clean(v.Town), clean(v.County), pc].filter(Boolean).filter((p, i, a) => a.indexOf(p) === i).join(', '),
          postcode: pc, sessions: schoolsHere.map((s) => { const r = parseRange(s.StartEndTime); return { day: dayAbbr(s.Day), start: r?.start, end: r?.end }; }),
          age_min_months: ages[0], age_max_months: ages[1], price: fee ? `${fee} per term` : '', booking: 'term',
          schedule_note: schoolsHere[0]?.TermDate?.Season ? `${clean(schoolsHere[0].TermDate.Season)} term: ${clean(schoolsHere[0].TermDate.TermDates)}.` : '',
          description: 'Weekly performing arts sessions mixing drama, dance and singing for young children.',
          url: `https://www.stagecoach.co.uk/${local}`, phone: clean(v.Tel), source: SRC, confidence: 'high',
        });
      }
    }
    note(SRC, 'territories');
  }
  groupAdd(rows);
}

// ---------------- Cylch Ti a Fi (Mudiad Meithrin) ----------------
const welshTitle = (s) => clean(s).toLowerCase().replace(/(^|[\s\-(/'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Yr|Y|A|Ac|Ar|Yn|Of|And|The)\b/g, (w, _, i) => (i === 0 ? w : w.toLowerCase()));
async function crawlMeithrin() {
  const SRC = 'meithrin.cymru';
  const r = await get('https://meithrin.cymru/wp-json/cylch-api/v1/get?get_all=true&types=9150');
  let list = []; try { list = JSON.parse(r.text); } catch { skip(SRC, 'cylch API not JSON'); return; }
  log(`Cylch Ti a Fi: ${list.length} groups`);
  for (const g of list.slice(0, LIMIT)) {
    const a = g.acf || {};
    const parts = [a.address_one, a.address_two, a.address_town, a.address_three].map(clean).filter(Boolean);
    const pc = normPc(parts.join(' ')); if (!pc) { note(SRC, 'no_postcode'); continue; }
    const venue = welshTitle(a.address_one || a.address_town || '');
    const place = welshTitle(clean(decode(g.post_title)).replace(/\(\s*ti a fi\s*\)/i, '').trim());
    add({
      name: 'Cylch Ti a Fi', provider: `Cylch Ti a Fi ${place}`, category: 'stayplay', venue,
      address: [...parts.slice(0, -1).map(welshTitle), pc].filter((p, i, arr) => p && arr.indexOf(p) === i).join(', ').replace(/\s*,\s*,/g, ','), postcode: pc,
      sessions: [], schedule_note: 'Meeting days and times are available from the group through the Mudiad Meithrin listing.',
      age_min_months: 0, age_max_months: 48, booking: 'drop-in',
      description: 'Welsh-language parent and toddler groups with play, songs and stories, open to all families.',
      url: decode(g.permalink) || 'https://meithrin.cymru/cylch-search-listing/?cylch-type=cylch-ti-a-fi', source: SRC, confidence: 'medium',
    });
    note(SRC, 'groups');
  }
}

// ---------------- geocoding (postcodes.io bulk) ----------------
async function geocode() {
  const pcs = [...new Set(items.map((i) => i.postcode).filter(Boolean))];
  const geo = new Map();
  for (let i = 0; i < pcs.length; i += 100) {
    const batch = pcs.slice(i, i + 100);
    const r = await rawFetch('https://api.postcodes.io/postcodes', { method: 'POST', body: JSON.stringify({ postcodes: batch }), headers: { 'Content-Type': 'application/json' } });
    let j; try { j = JSON.parse(r.text); } catch { log('postcodes.io error', r.status); continue; }
    for (const x of j.result || []) if (x.result) geo.set(normPc(x.query), { lat: x.result.latitude, lng: x.result.longitude, country: x.result.country });
  }
  const kept = []; const dropped = {};
  for (const it of items) {
    const g = geo.get(it.postcode);
    if (!g || g.lat == null) { dropped[it.source] = (dropped[it.source] || 0) + 1; continue; }
    kept.push({ ...it, lat: +g.lat.toFixed(6), lng: +g.lng.toFixed(6), _country: g.country });
  }
  return { kept, dropped };
}

// ---------------- main ----------------
const SOURCES = { littlekickers: crawlLittleKickers, rugbytots: crawlRugbytots, socatots: crawlSocatots, miniprofessors: crawlMiniProfessors, hartbeeps: crawlHartbeeps, wltdo: crawlWLTDO, stagecoach: crawlStagecoach, meithrin: crawlMeithrin };
for (const [k, fn] of Object.entries(SOURCES)) {
  if (ONLY && !ONLY.has(k)) continue;
  try { await fn(); } catch (e) { log(`${k} failed: ${e.stack || e}`); skip(k, `crawler error: ${e.message}`); }
  log(`${k}: ${items.length} items so far`);
}
const { kept, dropped } = await geocode();
const byCountry = {}; const bySource = {}; const tiers = {};
for (const it of kept) { byCountry[it._country] = (byCountry[it._country] || 0) + 1; bySource[`${it.source} | ${it.name}`] = (bySource[`${it.source} | ${it.name}`] || 0) + 1; tiers[it.tier] = (tiers[it.tier] || 0) + 1; delete it._country; }
kept.sort((a, b) => a.source.localeCompare(b.source) || a.provider.localeCompare(b.provider) || a.venue.localeCompare(b.venue) || a.name.localeCompare(b.name));
let prev = [];
if (ONLY && fs.existsSync(OUT)) { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).filter((i) => !kept.some((k) => k.source === i.source)); }
const final = [...prev, ...kept];
fs.writeFileSync(OUT, JSON.stringify(final, null, 1));
fs.writeFileSync(REPORT, JSON.stringify({ written: final.length, thisRun: kept.length, bySource, tiers, byCountry, droppedNoValidPostcode: dropped, counts, skipped: SKIPPED }, null, 1));
log(`wrote ${final.length} items -> ${OUT}`);
console.log(JSON.stringify({ thisRun: kept.length, bySource, tiers, byCountry, dropped, skipped: SKIPPED }, null, 1));
