// Little Days — UK soft play centres & play cafés for toddlers.
// Polite crawler: robots.txt checked per site (skips sites that disallow the page, block AI crawlers such as
// ClaudeBot/anthropic-ai/GPTBot, or carry Content-Signal ai-train=no); skips 401/403/challenge pages; <=1 req/s; disk cache.
// Usage: node softplay.mjs <cmd>   (see bottom of file)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const UA = 'LittleDaysBot/1.0 (family app; links back to venues)';
export const SCRATCH = '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/softplay/';
export const CACHE = SCRATCH + 'cache/';
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function throttle() { const w = last + 1100 - Date.now(); if (w > 0) await sleep(w); last = Date.now(); }
const key = (u) => crypto.createHash('sha1').update(u).digest('hex').slice(0, 16) + '_' + u.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);

export async function rawGet(url, opts = {}) {
  const f = path.join(CACHE, key(url + (opts.body || '')));
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  await throttle();
  let res;
  try {
    const r = await fetch(url, { method: opts.method || 'GET', body: opts.body, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml,*/*', ...(opts.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const ct = r.headers.get('content-type') || '';
    const text = /image|pdf|video|audio|octet/.test(ct) ? '' : (await r.text()).slice(0, 3_000_000);
    res = { status: r.status, url: r.url, ct, text, server: r.headers.get('server') || '', cfm: r.headers.get('cf-mitigated') || '' };
  } catch (e) { res = { status: 0, url, text: '', error: String(e).slice(0, 200) }; }
  if (res.status) fs.writeFileSync(f, JSON.stringify(res));
  return res;
}

// ---------------------------------------------------------------- robots
const AI_AGENTS = /^(claudebot|claude-web|claude-user|claude-searchbot|anthropic-ai|gptbot|chatgpt-user|oai-searchbot|ccbot|google-extended|perplexitybot|perplexity-user|bytespider|applebot-extended|meta-externalagent|cohere-ai|cohere-training-data-crawler|diffbot|omgili|ai2bot)$/;
const OUR_AI = /^(claudebot|claude-web|claude-user|claude-searchbot|anthropic-ai)$/;
function parseRobots(txt) {
  const groups = []; let cur = null; let lastUA = false; const signals = [];
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastUA = true; }
    else { lastUA = false; if (k === 'content-signal') signals.push(v.toLowerCase()); if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', p: v }); }
  }
  return { groups, signals };
}
const pathMatch = (p, rule) => new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')).test(p);
function allowedBy(rules, p) {
  let best = null;
  for (const r of rules) { if (r.p === '') continue; if (pathMatch(p, r.p) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r; }
  return !best || best.allow;
}
const robots = new Map();
export async function siteStatus(origin) {
  if (robots.has(origin)) return robots.get(origin);
  const r = await rawGet(origin + '/robots.txt');
  let st;
  if (r.status === 401 || r.status === 403 || r.cfm === 'challenge' || /just a moment|cf-chl|captcha/i.test(r.text.slice(0, 3000)) && r.status >= 400) st = { ok: false, why: `robots.txt HTTP ${r.status} (blocked)` };
  else if (r.status === 0) st = { ok: false, why: 'unreachable (' + (r.error || '') + ')' };
  else if (r.status >= 200 && r.status < 300 && !/<html|<!doctype/i.test(r.text.slice(0, 500))) {
    const { groups, signals } = parseRobots(r.text);
    const star = groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules);
    const mine = groups.filter((g) => g.agents.some((a) => a.startsWith('littledays'))).flatMap((g) => g.rules);
    const ai = groups.filter((g) => g.agents.some((a) => AI_AGENTS.test(a)));
    const aiFull = ai.filter((g) => !allowedBy(g.rules, '/') || g.rules.some((x) => !x.allow && (x.p === '/' || x.p === '/*')));
    if (signals.some((s) => /ai-train\s*=\s*no/.test(s))) st = { ok: false, why: 'robots.txt Content-Signal ai-train=no' };
    else if (aiFull.length) st = { ok: false, why: 'robots.txt blocks AI crawlers (' + [...new Set(aiFull.flatMap((g) => g.agents).filter((a) => AI_AGENTS.test(a)))].slice(0, 4).join(', ') + ')' };
    else if (!allowedBy(mine.length ? mine : star, '/') && !(mine.length ? mine : star).some((x) => x.allow)) st = { ok: false, why: 'robots.txt disallows all' };
    else st = { ok: true, rules: mine.length ? mine : star, aiRules: ai.filter((g) => g.agents.some((a) => OUR_AI.test(a))).flatMap((g) => g.rules) };
  } else st = { ok: true, rules: [], aiRules: [] }; // 404 etc: no robots
  robots.set(origin, st);
  return st;
}
const siteBlock = new Map();
export async function get(url) {
  const u = new URL(url);
  const st = await siteStatus(u.origin);
  if (!st.ok) return { status: -1, url, text: '', blocked: st.why };
  if (siteBlock.has(u.origin)) return { status: -1, url, text: '', blocked: siteBlock.get(u.origin) };
  const p = u.pathname + u.search;
  if (!allowedBy(st.rules, p) || !allowedBy(st.aiRules, p)) return { status: -1, url, text: '', blocked: 'robots.txt disallows ' + u.pathname };
  const r = await rawGet(url);
  if (r.status === 401 || r.status === 403 || r.status === 406 || r.status === 429 || r.cfm === 'challenge' || (r.status >= 400 && /just a moment|cf-chl|captcha|access denied/i.test(r.text.slice(0, 5000)))) {
    const why = `HTTP ${r.status}${r.cfm ? ' Cloudflare challenge' : ''}`; siteBlock.set(u.origin, why); return { ...r, blocked: why };
  }
  return r;
}

// ================================================================ extraction helpers
const log = (...a) => console.error(...a);
const ent = (s) => String(s || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&pound;/g, '£').replace(/&nbsp;/g, ' ').replace(/&rsquo;|&lsquo;/g, "'").replace(/&quot;/g, '"').replace(/&ndash;|&mdash;/g, '–').replace(/&eacute;/g, 'é').replace(/&[a-z]+;/g, ' ');
export const toText = (h) => ent(String(h || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' | ').replace(/<\/?(p|div|li|tr|td|th|h\d|section|article|footer|header|ul|ol|table|dt|dd)\b[^>]*>/gi, ' | ').replace(/<[^>]+>/g, ' '))
  .replace(/[\u200b\u00a0]/g, ' ').replace(/[ \t\r\n]+/g, ' ').replace(/\s*(\|\s*)+/g, ' | ');
const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,|:;–-]+|[\s,|:;–-]+$/g, '').trim();
const PC = /\b([A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?) ?(\d[ABD-HJLNP-UW-Z]{2})\b/g;
const normPC = (s) => { const m = String(s || '').toUpperCase().match(/\b([A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?) ?(\d[ABD-HJLNP-UW-Z]{2})\b/); return m ? `${m[1]} ${m[2]}` : ''; };
function jsonLd(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1].trim()); const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { out.push(x); if (x['@graph']) walk(x['@graph']); } }; walk(j); } catch {}
  }
  return out;
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYTOK = '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\\.?';
const dayIdx = (t) => DAYS.indexOf(t.slice(0, 3).replace(/^./, (c) => c.toUpperCase()));
const DAYEXPR = new RegExp(`(daily|every ?day|7 days(?: a week)?|seven days(?: a week)?|weekdays|weekends?|${DAYTOK}(?:\\s*(?:-|–|to|until|thru)\\s*${DAYTOK})?(?:\\s*(?:,|&|and|\\/)\\s*${DAYTOK}(?:\\s*(?:-|–|to)\\s*${DAYTOK})?)*)`, 'gi');
function expandDays(expr) {
  const e = expr.toLowerCase();
  if (/daily|every ?day|7 days|seven days/.test(e)) return [...DAYS];
  if (/weekdays/.test(e)) return DAYS.slice(0, 5);
  if (/weekend/.test(e)) return ['Sat', 'Sun'];
  const out = [];
  for (const part of e.split(/\s*(?:,|&|\band\b|\/)\s*/)) {
    const r = part.match(new RegExp(`(${DAYTOK})\\s*(?:-|–|to|until|thru)\\s*(${DAYTOK})`, 'i'));
    if (r) { let a = dayIdx(r[1]), b = dayIdx(r[2]); if (a < 0 || b < 0) continue; for (let i = a; ; i = (i + 1) % 7) { out.push(DAYS[i]); if (i === b || out.length > 7) break; } }
    else { const d = dayIdx(part.trim()); if (d >= 0) out.push(DAYS[d]); }
  }
  return [...new Set(out)];
}
const TIME = '(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?|noon|midday)';
const TRANGE = new RegExp(`${TIME}\\s*(?:-|–|—|to|until|till)\\s*${TIME}`, 'gi');
function toHM(s, ref) { // ref: 'am'|'pm' inherited
  s = s.toLowerCase().replace(/\./g, (m, i, str) => (/\d\.\d/.test(str.slice(i - 1, i + 2)) ? ':' : '')).trim();
  if (/noon|midday/.test(s)) return { h: 12, m: 0, ap: 'pm' };
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/); if (!m) return null;
  return { h: +m[1], m: +(m[2] || 0), ap: m[3] || null, colon: !!m[2] };
}
function timeRange(a, b) {
  const A = toHM(a), B = toHM(b); if (!A || !B) return null;
  if (A.h > 23 || B.h > 23 || A.m > 59 || B.m > 59) return null;
  if (!A.ap && !B.ap && !(A.colon && B.colon)) return null; // bare numbers are too ambiguous
  const conv = (T, ap) => { let h = T.h; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h * 60 + T.m; };
  let bm = conv(B, B.ap); let am;
  if (A.ap) am = conv(A, A.ap); else if (B.ap) { am = conv(A, B.ap); if (am > bm) am = conv(A, 'am'); } else am = conv(A, null);
  if (!B.ap && !A.ap && bm < am && B.h < 12) bm += 720;
  if (!(bm > am) || am < 6 * 60 || bm > 23 * 60 + 59 || bm - am > 15 * 60 || bm - am < 30) return null;
  const f = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  return [f(am), f(bm)];
}
// pairs (days, range) in a snippet: day expression followed (within 45 chars) by a time range
function dayTimePairs(snip) {
  const s = snip.replace(/[–—]/g, '-');
  const out = [];
  const dayMatches = [...s.matchAll(DAYEXPR)].filter((m) => m[0].trim().length > 2);
  for (const tm of s.matchAll(TRANGE)) {
    const tr = timeRange(tm[1], tm[2]); if (!tr) continue;
    const before = dayMatches.filter((d) => d.index + d[0].length <= tm.index && tm.index - (d.index + d[0].length) <= 45);
    const after = dayMatches.filter((d) => d.index >= tm.index + tm[0].length && d.index - (tm.index + tm[0].length) <= 12);
    const dm = before.length ? before[before.length - 1] : after[0];
    if (!dm) continue;
    const between = before.length ? s.slice(dm.index + dm[0].length, tm.index) : s.slice(tm.index + tm[0].length, dm.index);
    if (/closed|£|\d{3,}/i.test(between)) continue;
    const days = expandDays(dm[0]); if (!days.length) continue;
    out.push({ days, start: tr[0], end: tr[1], at: tm.index, text: s.slice(Math.max(0, dm.index - 10), tm.index + tm[0].length + 10) });
  }
  return out;
}
function groupHours(map) { // {Mon:'09:00–17:00'}
  const out = []; let i = 0; const keys = DAYS.filter((d) => map[d]);
  if (keys.length === 7 && new Set(keys.map((d) => map[d])).size === 1) return 'Daily ' + map.Mon;
  while (i < DAYS.length) { if (!map[DAYS[i]]) { i++; continue; } let j = i; while (j + 1 < 7 && map[DAYS[j + 1]] === map[DAYS[i]]) j++; out.push(`${DAYS[i]}${j > i ? '–' + DAYS[j] : ''} ${map[DAYS[i]]}`); i = j + 1; }
  return out.join(', ');
}
function hoursFromLd(objs) {
  const map = {};
  for (const o of objs) {
    for (const s of [].concat(o.openingHours || [])) { if (typeof s !== 'string') continue; const m = s.match(/^([A-Za-z ,\-–]+?)\s+(\d\d:\d\d)\s*-\s*(\d\d:\d\d)/); if (!m) continue; for (const d of expandDays(m[1].replace(/\bmo\b/i, 'mon').replace(/\btu\b/i, 'tue').replace(/\bwe\b/i, 'wed').replace(/\bth\b/i, 'thu').replace(/\bfr\b/i, 'fri').replace(/\bsa\b/i, 'sat').replace(/\bsu\b/i, 'sun'))) map[d] = `${m[2]}–${m[3]}`; }
    for (const sp of [].concat(o.openingHoursSpecification || [])) { if (!sp || !sp.opens || !sp.closes || sp.validFrom) continue; for (const d of [].concat(sp.dayOfWeek || [])) { const i = dayIdx(String(d).replace(/.*\//, '')); if (i >= 0 && sp.opens.slice(0, 5) !== sp.closes.slice(0, 5)) map[DAYS[i]] = `${sp.opens.slice(0, 5)}–${sp.closes.slice(0, 5)}`; } }
  }
  return Object.keys(map).length >= 2 ? groupHours(map) : '';
}
function hoursFromText(t) {
  const idxs = [...t.matchAll(/opening (?:times|hours)|open(?:ing)? hours|we(?:'| a)re open|we are open|open (?:daily|7 days|seven days|every day)|soft play (?:is )?open|hours of play/gi)].map((m) => m.index);
  for (const i of idxs) {
    const snip = t.slice(i, i + 420);
    if (/part(y|ies)|swim|gym\b|pool|caf[eé] (opening|hours)|term dates|bank holiday hours/i.test(snip.slice(0, 40))) continue;
    const pairs = dayTimePairs(snip).filter((p) => !/toddler|tots|sen\b|send|autism|quiet|adult/i.test(snip.slice(Math.max(0, p.at - 60), p.at)));
    if (!pairs.length) continue;
    const map = {}; for (const p of pairs) for (const d of p.days) if (!map[d]) map[d] = `${p.start}–${p.end}`;
    return groupHours(map);
  }
  return '';
}
const TODDLER_TRIG = /(toddler|tots?\b|tiny|little ones|under[ -]?(?:5|4|3|five|four|three)s?\b|pre-?school(?:ers?)?|baby (?:&|and) toddler|mini ?(?:monkeys|explorers)|bumps? (?:&|and) babies|parent (?:&|and) (?:toddler|baby))[^|]{0,40}?(session|time|club|morning|play|hour|only|mornings)/gi;
function toddlerSessions(t) {
  const found = [];
  for (const m of t.matchAll(TODDLER_TRIG)) {
    const head = t.slice(Math.max(0, m.index - 30), m.index + m[0].length);
    if (/\bsen\b|send\b|autis|sensory friendly|quiet|part(y|ies)|adult|swim|gymnast|class|lesson|toddler area|toddler zone/i.test(head)) continue;
    const snip = t.slice(m.index, m.index + 260);
    for (const p of dayTimePairs(snip)) { if (p.at > 200) continue; found.push({ ...p, trigger: m[0], snippet: clean(t.slice(Math.max(0, m.index - 40), m.index + 260)) }); }
  }
  const sessions = []; const seen = new Set(); let snippet = '';
  for (const f of found) for (const d of f.days) { const k = d + f.start + f.end; if (seen.has(k)) continue; seen.add(k); sessions.push({ day: d, start: f.start, end: f.end }); snippet = snippet || f.snippet; }
  sessions.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start.localeCompare(b.start));
  return { sessions: sessions.length > 14 ? [] : sessions, snippet };
}
function priceFrom(t) {
  const vals = [];
  for (const m of t.matchAll(/£\s?(\d{1,2}(?:\.\d{2})?)/g)) {
    const v = +m[1]; if (v < 1 || v > 25) continue;
    const w = t.slice(Math.max(0, m.index - 90), m.index + 30).toLowerCase();
    if (/part(y|ies)|per head|deposit|voucher|gift|membership|month|annual|hire|cake|coffee|meal|menu|sandwich|parking|spend|off\b|save|discount|adults? only|sock/.test(w)) continue;
    if (!/under|over|toddler|child|kid|walker|crawler|baby|babies|entry|admission|play|session|years|yrs|months|tot|junior|price/.test(w)) continue;
    vals.push(v);
  }
  if (!vals.length) return '';
  const mn = Math.min(...vals); return `From £${mn % 1 ? mn.toFixed(2) : mn}`;
}
function ages(t) {
  const l = t.toLowerCase(); let max = null; let min = 0;
  const cand = [];
  for (const m of l.matchAll(/(?:aged?|ages|children|kids|for|suitable for|designed for)?\s*(\d{1,2})\s*(months?|m|yrs?|years?)?\s*(?:-|–|to)\s*(\d{1,2})\s*(?:yrs?|years?|year olds?)/g)) { const a = +m[1], b = +m[3]; if (b > a && b <= 16) cand.push([m[2] && /^m/.test(m[2]) ? a : a * 12, b * 12]); }
  for (const m of l.matchAll(/up to (?:the age of |age )?(\d{1,2})\s*(?:yrs?|years?|year olds?)?/g)) { const b = +m[1]; if (b >= 2 && b <= 16) cand.push([0, b * 12]); }
  for (const m of l.matchAll(/under[ -]?(\d{1,2})s?\b(?:'s)?(?! ?(?:months|m\b|cm|kg))/g)) { const b = +m[1]; if (b >= 3 && b <= 14) cand.push([0, b * 12]); }
  if (cand.length) { max = Math.max(...cand.map((c) => c[1])); min = Math.min(...cand.map((c) => c[0])); }
  return { min: Math.min(min, 12), max: max ?? null };
}
const TODDLER_AREA = /(toddler|baby|babies|under[ -]?(?:2|3|4|5)s?'?|little ones'?|pre-?school|tots?|crawlers?|infant|mini)[ -](?:area|zone|section|play ?area|room|corner|space|frame|structure|village)|toddler[- ]only|dedicated (?:baby|toddler)|separate (?:baby|toddler)/i;
function booking(t) {
  const book = /(pre-?book(?:ing)? (?:is )?(?:essential|required)|booking (?:is )?(?:essential|required)|must (?:be )?(?:pre-?)?book|advance booking (?:is )?(?:essential|required)|book online (?:is )?(?:essential|required))/i.test(t);
  const walk = /walk[- ]?ins?|drop[- ]in|no need to book|pay on the day|pay on arrival|turn up and play|just turn up/i.test(t);
  return book && !walk ? 'book' : walk ? 'drop-in' : /book (?:online|now|your|a session)|booking/i.test(t) ? 'book' : 'drop-in';
}
function phoneFrom(html, t) {
  const tel = (String(html).match(/href="tel:([^"]+)"/i) || [])[1];
  const raw = tel ? decodeURIComponent(tel) : (t.match(/(?:tel|call|phone)[^0-9+]{0,12}((?:\+44\s?|0)\d[\d\s]{8,12}\d)/i) || [])[1];
  const d = String(raw || '').replace(/[^\d+]/g, ''); return /^(\+44|0)\d{9,10}$/.test(d) ? raw.trim().replace(/\s+/g, ' ') : '';
}
// postcode + address from text: skip registered-office/company lines
function addressFromText(t, hint) {
  const hits = [];
  for (const m of t.matchAll(PC)) {
    const pc = `${m[1]} ${m[2]}`; const w = t.slice(Math.max(0, m.index - 160), m.index).toLowerCase();
    if (/^(GU15 3YL|BN8 6AG|SE18 6SX|WC1X 8QR)$/.test(pc)) continue; // operator head offices
    if (/regist|company|ltd\.? ?(?:\||,)? ?(?:reg|no)|vat|office address|head office|charity/.test(w.slice(-110))) continue;
    hits.push({ pc, i: m.index, w: t.slice(Math.max(0, m.index - 140), m.index) });
  }
  if (!hits.length) return null;
  let pick = hint ? hits.find((h) => h.pc === normPC(hint)) : null;
  const counts = {}; hits.forEach((h) => (counts[h.pc] = (counts[h.pc] || 0) + 1));
  const distinct = Object.keys(counts);
  if (!pick) { if (distinct.length > 3 && !hint) return { multi: distinct }; pick = hits.sort((a, b) => counts[b.pc] - counts[a.pc] || a.i - b.i)[0]; }
  let segs = pick.w.split(/\s*\|\s*/).map(clean).filter(Boolean);
  const keep = [];
  for (let k = segs.length - 1; k >= 0 && keep.length < 4; k--) {
    let sg = segs[k].replace(/^(address|find us|location|visit us|where to find us|contact( us)?|get in touch)\s*:?\s*/i, '');
    if (!sg || sg.length > 90 || /[.!?]\s|@|www\.|tel\b|phone|email|open|£|\d{4,}|©|copyright|cookie/i.test(sg)) break;
    keep.unshift(sg);
    if (keep.join(', ').length > 70) break;
  }
  let addr = keep.join(', ');
  // text like "Unit 3, Foo Park, Town" before postcode in the same segment
  if (!addr) { const seg = pick.w.split(/[.!?|]\s/).pop(); addr = clean(seg).slice(-90); }
  return { postcode: pick.pc, address: clean(addr.replace(/,\s*,/g, ',')) };
}
function siteName(html, t) {
  const lds = jsonLd(html); const lb = lds.find((o) => o.address && o.name);
  const og = (String(html).match(/property="og:site_name"\s+content="([^"]+)"/i) || String(html).match(/content="([^"]+)"\s+property="og:site_name"/i) || [])[1];
  const title = (String(html).match(/<title[^>]*>([^<]+)/i) || [])[1];
  return { ld: lb ? ent(lb.name) : '', og: og ? ent(og) : '', title: title ? ent(title).trim() : '' };
}
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };

// ================================================================ page gathering
async function page(url) {
  const r = await get(url);
  if (r.blocked) return { blocked: r.blocked, url };
  if (r.status !== 200 || !/html|xml|text/i.test(r.ct || 'text/html')) return { err: r.status, url };
  if (/permanently closed|has now closed|we have (?:now )?closed (?:our doors|permanently)|closed for good|sadly clos/i.test(toText(r.text).slice(0, 20000))) return { closed: true, url: r.url, html: r.text, text: toText(r.text) };
  return { url: r.url, html: r.text, text: toText(r.text) };
}
const SUB_KW = /contact|find[-_]?us|opening|times|hours|visit|price|pricing|prices|admission|toddler|tots|under[-_]?5|baby|pre-?school|info|faq|about|location|soft[-_]?play|whats[-_]?on|what-s-on|sessions|timetable/i;
function subLinks(p, scope, max = 3) {
  const base = new URL(p.url); const seen = new Set([p.url.replace(/\/$/, '')]);
  const links = [];
  for (const m of p.html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(ent(m[1]), base); } catch { continue; }
    if (u.host !== base.host || /\.(pdf|jpe?g|png|gif|svg|webp|docx?|xml|ics)$/i.test(u.pathname) || /wp-|feed|login|account|basket|cart|checkout|privacy|cookie|terms|career|jobs|blog|news|party|parties|gift|voucher|franchise|press/i.test(u.pathname)) continue;
    const href = (u.origin + u.pathname).replace(/\/$/, '');
    if (seen.has(href)) continue;
    const label = toText(m[2]).toLowerCase();
    if (!SUB_KW.test(u.pathname) && !SUB_KW.test(label)) continue;
    if (scope && !href.startsWith(scope) && !/faq|opening|price|toddler|tots|contact/i.test(u.pathname)) continue;
    seen.add(href);
    let score = 0; if (/toddler|tots|under-?5|pre-?school|baby/i.test(href + label)) score += 5; if (/opening|times|hours/i.test(href + label)) score += 4; if (/price|admission/i.test(href + label)) score += 3; if (/contact|find/i.test(href + label)) score += 2; if (scope && href.startsWith(scope)) score += 2;
    links.push({ href: u.origin + u.pathname, score });
  }
  return links.sort((a, b) => b.score - a.score).slice(0, max).map((l) => l.href);
}

// ================================================================ seeds
const COVERED = /wacky warehouse|little street|rugrats|halfpints|kidspace|gambado|clambers|tumble tots|gymboree|little gym/i;
const NOT_SOFTPLAY = /trampoline|ninja|laser|flip ?out|jump ?(?:space|zone|in\b|360)|air ?(?:park|haus|nation)|bounce|freerun|gymnastic|bowl|inflata|climb|go ?kart|escape|golf|skate|museum|library|nursery|children'?s centre|toy library|swimming pool|stemex|legends/i;
const CHAINS = [
  { provider: '360 Play', urls: ['basildon', 'farnborough', 'leicester', 'milton-keynes', 'redditch', 'rushden-lakes', 'stevenage'].map((s) => `https://360play.co.uk/360-play-${s}/`) },
  { provider: 'Monkey Bizness', urls: ['lewes', 'sheffield', 'hull', 'gosport', 'southampton', 'rochford', 'braintree'].map((s) => `https://www.monkey-bizness.co.uk/${s}/`) },
  { provider: 'Wonder World', urls: ['glasgow', 'east-kilbride', 'falkirk', 'kirkcaldy', 'edinburgh', 'perth', 'southampton'].map((s) => `https://www.wonderworldsoftplay.co.uk/${s}`) },
  { provider: 'Partyman World of Play', urls: ['location/cambridge/', 'location/ipswich/', 'lakeside/', 'location/oxford-3/', 'location/upminster/', 'location/wembley-2/'].map((s) => `https://partymanworld.co.uk/${s}`) },
  { provider: 'Pirates Landing', urls: ['camberley', 'wokingham', 'farnham', 'highwycombe'].map((s) => `https://pirateslanding.co.uk/pirates-landing-${s}/`) },
  { provider: 'Snakes and Ladders', urls: ['abingdon', 'brentford', 'dunstable'].map((s) => `https://www.snakes-and-ladders.co.uk/our-locations/${s}/`) },
  { provider: 'Kosmic Kingdom', urls: ['hartlepool', 'bishop-auckland'].map((s) => `https://www.kosmickingdom.co.uk/${s}/`) },
  { provider: "Cookie's Island", urls: ['https://cookiesisland.com/beckton/home', 'https://cookiesisland.com/ilford/home'] },
  { provider: 'Safari Play', urls: ['milton-keynes', 'peterborough'].map((s) => `https://www.safariplay.co.uk/${s}/`) },
  { provider: 'Monster Kidz', urls: ['bramley', 'beeston'].map((s) => `https://monsterkidz.co.uk/monster-kidz-${s}/`) },
  { provider: "Frankie & Lola's", urls: ['inverness', 'liverpool', 'burnley', 'walsall'].map((s) => `https://frankieandlolas.co.uk/venue/${s}`) },
  { provider: 'Funky Monkeys', urls: ['cityside-belfast', 'dundonald', 'newport-spytty-wales', 'west-bromwich'].map((s) => `https://funkymonkeys.co/centre-locator/${s}/`) },
];
const CHAIN_HOSTS = new Set(CHAINS.flatMap((c) => c.urls.map(hostOf)));
function osmSeeds() {
  const els = [];
  for (const f of ['osm.json', 'osm2.json']) { try { els.push(...JSON.parse(fs.readFileSync(SCRATCH + f, 'utf8')).elements); } catch {} }
  const seen = new Set(); const out = []; const stats = { total: 0, noSite: 0, covered: 0, notSoftplay: 0, social: 0, chain: 0, ireland: 0 };
  for (const e of els) {
    const t = e.tags || {}; const key = e.type + e.id; if (seen.has(key)) continue; seen.add(key); stats.total++;
    const nm = t.name || '';
    if (COVERED.test(nm + ' ' + (t.brand || ''))) { stats.covered++; continue; }
    if (NOT_SOFTPLAY.test(nm) && !/soft ?play/i.test(nm)) { stats.notSoftplay++; continue; }
    let site = t.website || t['contact:website'] || t.url || '';
    if (!site) { stats.noSite++; continue; }
    if (!/^https?:/i.test(site)) site = 'https://' + site;
    let u; try { u = new URL(site); } catch { stats.noSite++; continue; }
    if (/facebook|instagram|familiesonline|dayoutwiththekids|happity|yell\.com|google|tripadvisor|linktr|zzz\.site|events\.|wixsite|queenstreet/i.test(u.host)) { stats.social++; continue; }
    if (/\.ie$/.test(u.host) || /^[A-Z]\d{2} ?[A-Z\d]{4}$/i.test(t['addr:postcode'] || '')) { stats.ireland++; continue; }
    if (CHAIN_HOSTS.has(u.host.replace(/^www\./, '')) || /everyoneactive|better\.org|freedom-leisure|placesleisure|dobbies|inflatanation|flipout|ninjawarrior/i.test(u.host)) { stats.chain++; continue; }
    out.push({ url: u.href, osmName: nm, hint: t['addr:postcode'] || '' });
  }
  const byUrl = new Map(); for (const s of out) { const k = s.url.replace(/\/$/, '').replace('http://', 'https://').replace('://www.', '://'); if (!byUrl.has(k)) byUrl.set(k, s); }
  return { seeds: [...byUrl.values()], stats };
}

// ================================================================ venue builders
const report = { perSource: {}, skippedSites: {}, dropped: [], closed: [] };
const skip = (host, why) => { report.skippedSites[host] = why; };
const DEBUG = [];
function describe({ kind, toddlerArea, hasSessions, cafe, centre }) {
  if (kind === 'leisure') return `Soft play area at ${centre}${toddlerArea ? ', with a space set aside for babies and toddlers' : ''}${hasSessions ? ' and dedicated toddler sessions' : ''}.`;
  if (cafe) return `Play café with ${toddlerArea ? 'a separate baby and toddler play space' : 'indoor play for young children'}${hasSessions ? ' and toddler sessions' : ''}.`;
  return `Indoor soft play centre${toddlerArea ? ' with a separate toddler area' : ''}${hasSessions ? (toddlerArea ? ' and toddler-only sessions' : ' with toddler-only sessions') : ''}.`;
}
function row(o) {
  const sessions = o.sessions || [];
  return {
    name: o.name, provider: o.provider, category: 'softplay', venue: o.venue, address: clean(o.address), postcode: normPC(o.postcode), lat: 0, lng: 0,
    sessions, tier: sessions.length ? 'timetable' : 'place', schedule_note: clean(o.schedule_note).slice(0, 180),
    age_min_months: o.age_min ?? 0, age_max_months: o.age_max ?? 60, price: o.price || '', free: false, booking: o.booking || 'drop-in', indoor: true,
    description: o.description, url: o.url, phone: o.phone || '', source: o.source, confidence: o.confidence || 'medium',
  };
}
function common(texts, htmls) {
  const t = texts.join(' | ');
  const lds = htmls.flatMap(jsonLd);
  const hours = hoursFromLd(lds.filter((o) => /play|child|entertain|local|amusement|business|cafe|restaurant|place/i.test(String(o['@type'])))) || texts.map(hoursFromText).find(Boolean) || '';
  const ts = toddlerSessions(t);
  const ag = ages(t);
  return { t, lds, hours, ts, ag, toddlerArea: TODDLER_AREA.test(t), price: priceFrom(t), booking: booking(t) };
}
function note(hours, toddlerArea, ts, extra = '') {
  const parts = [];
  if (hours) parts.push(hours);
  if (ts.sessions.length) parts.push('toddler sessions ' + [...new Set(ts.sessions.map((s) => s.day))].join('/') + ' (check term-time dates)');
  if (toddlerArea) parts.push('separate toddler/baby area');
  if (extra) parts.push(extra);
  return parts.join('; ');
}
async function generic(seed, provider, sourceName) {
  const p = await page(seed.url);
  if (p.blocked) { skip(hostOf(seed.url), p.blocked); return null; }
  if (p.err !== undefined) { report.dropped.push(`${seed.url} HTTP ${p.err}`); return null; }
  if (p.closed) { report.closed.push(p.url); return null; }
  const scope = new URL(p.url).pathname.length > 2 ? (new URL(p.url).origin + new URL(p.url).pathname).replace(/\/(home)?\/?$/, '') : '';
  const subs = [];
  for (const l of subLinks(p, scope, 3)) { const s = await page(l); if (s.html && !s.closed) subs.push(s); }
  const texts = [p.text, ...subs.map((s) => s.text)]; const htmls = [p.html, ...subs.map((s) => s.html)];
  const c = common(texts, htmls);
  if (!/soft[ -]?play|play ?caf[eé]|play centre|play center|playcentre|indoor play|play barn|playbarn|role[ -]?play|play village|play ?zone|adventure play|play area|play frame|play structure/i.test(c.t)) { report.dropped.push(`${seed.url} not soft play`); return null; }
  if (!provider && !/toddler|baby|babies|under[ -]?(?:5|4|3|2|1|five|four)s?|pre-?school|little ones|crawl|\b0\s*[-–]\s*\d|tots?\b|infant/i.test(c.t)) { report.dropped.push(`${seed.url} no toddler mention`); return null; }
  // address
  let addr = null; const lb = c.lds.find((o) => o.address && typeof o.address === 'object' && o.address.postalCode);
  if (lb && normPC(lb.address.postalCode)) addr = { postcode: normPC(lb.address.postalCode), address: [lb.address.streetAddress, lb.address.addressLocality].filter(Boolean).map(ent).join(', ') };
  if (seed.hint && (!addr || addr.postcode !== normPC(seed.hint))) { const a2 = addressFromText(texts.join(' | '), seed.hint); if (a2 && a2.postcode === normPC(seed.hint)) addr = a2; }
  if (!addr) for (const tx of texts) { const a = addressFromText(tx, seed.hint); if (a && a.postcode) { addr = a; break; } }
  if (!addr || !addr.postcode) { report.dropped.push(`${seed.url} no postcode on site`); return null; }
  const nm = siteName(p.html, p.text);
  const titleName = clean((nm.title.split(/\s[|–—-]\s|\s:\s/)[0] || ''));
  let venue = provider ? `${provider} ${clean(seed.label || '')}`.trim()
    : (seed.osmName && c.t.toLowerCase().includes(seed.osmName.toLowerCase().replace(/’/g, "'")) ? seed.osmName : nm.ld || (nm.og && nm.og.length < 40 ? nm.og : '') || (titleName.length <= 45 ? titleName : '') || seed.osmName);
  venue = clean(venue.replace(/\s*[-|–]\s*(home|welcome)$/i, '').replace(/^(home|welcome to)\s*[-|–:]?\s*/i, ''));
  if (!venue) venue = seed.osmName;
  const cafe = /play ?caf[eé]/i.test(venue + ' ' + c.t.slice(0, 3000));
  DEBUG.push({ url: seed.url, venue, hours: c.hours, sessions: c.ts.sessions, snippet: c.ts.snippet, addr, price: c.price, ages: c.ag, subs: subs.map((s) => s.url) });
  return row({
    name: venue, provider: provider || venue, venue, address: addr.address, postcode: addr.postcode,
    sessions: c.ts.sessions, schedule_note: note(c.hours, c.toddlerArea, c.ts, cafe && !/soft play/i.test(c.t) ? 'play café' : ''),
    age_min: c.ag.min, age_max: c.ag.max ?? 60, price: c.price, booking: c.booking,
    description: describe({ kind: 'venue', toddlerArea: c.toddlerArea, hasSessions: c.ts.sessions.length > 0, cafe }),
    url: p.url, phone: phoneFrom(p.html, texts.join(' ')), source: sourceName || hostOf(p.url), confidence: c.hours ? 'high' : 'medium',
  });
}

async function leisure(provider, source, softUrl, centreUrl, centreLabel) {
  const sp = await page(softUrl);
  if (sp.blocked) { skip(hostOf(softUrl), sp.blocked); return null; }
  if (!sp.html) { report.dropped.push(`${softUrl} ${sp.err || 'closed'}`); return null; }
  if (!/soft[ -]?play|play ?zone|playworld|toddlers? world|play area|monster zone/i.test(sp.text)) { report.dropped.push(`${softUrl} no soft play text`); return null; }
  const cp = centreUrl ? await page(centreUrl) : {};
  const c = common([sp.text], [sp.html]);
  let addr = null; const lds = [...jsonLd(sp.html), ...jsonLd(cp.html || '')]; const lb = lds.find((o) => o.address && o.address.postalCode);
  if (lb) addr = { postcode: normPC(lb.address.postalCode), address: [lb.address.streetAddress, lb.address.addressLocality].filter(Boolean).map(ent).join(', ') };
  if (!addr || !addr.postcode) addr = addressFromText(sp.text) || (cp.text ? addressFromText(cp.text) : null);
  if (!addr || !addr.postcode || addr.multi) { report.dropped.push(`${softUrl} no postcode`); return null; }
  let centre = centreLabel || (lb && ent(lb.name)) || '';
  if (!centre && cp.html) centre = clean(siteName(cp.html, cp.text).title.split(/\s[|–-]\s/)[0]);
  centre = clean(centre.replace(/^soft play( at)?\s*/i, ''));
  // soft play hours: only from the soft play page itself
  let hours = hoursFromText(sp.text);
  const m7 = sp.text.match(/open (?:7 days a week|seven days a week|daily|every day) (?:from )?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm))\s*(?:to|-|–|until)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm))/i);
  if (!hours && m7) { const tr = timeRange(m7[1], m7[2]); if (tr) hours = `Daily ${tr[0]}–${tr[1]}`; }
  const venue = `${provider === 'Better' ? 'Better' : provider} soft play – ${centre}`.replace(/ – $/, '');
  DEBUG.push({ url: softUrl, venue, hours, sessions: c.ts.sessions, snippet: c.ts.snippet, addr, price: c.price, ages: c.ag });
  return row({
    name: 'Soft Play', provider, venue: centre ? `${centre}` : venue, address: addr.address, postcode: addr.postcode,
    sessions: c.ts.sessions, schedule_note: note(hours || 'Soft play times vary; see centre page', c.toddlerArea, c.ts),
    age_min: c.ag.min, age_max: c.ag.max ?? 60, price: c.price, booking: c.booking,
    description: describe({ kind: 'leisure', centre: centre || 'a leisure centre', toddlerArea: c.toddlerArea, hasSessions: c.ts.sessions.length > 0 }),
    url: sp.url, phone: phoneFrom(sp.html, sp.text) || (lb && lb.telephone) || '', source, confidence: 'high',
  });
}
const readXml = async (u) => { const r = await get(u); return r.blocked ? (skip(hostOf(u), r.blocked), '') : r.text || ''; };
const locs = (x) => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => ent(m[1]));

async function better() {
  const sm = locs(await readXml('https://www.better.org.uk/sitemap/leisure-centres.xml'));
  const soft = sm.filter((u) => /\/(soft-?play[^/]*|toddlers-world|play-area|softplay-[^/]*)$/i.test(u));
  const byCentre = new Map(); for (const u of soft) { const c = u.replace(/\/[^/]+$/, ''); if (!byCentre.has(c) || /\/soft-play$/.test(u)) byCentre.set(c, u); }
  const rows = []; for (const [c, u] of byCentre) { const r = await leisure('Better', 'better.org.uk', u, c); if (r) rows.push(r); }
  return rows;
}
async function everyoneActive() {
  const sm = locs(await readXml('https://www.everyoneactive.com/centre-subpage-sitemap.xml'));
  const soft = sm.filter((u) => /soft-?play|playworld|play-?zone/i.test(u));
  const rows = []; for (const u of soft) { const c = u.replace(/[^/]+\/$/, ''); const r = await leisure('Everyone Active', 'everyoneactive.com', u, c); if (r) rows.push(r); }
  return rows;
}
async function freedom() {
  const sm = locs(await readXml('https://www.freedom-leisure.co.uk/google-sitemap.xml'));
  const soft = sm.filter((u) => /\/centres\/[^/]+\/[^/]*(soft-?play|playzone)[^/]*\/$/i.test(u) && !/latest-news|half-price|now-open|sen/i.test(u));
  const rows = []; for (const u of soft) { const c = u.replace(/[^/]+\/$/, ''); const r = await leisure('Freedom Leisure', 'freedom-leisure.co.uk', u, c); if (r) rows.push(r); }
  return rows;
}
async function places() {
  const sm = locs(await readXml('https://www.placesleisure.org/sitemap.xml'));
  const fam = sm.filter((u) => /\/centres\/[^/]+\/centre-activities\/family-kids\/$/.test(u));
  const rows = [];
  for (const u of fam) {
    const p = await page(u); if (!p.text) continue;
    const nonParty = [...p.text.matchAll(/soft[ -]?play/gi)].some((m) => !/part(y|ies)/i.test(p.text.slice(Math.max(0, m.index - 250), m.index + 80)));
    if (!nonParty) continue;
    const r = await leisure('Places Leisure', 'placesleisure.org', u, u.replace(/centre-activities\/family-kids\/$/, '')); if (r) rows.push(r);
  }
  return rows;
}

// ================================================================ geocode + main
async function geocode(rows) {
  const pcs = [...new Set(rows.map((r) => r.postcode).filter(Boolean))]; const res = {};
  for (let i = 0; i < pcs.length; i += 100) {
    const body = JSON.stringify({ postcodes: pcs.slice(i, i + 100) });
    const r = await rawGet('https://api.postcodes.io/postcodes', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    try { for (const x of JSON.parse(r.text).result) if (x.result) res[x.query] = x.result; } catch (e) { log('geocode error', r.status); }
  }
  return res;
}
async function main() {
  const out = [];
  const add = (src, rows) => { report.perSource[src] = (report.perSource[src] || 0) + rows.length; out.push(...rows); log(src, rows.length); };
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const want = (k) => !only || only.includes(k);
  if (want('better')) add('Better (GLL)', await better());
  if (want('ea')) add('Everyone Active', await everyoneActive());
  if (want('freedom')) add('Freedom Leisure', await freedom());
  if (want('places')) add('Places Leisure', await places());
  if (want('chains')) for (const ch of CHAINS) {
    const rows = [];
    for (const u of ch.urls) { const label = u.replace(/\/(home)?\/?$/, '').split('/').pop().replace(/^360-play-|^pirates-landing-|^monster-kidz-|-\d$/g, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); const r = await generic({ url: u, label }, ch.provider, hostOf(u)); if (r) rows.push(r); }
    add(ch.provider, rows);
  }
  if (want('osm')) {
    const { seeds, stats } = osmSeeds(); report.osm = { ...stats, seeds: seeds.length };
    const rows = []; let n = 0;
    for (const s of seeds) { n++; if (n % 20 === 0) log('independents', n, '/', seeds.length); const r = await generic(s, null, null); if (r) rows.push(r); }
    add('Independent venues (own sites)', rows);
  }
  // dedupe (postcode + similar name, or same url), and against play.json
  const prior = JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../play.json'), 'utf8'));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const seenKeys = new Set(prior.map((r) => r.postcode + '|' + norm(r.venue).slice(0, 8)));
  const priorUrls = new Set(prior.map((r) => String(r.url).replace(/\/$/, '')));
  const final = []; const seenUrl = new Set();
  for (const r of out) {
    const k = r.postcode + '|' + norm(r.venue).slice(0, 8); const u = r.url.replace(/\/$/, '');
    if (seenKeys.has(k) || seenUrl.has(u) || priorUrls.has(u) || COVERED.test(r.venue)) { report.dropped.push(`dup ${r.venue} ${r.postcode}`); continue; }
    if (final.some((f) => f.postcode === r.postcode && f.provider === r.provider)) { report.dropped.push(`dup-pc ${r.venue} ${r.postcode}`); continue; }
    seenKeys.add(k); seenUrl.add(u); final.push(r);
  }
  const geo = await geocode(final);
  const valid = [];
  for (const r of final) { const g = geo[r.postcode]; if (!g) { report.dropped.push(`bad postcode ${r.postcode} ${r.venue}`); continue; } r.lat = g.latitude; r.lng = g.longitude; r._country = g.country; r._region = g.region || g.country; valid.push(r); }
  // manual overrides
  for (const r of valid) { const o = OVERRIDES[r.url]; if (o) Object.assign(r, o); if (r.sessions.length === 0) r.tier = 'place'; }
  const outRows = valid.filter((r) => !r._drop);
  fs.writeFileSync(SCRATCH + 'report.json', JSON.stringify({ ...report, spread: outRows.reduce((a, r) => ((a[r._region] = (a[r._region] || 0) + 1), a), {}) }, null, 1));
  fs.writeFileSync(SCRATCH + 'debug.json', JSON.stringify(DEBUG, null, 1));
  for (const r of outRows) { delete r._country; delete r._region; }
  const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../softplay.json');
  fs.writeFileSync(OUT, JSON.stringify(outRows, null, 1));
  log('wrote', outRows.length, 'rows ->', OUT);
}
// Per-URL corrections after manual review of extracted snippets (facts checked against the venue page).
const OVERRIDES = {};

const isMain = import.meta.url === 'file://' + process.argv[1];
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === 'fetch') { for (const u of process.argv.slice(3)) { const r = await get(u); console.log(r.status, r.blocked || '', r.url, (r.text || '').length); } }
  else if (cmd === 'robots') {
    for (const d of process.argv.slice(3)) { const origin = d.startsWith('http') ? new URL(d).origin : 'https://' + d; const st = await siteStatus(origin); console.log(origin, st.ok ? 'OK' : 'SKIP: ' + st.why); }
  } else if (cmd === 'build') await main();
  else console.log('usage: node softplay.mjs build [better,ea,freedom,places,chains,osm] | fetch <url> | robots <domain>');
}
