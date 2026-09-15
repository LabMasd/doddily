import fs from 'node:fs';
const AGENTS = ['claudebot', 'claude-user', 'anthropic-ai', 'littledays'];
const robotsCache = new Map();

async function robotsAllows(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.host)) {
    let txt = '';
    try { const r = await fetch(`${u.protocol}//${u.host}/robots.txt`, { signal: AbortSignal.timeout(10000) }); if (r.ok) txt = await r.text(); } catch {}
    const groups = []; let cur = null;
    for (const raw of txt.split('\n')) {
      const line = raw.replace(/#.*/, '').trim(); const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
      else if ((k === 'allow' || k === 'disallow') && cur) cur.rules.push({ allow: k === 'allow', path: v });
    }
    const specific = groups.filter((g) => g.agents.some((a) => AGENTS.some((x) => a.includes(x))));
    robotsCache.set(u.host, specific.length ? specific : groups.filter((g) => g.agents.includes('*')));
  }
  const path = u.pathname + u.search; let best = null;
  for (const g of robotsCache.get(u.host)) for (const r of g.rules) {
    if (!r.path) continue;
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}


// Every listing without times, grouped by website, with robots.txt and bot-block status.
const DATA = new URL('../../../', import.meta.url).pathname;
const files = ['hubs', 'sensory', 'movement', 'swim', 'music', 'groups', 'play', 'cinema', 'libraries'];
const rows = [];
for (const f of files) {
  let d; try { d = JSON.parse(fs.readFileSync(`${DATA}uk-research/${f}.json`, 'utf8')); } catch { continue; }
  const items = Array.isArray(d) ? d : Object.values(d).find(Array.isArray) || [];
  for (const it of items) if (it.tier === 'venue' && it.url) rows.push({ file: f, id: it.id, name: it.name, provider: it.provider, venue: it.venue, postcode: it.postcode, url: it.url, note: it.schedule_note });
}
const byHost = new Map();
for (const r of rows) { const h = new URL(r.url).host.replace(/^www\./, ''); if (!byHost.has(h)) byHost.set(h, []); byHost.get(h).push(r); }
const hosts = [...byHost.keys()];
const UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)';
const status = new Map();
let i = 0;
async function worker() {
  while (i < hosts.length) {
    const h = hosts[i++]; const list = byHost.get(h);
    let allowed = 0; for (const r of list) if (await robotsAllows(r.url)) allowed++;
    let http = null;
    const first = list.find((r) => true);
    if (allowed) { try { const res = await fetch(first.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) }); http = res.status; } catch (e) { http = 'error'; } }
    status.set(h, { allowed, blocked: list.length - allowed, http });
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
const summary = hosts.map((h) => ({ host: h, n: byHost.get(h).length, providers: [...new Set(byHost.get(h).map((r) => r.provider))].slice(0, 2).join(', '), files: [...new Set(byHost.get(h).map((r) => r.file))].join(','), ...status.get(h) }))
  .sort((a, b) => b.n - a.n);
let robotsBlocked = 0, botBlocked = 0, open = 0;
for (const s of summary) { robotsBlocked += s.blocked; if (s.allowed && [401, 403, 429].includes(s.http)) botBlocked += s.allowed; else open += s.allowed; }
console.log(`${rows.length} listings without times, on ${hosts.length} websites`);
console.log(`  robots.txt blocks: ${robotsBlocked} · refuses bots (401/403/429): ${botBlocked} · open to read: ${open}\n`);
console.log('listings  robots-ok  blocked  http  website (provider) [file]');
for (const s of summary.slice(0, 40)) console.log(`${String(s.n).padStart(8)}  ${String(s.allowed).padStart(9)}  ${String(s.blocked).padStart(7)}  ${String(s.http ?? '-').padStart(4)}  ${s.host} (${s.providers}) [${s.files}]`);
const manual = rows.filter((r) => { const h = new URL(r.url).host.replace(/^www\./, ''); const s = status.get(h); return s.blocked === byHost.get(h).length || [401, 403, 429].includes(s.http); });
fs.writeFileSync(new URL('../../collected/manual-list.json', import.meta.url), JSON.stringify({ summary, manual }, null, 1));
console.log(`\nwrote manual-list.json: ${manual.length} blocked listings`);
