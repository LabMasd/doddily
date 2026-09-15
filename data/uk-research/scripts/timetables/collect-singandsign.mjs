import { chromium } from 'playwright-core';
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


// Sing and Sign: for each area's booking page, open each age stage's availability and read the class table.
// Teacher names are left out: only class facts are kept.
const exe = process.env.CHROMIUM_PATH || undefined; // default: the browser from `npx playwright install chromium`
const OUT = new URL('../../collected/singandsign.json', import.meta.url).pathname;
let d = JSON.parse(fs.readFileSync(new URL('../../movement.json', import.meta.url).pathname, 'utf8'));
d = Array.isArray(d) ? d : Object.values(d).find(Array.isArray);
const urls = [...new Set(d.filter((it) => it.tier === 'venue' && (it.url || '').includes('bookmyclass.co.uk')).map((it) => it.url))];
const STAGES = [
  { match: /babes/i, label: 'Babes', age: [0, 6] },
  { match: /stage one/i, label: 'Stage One', age: [6, 14] },
  { match: /stage two/i, label: 'Stage Two', age: [14, 24] },
];
const PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ua = await (await (await browser.newContext()).newPage()).evaluate(() => navigator.userAgent);
const page = await browser.newPage({ userAgent: `${ua} LittleDays/0.1 (+https://labmasd.github.io/little-days/)` });
await page.route('**/*', (r) => (['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
const results = []; let total = 0;
for (const [i, url] of urls.entries()) {
  const rec = { url, fid: new URL(url).searchParams.get('FID'), fetchedAt: new Date().toISOString(), area: null, rows: [], stages: {} };
  try {
    if (!(await robotsAllows(url))) { rec.status = 'robots-blocked'; results.push(rec); continue; }
    for (const stage of STAGES) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      if (!rec.area) rec.area = await page.evaluate(() => (document.body.innerText.match(/Sing and Sign [A-Z][^\n]{2,60}/) || [null])[0]).catch(() => null);
      // The stage buttons are styled elements rather than <button>s, so find them by their text.
      const byText = page.getByText(stage.match).first();
      let target = (await byText.count()) ? byText : null;
      if (!target) { const inputs = page.locator(`input[value]`); const n = await inputs.count(); for (let k = 0; k < n; k++) { const v = await inputs.nth(k).getAttribute('value'); if (v && stage.match.test(v)) { target = inputs.nth(k); break; } } }
      if (!target) { rec.stages[stage.label] = 'no button'; continue; }
      await Promise.all([page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}), target.click({ timeout: 10000 })]);
      await page.waitForTimeout(1500);
      const tables = await page.$$eval('table', (ts) => ts.map((t) => [...t.rows].map((r) => [...r.cells].map((c) => c.innerText.trim().replace(/\s+/g, ' ')))));
      let n = 0;
      for (const rows of tables) for (const cells of rows) {
        const dayIdx = cells.findIndex((c) => /^(mon|tues|wednes|thurs|fri|satur|sun)day$/i.test(c));
        if (dayIdx < 0 || cells.length < dayIdx + 4) continue;
        const [day, time, venue, address, , startDate, weeks, price, availability] = cells.slice(dayIdx);
        const pc = (address || '').match(PC) || (venue || '').match(PC);
        rec.rows.push({ stage: stage.label, age_min_months: stage.age[0], age_max_months: stage.age[1], day, start: (time.match(/\d{1,2}:\d{2}/) || [null])[0], venue, address, postcode: pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null,
          startDate: /\d{2}\/\d{2}\/\d{4}/.test(startDate || '') ? startDate : null, weeks: /^\d+$/.test(weeks || '') ? +weeks : null,
          price: (price || '').match(/£\d+(\.\d{2})?/) ? +(price.match(/£(\d+(?:\.\d{2})?)/)[1]) : null, availability: availability || null });
        n++;
      }
      rec.stages[stage.label] = n;
      await page.waitForTimeout(1500);
    }
    rec.status = rec.rows.length ? 'ok' : 'no-classes';
  } catch (e) { rec.status = 'error'; rec.error = e.message.split('\n')[0]; }
  results.push(rec); total += rec.rows.length;
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  if ((i + 1) % 10 === 0) console.log(`${i + 1}/${urls.length} areas · ${total} classes so far`);
}
await browser.close();
const by = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
console.log(`done: ${urls.length} areas · ${total} classes · ${JSON.stringify(by)} → ${OUT}`);
