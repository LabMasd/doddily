// Shared pieces for the freshness checker: listing loader, robots.txt, polite per-host fetch, text hashing.
// Nothing here stores page content: callers keep only hashes, dates and HTTP validators.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const STATE_FILE = path.join(ROOT, 'data/freshness-state.json');
export const OUT_DIR = path.join(ROOT, 'scripts/freshness/out');
export const TERM_DATES = path.join(ROOT, 'data/uk-research/collected/freshness/term-dates-2026-27.json');
export const UA = 'LittleDaysBot/1.0 (Doddily listing freshness check, weekly; links back to providers; +https://labmasd.github.io/doddily/)';
export const GAP_MS = 1500; // minimum between two requests to one host
const MAX_BYTES = 5e6;
const TIMEOUT_MS = 30000;
// A group naming any of these applies to us. Claude's crawlers are included on purpose: the project
// treats a block on them (e.g. Bloom Baby Classes) as a block on Doddily.
const OUR_AGENTS = ['littledays', 'littledaysbot', 'claudebot', 'claude-user', 'anthropic-ai'];

// Never requested, whatever robots.txt says (project rules in CLAUDE.md, plus login-walled social sites).
export const EXCLUDED = [
  [/(^|\.)happity\.co\.uk$/, 'excluded: partner, not scraped'],
  [/bloom-?baby/i, 'excluded: blocks ClaudeBot'],
  [/(^|\.)(instagram|facebook|fb|tiktok|x|twitter)\.com$/, 'excluded: social site'],
];
export const excludedReason = (u) => { const h = hostOf(u); return EXCLUDED.find(([re]) => re.test(h))?.[1] || null; };
export const today = () => new Date().toISOString().slice(0, 10);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
export const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };
export const isOpenActive = (it) => /openactive/i.test(`${it.attribution || ''} ${it.source || ''}`) || it._file === 'uk-research/openactive.json';
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pcKey = (p) => String(p || '').replace(/\s+/g, '').toUpperCase();
export const listingId = (it) => slug(`${it.name}-${it.venue || it.provider}-${pcKey(it.postcode)}`) || slug(`${it.name}-${it.lat}`);

/** Every listing in data/research and data/uk-research, tagged with its file. Read-only. */
export function loadListings() {
  const out = [];
  for (const dir of ['data/research', 'data/uk-research']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((f) => f.endsWith('.json')).sort()) {
      let arr;
      try { arr = JSON.parse(fs.readFileSync(path.join(abs, f), 'utf8')); } catch (e) { console.error(`skip ${dir}/${f}: ${e.message}`); continue; }
      if (!Array.isArray(arr)) continue;
      arr.forEach((it, i) => { if (it && typeof it === 'object') out.push({ ...it, _file: `${dir.replace('data/', '')}/${f}`, _i: i }); });
    }
  }
  return out;
}

export function readState(file = STATE_FILE) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: 1, ...s, urls: s.urls || {} };
  } catch { return { version: 1, urls: {} }; }
}

/** One url per line so git diffs stay readable. Hashes, dates, status codes and validators only. */
export function writeState(state, file = STATE_FILE) {
  const keys = Object.keys(state.urls).sort();
  const lines = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(state.urls[k])}`);
  const head = { version: 1, updated: state.updated, ua: UA, note: 'Doddily freshness state: hashes and dates only. Written by scripts/freshness/check.mjs; never edit listing data from here.' };
  const body = `{\n${Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n  "urls": {\n${lines.map((l) => '  ' + l).join(',\n')}\n  }\n}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', body);
  fs.renameSync(file + '.tmp', file);
}

// ---------- robots.txt (RFC 9309) ----------
function parseRobots(txt) {
  const groups = []; let cur = null; let inUA = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!inUA) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); } cur.agents.push(v.toLowerCase()); inUA = true; continue; }
    inUA = false; if (!cur) continue;
    if (k === 'allow' || k === 'disallow') cur.rules.push({ allow: k === 'allow', p: v });
    else if (k === 'crawl-delay' && !isNaN(parseFloat(v))) cur.delay = parseFloat(v);
  }
  const ours = groups.filter((g) => g.agents.some((a) => a !== '*' && OUR_AGENTS.some((x) => x === a || x.startsWith(a) && a.length >= 6)));
  const star = groups.filter((g) => g.agents.includes('*'));
  // Every rule set that names us must allow the path; '*' only applies when nothing names us.
  const sets = ours.length ? ours.map((g) => g.rules) : [star.flatMap((g) => g.rules)];
  const delays = (ours.length ? ours : star).map((g) => g.delay).filter((d) => d != null);
  return { sets, delay: delays.length ? Math.max(...delays) : null };
}
function ruleMatches(p, rule) {
  const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(p);
}
function allowedBy(rules, p) {
  let best = null;
  for (const r of rules) { if (!r.p) continue; if (ruleMatches(p, r.p) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r; }
  return !best || best.allow;
}

// ---------- polite fetching ----------
export class Fetcher {
  constructor({ log = () => {} } = {}) { this.robots = new Map(); this.last = new Map(); this.delay = new Map(); this.requests = 0; this.log = log; }

  async wait(host) {
    const gap = Math.max(GAP_MS, (this.delay.get(host) || 0) * 1000);
    const w = (this.last.get(host) || 0) + gap - Date.now();
    if (w > 0) await sleep(w);
    this.last.set(host, Date.now());
  }

  async raw(url, headers = {}) {
    const host = hostOf(url);
    await this.wait(host);
    this.requests++;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      return r;
    } catch (e) {
      const code = e?.cause?.code || e?.code || e?.name || 'error';
      return { status: 0, error: String(code), headers: new Headers() };
    }
  }

  /** Robots rules for an origin, fetched once per run. Unreachable (5xx/network) = treat as full disallow. */
  async robotsFor(origin) {
    if (this.robots.has(origin)) return this.robots.get(origin);
    let res;
    const r = await this.raw(origin + '/robots.txt');
    if (r.status >= 200 && r.status < 300) {
      const txt = (await r.text()).slice(0, 500000);
      res = /<html/i.test(txt.slice(0, 500)) ? { sets: [[]], delay: null } : parseRobots(txt);
    } else if (r.status >= 300 && r.status < 400) {
      // Follow one same-site redirect for robots.txt (http->https, www); otherwise no rules.
      const loc = r.headers.get('location');
      const to = loc ? new URL(loc, origin + '/robots.txt') : null;
      if (to && sameSite(to.host, new URL(origin).host)) {
        const r2 = await this.raw(to.href);
        res = r2.status >= 200 && r2.status < 300 ? parseRobots((await r2.text()).slice(0, 500000)) : r2.status >= 400 && r2.status < 500 ? { sets: [[]], delay: null } : { sets: [[{ allow: false, p: '/' }]], delay: null, unreachable: true };
      } else res = { sets: [[]], delay: null };
    } else if (r.status === 401 || r.status === 403) res = { sets: [[{ allow: false, p: '/' }]], delay: null }; // refuses us outright: treat as a block (stricter than RFC 9309, same as fetch-lib.mjs)
    else if (r.status >= 400 && r.status < 500) res = { sets: [[]], delay: null }; // no robots.txt = no rules (RFC 9309 2.3.1.3)
    else res = { sets: [[{ allow: false, p: '/' }]], delay: null, unreachable: true, error: r.error || `http ${r.status}` };
    if (res.delay) this.delay.set(new URL(origin).host, Math.min(res.delay, 60));
    this.robots.set(origin, res);
    return res;
  }

  async allowed(url) {
    const u = new URL(url);
    const rb = await this.robotsFor(u.origin);
    const p = u.pathname + u.search;
    return { ok: rb.sets.every((rules) => allowedBy(rules, p)), unreachable: !!rb.unreachable, error: rb.error };
  }
}

export const sameSite = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');
const trivialMove = (from, to) => {
  const f = new URL(from), t = new URL(to);
  return sameSite(f.host, t.host) && f.pathname.replace(/\/+$/, '') === t.pathname.replace(/\/+$/, '');
};

/**
 * Check one url. Returns { status, reason, etag, lastModified, text, times, to } where status is
 * ok | notmodified | blocked | dead | unreadable. Only hashes leave this function.
 */
export async function checkUrl(fx, url, prev = {}) {
  const ex = excludedReason(url);
  if (ex) return { status: 'blocked', reason: ex };
  let cur = url;
  for (let hop = 0; hop < 6; hop++) {
    let allow;
    try { allow = await fx.allowed(cur); } catch (e) { return { status: 'unreadable', reason: `robots: ${e.message}` }; }
    if (allow.unreachable) return { status: 'unreadable', reason: `robots.txt unreachable (${allow.error || 'error'})` };
    if (!allow.ok) return { status: 'blocked', reason: 'robots.txt', ...(cur !== url ? { to: cur } : {}) };
    const headers = {};
    if (cur === url && prev.e) headers['If-None-Match'] = prev.e;
    if (cur === url && prev.m) headers['If-Modified-Since'] = prev.m;
    const r = await fx.raw(cur, headers);
    if (r.status === 0) {
      const dns = /ENOTFOUND|EAI_AGAIN|ENOTFOUND/.test(r.error);
      return { status: dns ? 'dead' : 'unreadable', reason: dns ? 'dns' : r.error.toLowerCase() };
    }
    if (r.status === 304) return { status: 'notmodified' };
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get('location');
      if (!loc) return { status: 'unreadable', reason: `http ${r.status} without location` };
      const next = new URL(loc, cur).href;
      if (trivialMove(cur, next)) { cur = next; continue; } // http->https, www, trailing slash
      if (!sameSite(hostOf(url), hostOf(next))) return { status: 'dead', reason: `moved to another site (${r.status})`, to: next };
      if (r.status === 301 || r.status === 308) return { status: 'dead', reason: `moved (${r.status})`, to: next };
      cur = next; continue; // temporary same-site redirect: follow it
    }
    if ([401, 403, 429, 451].includes(r.status)) return { status: 'blocked', reason: `http ${r.status}`, rateLimited: r.status === 429 };
    if (r.status === 404 || r.status === 410) return { status: 'dead', reason: `http ${r.status}` };
    if (r.status >= 400) return { status: 'unreadable', reason: `http ${r.status}` };
    const type = (r.headers.get('content-type') || '').toLowerCase();
    const len = +(r.headers.get('content-length') || 0);
    if (len > (type.includes('pdf') ? 6 * MAX_BYTES : MAX_BYTES)) return { status: 'unreadable', reason: 'too large' };
    const etag = r.headers.get('etag') || undefined, lastModified = r.headers.get('last-modified') || undefined;
    if (type.includes('pdf')) {
      const buf = Buffer.from(await r.arrayBuffer());
      const h = 'pdf:' + hash(buf);
      return { status: 'ok', etag, lastModified, text: h, times: h, ...(cur !== url ? { to: cur } : {}) };
    }
    if (type && !/html|xml|text\/plain/.test(type)) return { status: 'unreadable', reason: `type ${type.split(';')[0]}` };
    const html = (await r.text()).slice(0, MAX_BYTES);
    const text = readableText(html);
    if (text.length < 200) return { status: 'unreadable', reason: 'no readable text (needs a browser)' };
    return { status: 'ok', etag, lastModified, text: hash(text), times: hash(scheduleSignature(text)), ...(cur !== url ? { to: cur } : {}) };
  }
  return { status: 'unreadable', reason: 'too many redirects' };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ndash: '-', mdash: '-', hellip: '...', pound: '£' };
export function readableText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|li|tr|td|th|h[1-6]|br|section|article|ul|ol|table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * The schedule-relevant tokens of a page, in page order: clock times, weekday names, dates and
 * words like "term", "cancelled", "closed". A page whose wording changes but whose times do not
 * stays "unchanged"; a page with no times at all has an empty signature (so only a page that
 * starts publishing times shows as changed).
 */
export function scheduleSignature(text) {
  const re = /\b(\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|\d{1,2}\/\d{1,2}\/\d{2,4}|half[- ]term|term[- ]time|cancelled|closed|no session|suspended)\b/gi;
  return (text.match(re) || []).map((t) => t.toLowerCase().replace(/\s+/g, '').replace('.', ':')).join(' ');
}
