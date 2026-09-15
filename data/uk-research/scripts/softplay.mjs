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
const AI_AGENTS = /^(claudebot|claude-web|claude-user|claude-searchbot|anthropic-ai|gptbot|chatgpt-user|oai-searchbot|ccbot|google-extended|perplexitybot|perplexity-user|bytespider|applebot-extended|meta-externalagent|cohere-ai|cohere-training-data-crawler|diffbot|omgili|ai2bot|amazonbot|youbot|timpibot|imagesiftbot|petalbot)$/;
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
  if (r.status === 401 || r.status === 403 || r.cfm === 'challenge' || (r.status >= 400 && /just a moment|cf-chl|captcha|access denied/i.test(r.text.slice(0, 5000)))) {
    const why = `HTTP ${r.status}${r.cfm ? ' Cloudflare challenge' : ''}`; siteBlock.set(u.origin, why); return { ...r, blocked: why };
  }
  return r;
}

const isMain = import.meta.url === 'file://' + process.argv[1];
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === 'fetch') { for (const u of process.argv.slice(3)) { const r = await get(u); console.log(r.status, r.blocked || '', r.url, r.text.length); } }
  if (cmd === 'robots') {
    for (const d of process.argv.slice(3)) {
      const origin = d.startsWith('http') ? new URL(d).origin : 'https://' + d;
      const st = await siteStatus(origin);
      let home = '';
      if (st.ok) { const r = await get(origin + '/'); home = `${r.status} ${r.blocked || ''} ${r.url} ${(r.text.match(/<title[^>]*>([^<]*)/i) || [])[1] || ''}`.replace(/\s+/g, ' ').slice(0, 140); }
      console.log(origin, st.ok ? 'OK' : 'SKIP: ' + st.why, '|', home);
    }
  }
}
