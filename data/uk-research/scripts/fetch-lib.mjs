// Polite fetch helper for Little Days UK research: robots.txt aware, <=1 req/s per run, disk cache.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)';
export const CACHE = '/private/tmp/claude-501/-Users-marcos/0163a3c6-bbf9-4559-87fa-6bce78e5fab8/scratchpad/uk/play/';
fs.mkdirSync(CACHE, { recursive: true });
const lastByHost = new Map(); let last = 0; const delayByHost = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle(url) { const h = new URL(url).host; const d = Math.max(+(process.env.LD_GAP || 1100), (delayByHost.get(h) || 0) * 1000); const w1 = last + +(process.env.LD_GAP || 1100) - Date.now(); const w2 = (lastByHost.get(h) || 0) + d - Date.now(); const w = Math.max(w1, w2); if (w > 0) await sleep(w); last = Date.now(); lastByHost.set(h, last); }
const robotsCache = new Map();
function key(u) { return crypto.createHash('sha1').update(u).digest('hex').slice(0, 16) + '_' + u.replace(/[^a-z0-9]+/gi, '_').slice(0, 80); }
async function rawGet(url, opts = {}) {
  const f = path.join(CACHE, key(url + (opts.body || '')));
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  await throttle(url);
  let res;
  try {
    const r = await fetch(url, { method: opts.method || 'GET', body: opts.body, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    res = { status: r.status, url: r.url, text: await r.text() };
  } catch (e) { res = { status: 0, url, text: '', error: String(e) }; }
  if (res.status && res.status < 500) fs.writeFileSync(f, JSON.stringify(res));
  return res;
}
function parseRobots(txt) {
  // returns rules for our UA (LittleDaysBot) else '*'
  const groups = []; let cur = null; let lastWasUA = false;
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!lastWasUA) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasUA = true; }
    else { lastWasUA = false; if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', p: v }); }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && 'littledaysbot'.includes(a)));
  const star = groups.filter((g) => g.agents.includes('*'));
  return (mine.length ? mine : star).flatMap((g) => g.rules);
}
function pathMatch(p, rule) {
  if (!rule) return false;
  const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(p);
}
export async function allowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    const r = await rawGet(u.origin + '/robots.txt');
    { const cd = (r.text.match(/crawl-delay\s*:\s*([\d.]+)/i) || [])[1]; if (cd && r.status === 200) delayByHost.set(u.host, Math.min(parseFloat(cd), 15)); }
    robotsCache.set(u.origin, r.status >= 200 && r.status < 300 && !/<html/i.test(r.text.slice(0, 500)) ? parseRobots(r.text) : (r.status === 401 || r.status === 403 ? [{ allow: false, p: '/' }] : []));
  }
  const rules = robotsCache.get(u.origin); const p = u.pathname + u.search;
  let best = null;
  for (const r of rules) { if (r.p === '' ) continue; if (pathMatch(p, r.p) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r; }
  return !best || best.allow;
}
export async function get(url, opts = {}) {
  if (!(await allowed(url))) return { status: -1, url, text: '', blocked: true };
  return rawGet(url, opts);
}
export { rawGet };
