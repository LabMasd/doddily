#!/usr/bin/env node
// Little Days live search — local web search (SearXNG) + local model (Ollama).
//
//   littledays "baby swimming"                    search near your saved postcode
//   littledays "sensory class" --near E17 -r 2    somewhere else, 2 miles
//   littledays "rhyme time" --add                 also save results into the app
//   options: --model qwen3:14b  --pages 10  --json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CONFIG = path.join(os.homedir(), '.littledays.json'); // home postcode lives here, not in the repo
const SEARX = process.env.SEARXNG_URL || 'http://127.0.0.1:8888';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CATS = ['library', 'stayplay', 'support', 'music', 'sensory', 'movement', 'massage', 'fitness', 'swim', 'cinema', 'museum', 'farm', 'softplay', 'cafe', 'outdoor'];
const SKIP = /facebook\.com|instagram\.com|tiktok\.com|youtube\.com|pinterest\.|reddit\.com|mumsnet\.com|tripadvisor\.|x\.com|twitter\.com|linkedin\.com|yelp\./i;

// ---------- terminal output ----------
const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c(2), bold = c(1), amber = c(33), green = c(32), red = c(31), cyan = c(36);
const status = (s) => { if (tty) process.stdout.write(`\r\x1b[K${dim(s)}`); };
const clear = () => { if (tty) process.stdout.write('\r\x1b[K'); };

// ---------- args ----------
function parseArgs(argv) {
  const o = { q: [], radius: null, near: null, add: false, model: null, pages: 10, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--near' || a === '-n') o.near = argv[++i];
    else if (a === '--radius' || a === '-r') o.radius = +argv[++i];
    else if (a === '--add') o.add = true;
    else if (a === '--model' || a === '-m') o.model = argv[++i];
    else if (a === '--pages' || a === '-p') o.pages = +argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else o.q.push(a);
  }
  o.q = o.q.join(' ').trim();
  return o;
}

// ---------- helpers ----------
async function getJSON(url, opts = {}, ms = 15000) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function geocode(pc) {
  const clean = pc.replace(/\s+/g, '').toUpperCase();
  try {
    const j = await getJSON(`https://api.postcodes.io/postcodes/${clean}`);
    const r = j.result;
    return { lat: r.latitude, lng: r.longitude, label: r.postcode, area: [r.admin_ward, r.admin_district].filter(Boolean).join(', '), outcode: r.outcode };
  } catch { /* maybe an outcode */ }
  try {
    const j = await getJSON(`https://api.postcodes.io/outcodes/${clean}`);
    const r = j.result;
    return { lat: r.latitude, lng: r.longitude, label: r.outcode, area: (r.admin_district || []).join(', '), outcode: r.outcode };
  } catch { return null; }
}
async function geocodeMany(postcodes) {
  const uniq = [...new Set(postcodes.filter(Boolean).map((p) => p.replace(/\s+/g, '').toUpperCase()))];
  const out = new Map();
  for (let i = 0; i < uniq.length; i += 100) {
    try {
      const j = await getJSON('https://api.postcodes.io/postcodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes: uniq.slice(i, i + 100) }) });
      for (const r of j.result) if (r.result) out.set(r.query, { lat: r.result.latitude, lng: r.result.longitude, postcode: r.result.postcode });
    } catch { /* keep going */ }
  }
  return out;
}

// ---------- search ----------
async function searx(query) {
  const u = `${SEARX}/search?format=json&language=en-GB&q=${encodeURIComponent(query)}`;
  const j = await getJSON(u, {}, 20000);
  return (j.results || []).map((r) => ({ url: r.url, title: r.title, snippet: r.content || '' }));
}

function htmlToText(html) {
  // JSON-LD events are the best structured source when a site has them.
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).join('\n').slice(0, 3000);
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { ld, text };
}

// Keep the parts of a page that look like timetable info, so the model reads less.
function focus(text, max = 7000) {
  if (text.length <= max) return text;
  const lines = text.split('\n');
  const hit = /(mon|tues|wednes|thurs|fri|satur|sun)day|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s?(am|pm)\b|£|free|baby|babies|toddler|under\s?[125]s?|months|postcode|\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i;
  const keep = new Set();
  lines.forEach((l, i) => { if (hit.test(l)) for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
  let out = lines.filter((_, i) => keep.has(i)).join('\n');
  if (out.length < 800) out = text;
  return out.slice(0, max);
}

async function fetchPage(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Accept-Language': 'en-GB,en;q=0.9' } });
  if (!r.ok) throw new Error(String(r.status));
  const type = r.headers.get('content-type') || '';
  if (!type.includes('html') && !type.includes('text')) throw new Error('not html');
  return htmlToText(await r.text());
}

// ---------- model ----------
const SCHEMA = {
  type: 'object',
  properties: {
    activities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          provider: { type: 'string' },
          category: { type: 'string', enum: CATS },
          venue: { type: 'string' },
          address: { type: 'string' },
          postcode: { type: 'string' },
          sessions: { type: 'array', items: { type: 'object', properties: { day: { type: 'string', enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }, start: { type: 'string' }, end: { type: 'string' } }, required: ['day', 'start', 'end'] } },
          schedule_note: { type: 'string' },
          age_min_months: { type: 'integer' },
          age_max_months: { type: 'integer' },
          price: { type: 'string' },
          free: { type: 'boolean' },
          booking: { type: 'string', enum: ['drop-in', 'book', 'term'] },
          indoor: { type: 'boolean' },
          description: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['name', 'category', 'venue', 'postcode', 'sessions', 'price', 'free', 'booking', 'indoor', 'description', 'evidence'],
      },
    },
  },
  required: ['activities'],
};

async function ollamaChat(model, messages, format, numCtx = 12288) {
  const j = await getJSON(`${OLLAMA}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, format, stream: false, think: false, options: { temperature: 0, num_ctx: numCtx } }),
  }, 240000);
  return j.message?.content || '';
}

async function planQueries(model, q, place) {
  const base = [`${q} ${place.area} ${place.outcode}`, `${q} near ${place.outcode} London timetable`];
  try {
    const out = await ollamaChat(model, [
      { role: 'system', content: 'You write short web search queries to find baby and toddler activities in London. Reply as JSON.' },
      { role: 'user', content: `Parent is looking for: "${q}". Area: ${place.area} (${place.outcode}). Write 3 different search queries that would find real timetables (provider sites, council pages, library events). Include the area name in each.` },
    ], { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' } } }, required: ['queries'] }, 2048);
    const extra = JSON.parse(out).queries || [];
    return [...new Set([...base, ...extra.slice(0, 3)])];
  } catch { return base; }
}

async function extract(model, q, place, page) {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const content = `Search: "${q}" near ${place.area} (${place.outcode}), London. Today is ${today}.
Page title: ${page.title}
URL: ${page.url}
${page.ld ? `Structured data:\n${page.ld}\n` : ''}Page text:
${page.text}`;
  const out = await ollamaChat(model, [
    { role: 'system', content: `You pull baby and toddler activities (for ages 0 to 3 with a parent) out of one web page.
Rules:
- Only include activities that this page clearly describes, that recur or are upcoming, and that match the search.
- Copy days, times, prices and postcodes exactly as the page states them. Never guess. If the page gives no time, use empty strings for start and end; if no days, return an empty sessions list and explain in schedule_note.
- Times as 24h HH:MM. Days as Mon..Sun. Ages in months (e.g. "0-12 months" gives 0 and 12; "under 5s" gives 0 and 60).
- "evidence" is a short exact quote from the page showing the day/time.
- Leave out anything past, cancelled, or only for older children.
- If the page has nothing relevant, return {"activities": []}.` },
    { role: 'user', content },
  ], SCHEMA);
  try { return JSON.parse(out).activities || []; } catch { return []; }
}

// ---------- output ----------
function printCard(a) {
  const when = a.sessions.length ? a.sessions.map((s) => `${s.day}${s.start ? ' ' + s.start : ''}${s.end ? '–' + s.end : ''}`).join(', ') : (a.schedule_note || 'Times not listed');
  const dist = a.distance != null ? `${a.distance.toFixed(1)} mi` : '? mi';
  const price = a.free ? green('Free') : a.price || 'Price not listed';
  const age = a.age_max_months ? `${a.age_min_months ?? 0}–${a.age_max_months}m` : '';
  console.log(`\n${bold(a.name)}  ${dim(dist)}`);
  console.log(`  ${amber(when)}`);
  console.log(`  ${[a.venue, a.postcode].filter(Boolean).join(', ')}`);
  console.log(`  ${[price, a.booking === 'drop-in' ? 'drop in' : a.booking === 'term' ? 'term booking' : 'book ahead', age].filter(Boolean).join(dim('  ·  '))}`);
  if (a.description) console.log(`  ${dim(a.description)}`);
  console.log(`  ${cyan(a.url)}`);
}

// ---------- main ----------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { /* first run */ }

  if (o.help || !o.q) {
    console.log(`Little Days live search

  littledays "baby swimming"                 near your saved postcode
  littledays "sensory class" --near E17 -r 2
  littledays "rhyme time" --add               also add results to the app

  --near, -n     postcode or area code (saved as home the first time)
  --radius, -r   miles (default ${cfg.radius || 3})
  --model, -m    Ollama model (default ${cfg.model || 'qwen3:8b'})
  --pages, -p    pages to read (default 10)
  --add          save results into data/research and rebuild the app data
  --json         print JSON instead of cards`);
    return;
  }

  const model = o.model || cfg.model || 'qwen3:8b';
  const radius = o.radius || cfg.radius || 3;
  const near = o.near || cfg.home;
  if (!near) { console.log(red('Add a postcode the first time: littledays "baby swimming" --near N16 5UN')); process.exit(1); }
  if (!cfg.home) { cfg.home = near; cfg.radius = radius; fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2)); }

  // Preflight: both local services up?
  try { await getJSON(`${OLLAMA}/api/tags`, {}, 3000); } catch { console.log(red('Ollama is not running. Start it with: ollama serve')); process.exit(1); }
  try { await searx('test'); } catch { console.log(red('SearXNG is not running. Start it with: docker start littledays-searxng')); process.exit(1); }

  const place = await geocode(near);
  if (!place) { console.log(red(`Couldn't find the postcode "${near}".`)); process.exit(1); }
  const t0 = Date.now();
  if (!o.json) console.log(`${bold('Little Days')} ${dim(`· "${o.q}" within ${radius} mi of ${place.label} · ${model}`)}`);

  status('Planning searches…');
  const queries = await planQueries(model, o.q, place);

  const seen = new Set(), hits = [];
  for (const [i, qq] of queries.entries()) {
    status(`Searching the web ${i + 1}/${queries.length}: ${qq}`);
    try {
      for (const r of await searx(qq)) {
        const key = r.url.replace(/[#?].*$/, '').replace(/\/$/, '');
        if (seen.has(key) || SKIP.test(r.url) || /\.pdf$/i.test(key)) continue;
        seen.add(key); hits.push(r);
      }
    } catch { /* one engine hiccup shouldn't stop the run */ }
  }
  // Interleave results from different queries so one site doesn't take every slot.
  const perHost = new Map();
  const picked = hits.filter((h) => { const host = new URL(h.url).host; const n = perHost.get(host) || 0; perHost.set(host, n + 1); return n < 2; }).slice(0, o.pages);

  status(`Opening ${picked.length} pages…`);
  const pages = (await Promise.allSettled(picked.map(async (h) => ({ ...h, ...(await fetchPage(h.url)) }))))
    .map((r, i) => (r.status === 'fulfilled' ? r.value : { ...picked[i], ld: '', text: picked[i].snippet, blocked: true }))
    .filter((p) => p.text && p.text.length > 60);

  const found = [];
  const byKey = new Map();
  for (const [i, p] of pages.entries()) {
    const host = new URL(p.url).host.replace(/^www\./, '');
    status(`Reading ${i + 1}/${pages.length}: ${host}${p.blocked ? ' (snippet only)' : ''}`);
    let acts = [];
    try { acts = await extract(model, o.q, place, { ...p, text: focus(p.text) }); } catch (e) { continue; }
    const geo = await geocodeMany(acts.map((a) => a.postcode));
    for (const a of acts) {
      const g = geo.get((a.postcode || '').replace(/\s+/g, '').toUpperCase());
      a.url = p.url;
      a.sessions = (a.sessions || []).map((s) => ({ day: s.day, start: /^\d{1,2}:\d{2}$/.test(s.start) ? s.start.padStart(5, '0') : null, end: /^\d{1,2}:\d{2}$/.test(s.end) ? s.end.padStart(5, '0') : null }));
      if (g) { a.lat = g.lat; a.lng = g.lng; a.postcode = g.postcode; a.distance = miles(place, g); }
      if (a.distance != null && a.distance > radius) continue;
      // Without a real postcode we can't place it; keep it only if the page itself looked local.
      if (a.distance == null && !new RegExp(place.outcode, 'i').test(p.text)) continue;
      a.confidence = g && a.sessions.some((s) => s.start) ? 'medium' : 'low';
      const key = slug(`${a.name}-${a.venue}`);
      if (byKey.has(key)) continue;
      byKey.set(key, a); found.push(a);
      if (!o.json) { clear(); printCard(a); }
    }
  }
  clear();

  found.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
  if (o.json) { console.log(JSON.stringify(found, null, 2)); return; }

  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`\n${found.length ? green(`${found.length} found`) : amber('Nothing found')} ${dim(`· read ${pages.length} pages in ${Math.floor(secs / 60)}m ${secs % 60}s`)}`);
  if (!found.length) console.log(dim('Try different words, a bigger radius (-r 5), or more pages (-p 20).'));

  if (o.add && found.length) {
    const placed = found.filter((a) => a.lat != null);
    const file = path.join(ROOT, 'data/research', `cli-${new Date().toISOString().slice(0, 10)}.json`);
    let prev = [];
    try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
    const clean = placed.map(({ distance, evidence, ...a }) => ({ ...a, provider: a.provider || '', address: a.address || '', schedule_note: a.schedule_note || '', age_min_months: a.age_min_months ?? 0, age_max_months: a.age_max_months ?? 36, phone: '' }));
    fs.writeFileSync(file, JSON.stringify([...prev, ...clean], null, 1));
    console.log(execFileSync('node', [path.join(ROOT, 'scripts/merge.mjs')], { encoding: 'utf8' }).trim().split('\n')[0]);
    console.log(dim(`Saved ${clean.length} to ${path.relative(ROOT, file)}. Publish with: cd ~/little-days && git add -A && git commit -m "New activities" && git push`));
  }
}

main().catch((e) => { clear(); console.error(red(e.message)); process.exit(1); });
