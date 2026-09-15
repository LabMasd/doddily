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


// Baby Sensory: read every branch timetable table (robots.txt checked, >=1.5 s between pages, no images).
const exe = process.env.CHROMIUM_PATH || undefined; // default: the browser from `npx playwright install chromium`
const OUT = new URL('../../collected/babysensory.json', import.meta.url).pathname;
let d = JSON.parse(fs.readFileSync(new URL('../../sensory.json', import.meta.url).pathname, 'utf8'));
d = Array.isArray(d) ? d : Object.values(d).find(Array.isArray);
const urls = [...new Set(d.filter((it) => it.tier === 'venue' && (it.url || '').includes('babysensory.com')).map((it) => it.url))];
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ua = await (await (await browser.newContext()).newPage()).evaluate(() => navigator.userAgent);
const page = await browser.newPage({ userAgent: `${ua} LittleDays/0.1 (+https://labmasd.github.io/little-days/)` });
await page.route('**/*', (r) => (['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
const results = []; let rowsTotal = 0;
const PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const age = (s) => { const m = s.match(/(birth|\d+)\s*to\s*(\d+)\s*months/i); return m ? [m[1].toLowerCase() === 'birth' ? 0 : +m[1], +m[2]] : [null, null]; };
for (const [i, url] of urls.entries()) {
  const rec = { url, fetchedAt: new Date().toISOString(), rows: [] };
  try {
    if (!(await robotsAllows(url))) { rec.status = 'robots-blocked'; results.push(rec); continue; }
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    rec.http = res?.status();
    await page.waitForSelector('table#TimeTable tbody tr', { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const raw = await page.$$eval('table#TimeTable tbody tr', (trs) => trs.map((tr) => ({
      venueId: tr.getAttribute('data-venue-id'), stream: tr.getAttribute('data-product-stream-id'),
      cells: [...tr.cells].map((c) => ({ text: c.innerText.trim(), lines: c.innerText.split('\n').map((l) => l.trim()).filter(Boolean) })),
    })));
    for (let r = 0; r < raw.length; r++) {
      const row = raw[r]; if (!row.venueId || row.cells.length < 5) continue;
      const next = raw[r + 1] && !raw[r + 1].venueId ? raw[r + 1].cells.map((c) => c.text).join(' ') : '';
      const [venue, ...addr] = row.cells[0].lines; const address = addr.join(', ');
      const pc = (address.match(PC) || venue.match(PC));
      const dayText = row.cells[1].text.replace(/ /g, ' ');
      const dm = dayText.match(/^(\w+)\s+(\d{1,2} \w{3} \d{4})\s*-\s*(\d{1,2} \w{3} \d{2,4})/);
      const tm = row.cells[2].text.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      const [amin, amax] = age(row.cells[3].text);
      const term = next.match(/Term £(\d+\.\d{2})/); const single = next.match(/(\d+) Session £(\d+\.\d{2})/);
      const book = row.cells[4].text.replace(/\s+/g, ' ');
      rec.rows.push({ venueId: row.venueId, stream: row.stream, venue, address, postcode: pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null,
        day: dm ? dm[1] : dayText.split(' ')[0], termStart: dm?.[2] ?? null, termEnd: dm?.[3] ?? null,
        start: tm?.[1] ?? null, end: tm?.[2] ?? null, ageText: row.cells[3].text, age_min_months: amin, age_max_months: amax,
        termPrice: term ? +term[1] : null, sessionPrice: single ? +single[2] : null,
        status: /wait list/i.test(book) ? 'waitlist' : /book/i.test(book) ? 'bookable' : book.slice(0, 40), spacesLeft: (book.match(/only (\d+) spaces? left/i) || [])[1] ?? null });
    }
    rec.status = rec.rows.length ? 'ok' : ((await page.content()).includes('No classes are currently available') ? 'no-classes' : 'no-table');
  } catch (e) { rec.status = 'error'; rec.error = e.message.split('\n')[0]; }
  results.push(rec); rowsTotal += rec.rows.length;
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  if ((i + 1) % 20 === 0) console.log(`${i + 1}/${urls.length} pages · ${rowsTotal} classes so far`);
  await page.waitForTimeout(1500);
}
await browser.close();
const by = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
console.log(`done: ${urls.length} pages · ${rowsTotal} classes · ${JSON.stringify(by)} → ${OUT}`);
