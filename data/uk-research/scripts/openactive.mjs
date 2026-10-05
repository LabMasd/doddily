#!/usr/bin/env node
// Doddily (Little Days) — OpenActive open-data collector.
// Reads the public OpenActive RPDE feeds (licence CC BY 4.0) and keeps only sessions for babies,
// toddlers and pre-schoolers, in the same record shape as the other collectors in this folder.
//
// Polite: identifies as LittleDaysBot, honours robots.txt, >= 1.1 s between requests to the same
// provider, 45 s timeout, stops a feed after repeated errors and never retries a 401/403.
// Resumable: each feed keeps its RPDE position (the `next` URL) plus a slim log of candidate items
// in the cache folder, so a re-run carries on where the last one stopped and only asks for changes.
//
// Usage:
//   node openactive.mjs                         walk every default feed (capped), then build the result
//   node openactive.mjs --only better,everyoneactive,places
//   node openactive.mjs --max-pages 200         cap pages per feed for this run (default 600)
//   node openactive.mjs --max-minutes 30        stop walking after N minutes (default 60)
//   node openactive.mjs --no-dated              skip the big dated-session feeds (faster, but stale series stay in)
//   node openactive.mjs --build-only            rebuild from the cache; no feeds are read (only TeamUp's
//                                               robots.txt and any missing postcodes are looked up)
//   node openactive.mjs --list                  show the feeds and where each one has got to
//   node openactive.mjs --reset better          forget the saved position of matching feeds
// Groups for --only / --reset: better, everyoneactive, places, leisurecloud, legend, bookwhen, teamup,
//   bookteq, other (bookteq and other are skipped unless named). A dataset host fragment also works.
// Env: OA_CACHE (cache folder, default <system temp>/doddily-openactive), OA_OUT (result file).
//
// Nothing here is merged into the app: the result goes to collected/openactive.json for review.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'LittleDaysBot/1.0 (non-commercial family app; links back to providers)';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CACHE = process.env.OA_CACHE || path.join(os.tmpdir(), 'doddily-openactive');
const OUT = process.env.OA_OUT || path.join(HERE, '..', 'collected', 'openactive.json');
const COLLECTION = 'https://openactive.io/data-catalogs/data-catalog-collection.jsonld';
const GAP = Math.max(1100, +(process.env.OA_GAP || 1100));
const TIMEOUT = 45000;

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ONLY = opt('--only', '') ? opt('--only', '').split(',').map((s) => s.trim().toLowerCase()) : null;
const RESET = opt('--reset', '') ? opt('--reset', '').split(',').map((s) => s.trim().toLowerCase()) : null;
const MAX_PAGES = +opt('--max-pages', 600);
const MAX_MIN = +opt('--max-minutes', 60);
const BUILD_ONLY = flag('--build-only');
const LIST = flag('--list');
const T0 = Date.now();
const NOW = new Date();
const outOfTime = () => Date.now() - T0 > MAX_MIN * 60000;

fs.mkdirSync(path.join(CACHE, 'feeds'), { recursive: true });
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

// ---------- polite fetch ----------
// One queue per provider (sub-domains of the same platform share a queue), so providers can be read
// side by side while each one still sees at most one request every GAP ms.
const TWO_PART = /\.(co|org|gov|ac|ltd|me|net|sch)\.uk$/;
const hostKey = (u) => { const h = new URL(u).host.toLowerCase(); const p = h.split('.'); return p.slice(TWO_PART.test(h) ? -3 : -2).join('.'); };
const queues = new Map();
// Legend answered 403 after about 600 pages at the default pace, so it gets a slower one.
const SLOW = { 'legendonlineservices.co.uk': 3000 };
const blocked = new Set(); // providers that answered 401/403 in this run: nothing more is asked of them
async function politeFetch(url, init = {}) {
  const k = hostKey(url);
  const prev = queues.get(k) || Promise.resolve(0);
  let release; const slot = new Promise((r) => (release = r));
  queues.set(k, prev.then(() => slot));
  const lastDone = await prev;
  const wait = lastDone + Math.max(GAP, SLOW[k] || 0) - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json, text/html;q=0.8, */*;q=0.5', ...(init.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    const text = await res.text();
    return { status: res.status, text, retryAfter: +res.headers.get('retry-after') || 0 };
  } catch (e) {
    return { status: 0, text: '', error: String(e.cause?.code || e.message || e) };
  } finally { release(Date.now()); }
}

const robots = new Map();
async function robotsRules(origin) {
  if (robots.has(origin)) return robots.get(origin);
  const r = await politeFetch(origin + '/robots.txt');
  let rules = [];
  if (r.status === 401 || r.status === 403) rules = [{ allow: false, p: '/' }];
  else if (r.status === 200 && !/<html/i.test(r.text.slice(0, 500))) {
    const groups = []; let cur = null; let lastUA = false;
    for (let line of r.text.split(/\r?\n/)) {
      line = line.replace(/#.*/, '').trim();
      const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
      const k = m[1].toLowerCase(); const v = m[2].trim();
      if (k === 'user-agent') { if (!lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastUA = true; }
      else { lastUA = false; if (cur && (k === 'allow' || k === 'disallow') && v) cur.rules.push({ allow: k === 'allow', p: v }); }
    }
    const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && 'littledaysbot'.includes(a)));
    rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  }
  for (const x of rules) x.re = new RegExp('^' + x.p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  robots.set(origin, rules);
  return rules;
}
function robotsOk(rules, url) {
  let u; try { u = new URL(url); } catch { return true; }
  const p = u.pathname + u.search; let best = null;
  for (const r of rules) if (r.re.test(p) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r;
  return !best || best.allow;
}
async function allowed(url) { const u = new URL(url); return robotsOk(await robotsRules(u.origin), url); }

// ---------- discovery: catalogue -> dataset sites -> feeds ----------
function groupOf(catalogue, datasetUrl) {
  const u = datasetUrl.toLowerCase();
  if (/better\.org\.uk|better-admin|\/\/gll-/.test(u)) return 'better';
  if (/data\.everyoneactive\.com/.test(u)) return 'everyoneactive';
  if (/placesleisure/.test(u)) return 'places';
  if (/leisurecloud/.test(catalogue)) return 'leisurecloud';
  if (/legendonlineservices/.test(catalogue)) return 'legend';
  if (/bookwhen/.test(u)) return 'bookwhen';
  if (/goteamup/.test(u)) return 'teamup';
  if (/bookteq/.test(catalogue)) return 'bookteq';
  return 'other';
}
const SKIP_DATASET = /\/\/dev\.|pentest/; // test sites listed in the catalogues
async function discover() {
  const file = path.join(CACHE, 'catalog.json');
  const cached = readJson(file, null);
  if (cached && (BUILD_ONLY || LIST || Date.now() - cached.at < 7 * 864e5)) return cached.datasets;
  log('reading the OpenActive catalogue');
  const datasets = cached?.datasets ? [...cached.datasets] : [];
  const have = new Map(datasets.map((d) => [d.url, d]));
  const getJson = async (u) => { const r = await politeFetch(u); try { return JSON.parse(r.text); } catch { return null; } };
  const coll = await getJson(COLLECTION);
  if (!coll?.hasPart) { log('catalogue not readable; using the saved copy'); return datasets; }
  for (const cat of coll.hasPart) {
    const c = await getJson(cat);
    if (!c?.dataset) { log('sub-catalogue not readable', cat); continue; }
    await Promise.all(c.dataset.map(async (url) => {
      const group = groupOf(cat, url);
      if (SKIP_DATASET.test(url)) return;
      if (have.get(url)?.feeds?.length) return;
      // Dataset sites for groups that are not being walked are read lazily (bookteq has 82 of them).
      if ((group === 'bookteq' || group === 'other') && !(ONLY || []).includes(group)) { if (!have.has(url)) { const d = { url, catalogue: cat, group, feeds: [] }; have.set(url, d); datasets.push(d); } return; }
      const r = await politeFetch(url);
      const d = have.get(url) || { url, catalogue: cat, group, feeds: [] };
      if (!have.has(url)) { have.set(url, d); datasets.push(d); }
      d.status = r.status;
      for (const m of r.text.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
          const j = JSON.parse(m[1]);
          if (!j.distribution) continue;
          d.name = (j.name || '').trim(); d.publisher = (j.publisher?.name || '').trim(); d.license = j.license || '';
          d.site = j.publisher?.url || '';
          d.feeds = j.distribution.map((x) => ({ kind: x.name || (x.additionalType || '').split('/').pop() || 'Event', url: x.contentUrl })).filter((x) => x.url);
        } catch { /* not a dataset block */ }
      }
      if (!d.feeds.length) log('no feeds found on', url, 'HTTP', r.status, r.error || '');
    }));
  }
  fs.writeFileSync(file, JSON.stringify({ at: Date.now(), datasets }));
  return datasets;
}

// ---------- slimming: keep class facts only ----------
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const str = (x) => (typeof x === 'string' ? x : Array.isArray(x) ? x.filter((y) => typeof y === 'string').join(' ') : '');
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
const PC_RE = /\b([A-PR-UWYZ][A-HK-Y]?[0-9][0-9A-HJKMNPR-Y]? ?[0-9][ABD-HJLNP-UW-Z]{2})\b/i;
const normPc = (pc) => { const s = String(pc || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return PC_RE.test(s) ? s.slice(0, -3) + ' ' + s.slice(-3) : ''; };
const isOrg = (o) => o && typeof o === 'object' && /organi[sz]ation/i.test(str(o['@type'] || o.type));
const ageOf = (a) => (a && typeof a === 'object' && (a.minValue != null || a.maxValue != null) ? [a.minValue ?? null, a.maxValue ?? null] : null);

function slimLoc(l) {
  if (!l || typeof l !== 'object') return null;
  const a = l.address; let addr = ''; let pc = '';
  if (typeof a === 'string') { addr = a.replace(/\s*[\r\n]+\s*/g, ', '); pc = normPc((a.match(PC_RE) || [])[1]); }
  else if (a) { addr = [a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean).map((s) => String(s).trim()).join(', '); pc = normPc(a.postalCode) || normPc((String(a.streetAddress || '').match(PC_RE) || [])[1]); }
  const lat = +l.geo?.latitude; const lng = +l.geo?.longitude;
  return { n: String(l.name || '').split(/[\r\n]/)[0].trim().slice(0, 120), a: addr.slice(0, 200), pc, lat: lat || null, lng: lng || null, u: typeof l.url === 'string' ? l.url : '', tel: String(l.telephone || '').trim(), c: typeof a === 'object' && a ? a.addressCountry || '' : '' };
}
function slim(kind, d) {
  const sup = d.superEvent && typeof d.superEvent === 'object' ? d.superEvent : null;
  const course = d.instanceOfCourse && typeof d.instanceOfCourse === 'object' ? d.instanceOfCourse : null;
  const pick = (k) => d[k] ?? sup?.[k] ?? course?.[k];
  const org = [d.organizer, sup?.organizer, course?.author].find(isOrg); // people (teachers) are never kept
  const offers = arr(pick('offers')).slice(0, 12).map((o) => ({ n: str(o.name).slice(0, 60), p: typeof o.price === 'number' ? o.price : o.price != null && o.price !== '' && !isNaN(+o.price) ? +o.price : null, a: ageOf(o.ageRestriction || o.ageRange) }));
  const cats = [...arr(d.category), ...arr(course?.category), ...arr(sup?.category)].map((c) => (typeof c === 'string' ? c : c?.prefLabel || '')).filter(Boolean);
  const acts = [...arr(pick('activity')), ...arr(pick('activities'))].map((c) => c?.prefLabel || '').filter(Boolean);
  const subs = arr(d.subEvent).filter((s) => s?.startDate && Date.parse(s.startDate) > Date.now() - 864e5).slice(0, 80).map((s) => [s.startDate, s.endDate || null]);
  return {
    k: kind,
    n: str(d.name || sup?.name || course?.name).trim().slice(0, 160),
    d: stripHtml(d.description || course?.description || sup?.description || d.attendeeInstructions || '').slice(0, 600),
    c: [...new Set(cats)].slice(0, 6), act: [...new Set(acts)].slice(0, 6),
    age: ageOf(pick('ageRange')),
    off: offers,
    loc: slimLoc(d.location || sup?.location),
    url: typeof pick('url') === 'string' ? pick('url') : '',
    org: org ? { n: str(org.name).trim().slice(0, 100), u: typeof org.url === 'string' ? org.url : '' } : null,
    sch: arr(pick('eventSchedule')).slice(0, 14).map((s) => ({ by: arr(s.byDay).map((x) => String(x).split('/').pop().slice(0, 3)), s: s.startTime || null, e: s.endTime || null, from: s.startDate || null, to: s.endDate || null, f: s.repeatFrequency || null })),
    st: d.startDate || null, en: d.endDate || null,
    sub: subs,
    sup: typeof d.superEvent === 'string' ? d.superEvent : sup?.['@id'] || null,
    id: d['@id'] || null,
    x: /Cancel|Postpone/i.test(str(d.eventStatus)) ? 1 : 0,
    on: /OnlineEvent/i.test(str(pick('eventAttendanceMode'))) ? 1 : 0,
  };
}
// Loose first pass, applied while walking: anything that might be for young children. The strict
// filter runs at build time on these candidates, so it can be tuned without reading the feeds again.
const LOOSE = /bab(y|ies)|toddler|\btots?\b|pre-?\s?school|under[- ]?[1-8]s?\b|\bu[1-8]s?\b|soft\s?play|\b(parent|adult|mum|mummy|dad|carer)s?\s*(and|&|n|\+)\s*(me|bab|toddler|tot|child|pre)|\ba\s?&\s?c\b|\bad\s?&\s?ch|infant|duckling|tiny|\bmini|little|\bkid|child|family|bump|natal|nurser|cr[eè]che|\bplay|months|\bmths|\d\s?m\b|\b[0-8]\s?(-|–|to)\s?\d{1,2}\s?(yrs?|years?|yo)\b|sensory|buggy|pram|rhyme/i;
const looseText = (s) => `${s.n} | ${s.c.join(' ')} | ${s.off.map((o) => o.n).join(' ')}`;
const LOOSE_DESC = /bab(y|ies)\b|toddler|pre-?\s?school|under[- ]?[2-5]s?\b|soft\s?play|\b\d{1,2}\s?(months|mths)\b/i;
// (a feed range starting at 8+ rules an item out, unless the title is a parent-and-baby class, where it describes the parent)
const looseMatch = (s) => !(s.age && s.age[0] >= 8 && !/bab(y|ies)|toddler|buggy|\bpram|\btots?\b/i.test(s.n)) && (LOOSE.test(looseText(s)) || (LOOSE_DESC.test(s.d) && !/^[^.]*baby\s?chang[^.]*$/i.test(s.d)) || (s.age && (s.age[0] ?? 0) <= 4 && s.age[1] != null && s.age[1] <= 12));

// ---------- RPDE walking ----------
const feedDir = (url) => path.join(CACHE, 'feeds', url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80) + '_' + sha(url));
const KIND_ORDER = { SessionSeries: 1, CourseInstance: 2, Event: 3, ScheduledSession: 9 };
const wantKind = (k) => !/FacilityUse|Slot/i.test(k);

function loadCands(dir) {
  const map = new Map(); const f = path.join(dir, 'cand.jsonl');
  if (!fs.existsSync(f)) return map;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; } // a half-written last line after a crash
    if (j.gone) map.delete(j.id); else map.set(j.id, j.d);
  }
  return map;
}

// parents: for ScheduledSession feeds, the @ids of the candidate series in the same dataset.
async function walkFeed(ds, feed, parents) {
  const dir = feedDir(feed.url); fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  const st = readJson(stateFile, null) || { feed: feed.url, kind: feed.kind, dataset: ds.url, next: feed.url, pages: 0, items: 0, deleted: 0, cand: 0, done: false };
  const save = () => { st.updatedAt = new Date().toISOString(); fs.writeFileSync(stateFile, JSON.stringify(st)); };
  if (!(await allowed(feed.url))) { st.error = 'robots.txt disallows this feed'; save(); log('SKIP (robots)', feed.url); return st; }
  const known = new Set(loadCands(dir).keys());
  const out = fs.openSync(path.join(dir, 'cand.jsonl'), 'a');
  const isSched = /ScheduledSession$/.test(feed.kind) && parents;
  let pagesThisRun = 0; let errors = 0; delete st.error; st.capped = false;
  try {
    while (true) {
      if (pagesThisRun >= MAX_PAGES || outOfTime()) { st.capped = true; break; }
      const r = await politeFetch(st.next);
      if (r.status === 401 || r.status === 403) { st.error = `HTTP ${r.status} (blocked; not retried)`; blocked.add(hostKey(feed.url)); break; }
      let j = null;
      if (r.status === 200) { try { j = JSON.parse(r.text); } catch { /* handled below */ } }
      if (!j || !Array.isArray(j.items)) {
        errors++;
        st.error = `HTTP ${r.status}${r.error ? ' ' + r.error : ''}${r.status === 200 ? ' (not RPDE JSON)' : ''} at ${st.next}`;
        if (errors >= 3) break;
        await sleep(Math.min(60000, Math.max(r.retryAfter * 1000, 5000 * errors)));
        continue;
      }
      errors = 0; delete st.error;
      let lines = '';
      for (const it of j.items) {
        st.items++;
        const id = String(it.id);
        let keep = null;
        if (it.state === 'deleted' || !it.data) st.deleted++;
        else {
          const s = slim(it.kind || feed.kind, it.data);
          if (isSched) {
            // dated sessions: only future ones, and only for a series (or a name) that is a candidate
            const future = s.st && Date.parse(s.st) > Date.now() - 864e5;
            if (future && !s.x && ((s.sup && parents.has(s.sup)) || (s.n && looseMatch(s)))) keep = { k: s.k, sup: s.sup, st: s.st, en: s.en, url: s.url, ...(s.n ? { n: s.n, d: s.d.slice(0, 300), loc: s.loc, off: s.off, age: s.age, org: s.org } : {}) };
          } else if (!s.on && !s.x && looseMatch(s)) {
            // a dated one (no schedule of its own) that has already happened is of no use
            const past = s.k !== 'CourseInstance' && !s.sch.length && !s.sub.length && s.st && Date.parse(s.st) < Date.now() - 864e5;
            if (!past) keep = s;
          }
        }
        if (keep) { lines += JSON.stringify({ id, d: keep }) + '\n'; known.add(id); st.cand++; }
        else if (known.has(id)) { lines += JSON.stringify({ id, gone: 1 }) + '\n'; known.delete(id); }
      }
      if (lines) fs.writeSync(out, lines);
      st.pages++; pagesThisRun++;
      const end = !j.items.length || !j.next || j.next === st.next;
      if (j.next) st.next = new URL(j.next, st.next).href;
      st.done = end; save();
      if (pagesThisRun % 25 === 0) log(`  … ${ds.group} ${feed.kind} page ${st.pages}, ${st.items} items, ${known.size} candidates`);
      if (end) break;
    }
  } finally { fs.closeSync(out); st.live = known.size; save(); }
  log(`${st.done ? 'DONE   ' : st.error ? 'FAILED ' : 'PARTIAL'} ${ds.group} ${feed.kind} ${feed.url} — pages ${st.pages} (+${pagesThisRun}), items ${st.items}, deleted ${st.deleted}, candidates ${known.size}${st.error ? ' — ' + st.error : ''}`);
  return st;
}

function feedsToWalk(ds) {
  const feeds = ds.feeds.filter((f) => wantKind(f.kind)).sort((a, b) => (KIND_ORDER[a.kind] || 5) - (KIND_ORDER[b.kind] || 5));
  // Most series carry their own weekly schedule, so the (large) dated feeds are only needed to tell
  // which series still have sessions to book. --no-dated skips them; stale series are then not caught.
  return flag('--no-dated') ? feeds.filter((f) => f.kind !== 'ScheduledSession') : feeds;
}
const selected = (ds, list) => list.some((o) => o === ds.group || (o.length > 3 && ds.url.toLowerCase().includes(o)));
const inScope = (ds) => (ONLY ? selected(ds, ONLY) : ds.group !== 'bookteq' && ds.group !== 'other');

async function walkAll(datasets) {
  const todo = datasets.filter((d) => inScope(d) && d.feeds.length);
  const order = ['better', 'everyoneactive', 'places', 'leisurecloud', 'legend', 'bookwhen', 'teamup', 'other', 'bookteq'];
  todo.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  // one worker per provider queue; inside a queue, datasets go in priority order
  const byHost = new Map();
  for (const ds of todo) for (const f of feedsToWalk(ds)) { const k = hostKey(f.url); if (!byHost.has(k)) byHost.set(k, []); byHost.get(k).push([ds, f]); }
  await Promise.all([...byHost.values()].map(async (list) => {
    for (const [ds, f] of list) {
      if (outOfTime()) { log('time budget used; not started:', f.url); continue; }
      if (blocked.has(hostKey(f.url))) { log('not started (this provider blocked an earlier request):', f.url); continue; }
      let parents = null;
      if (f.kind === 'ScheduledSession') {
        parents = new Set();
        for (const p of ds.feeds) if (p.kind !== 'ScheduledSession' && wantKind(p.kind)) for (const c of loadCands(feedDir(p.url)).values()) if (c.id && judge(c, modeOf(ds, c)).ok) parents.add(c.id);
      }
      try { await walkFeed(ds, f, parents); } catch (e) { log('ERROR', f.url, e.message); }
    }
  }));
}

// ---------- strict filter ----------
const STRONG = /\bbab(y|ies)\b|\btoddlers?\b|\btots?\b|pre-?\s?school|\bunder[- ]?[2-5]'?s?\b|\bu[2-5]'?s\b|soft\s?play|\b(parent|adult|mum|mummy|dad|carer|grown[- ]?up)s?\s*(and|&|n|\+)\s*(me\b|bab|toddler|tot|child|pre)|\ba\s?&\s?c\b|\bad\s?&\s?ch\b|\bduckling|\bnewborn|stay\s*(and|&)\s*play|messy play|\bbuggy|\bpram\b|nursery rhyme|rhyme\s?time|\binfants?\b|\b(tiny|little|mini)\s?(tots|movers|kickers|gym|bouncers|splash|swimmers|dippers|dribblers|explorers|stars|strikers|ninjas|dancers|ballers|feet|steps)/i;
const WEAK = /\b(mini|tiny|little|mama|mamas|mums?|mummy|mummies)\b/i;
const NEVER = /baby\s?chang|birthday|part(y|ies)\b|pre\W*(and|&|\/|\+)?\W*post\W?natal|private hire|exclusive hire|\bhire\b|staff|\btraining course|lifeguard|\bnpl[qg]|teacher training|instructor course|rookie|\bclosed\b|maintenance|school (swim|booking|group)|(?<!pre[- ]?)\bschools?\b|holiday camp|\bante-?\s?natal|\bpre-?\s?natal|aqua\s?natal|pregnan|hypnobirth|baby\s?boomer|home\s?ed(ucat\w*)?\b|over\s?[4-9]\d|\b[4-9]\d\s?\+|walking (football|netball)|gcse|adult(s)? only/i;
const ADULT = /\badults?\b/i;
const CHILDY = /bab(y|ies)|toddler|child|\btots?\b|pre-?\s?school|junior|parent|buggy|\bpram\b/i;

// Ages written in a name or description, in months: [min, max] or null.
function parseAges(t) {
  t = String(t || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  const unit = (u) => (/^(m|mth|mths|month|months)$/.test(u) ? 1 : 12);
  let m;
  // "newborn-1yr", "birth to 6 months", "crawling-2yrs", "newborn-walking"
  if ((m = t.match(/\b(newborn|birth|new born)\s*(?:-|to|until)\s*(\d{1,2})\s*(m|mths?|months?|yrs?|years?|y)\b/))) return [0, +m[2] * unit(m[3])];
  if ((m = t.match(/\b(sitting|crawling|walking)\s*(?:-|to|until)\s*(\d{1,2})\s*(m|mths?|months?|yrs?|years?|y)\b/))) return [{ sitting: 5, crawling: 7, walking: 12 }[m[1]], +m[2] * unit(m[3])];
  if ((m = t.match(/\b(newborn|birth|0)\s*(?:-|to|until)\s*(pre-?\s?)?(sitting|crawling|walking)/))) return [0, { sitting: 6, crawling: 10, walking: 15 }[m[3]]];
  // "6 weeks to 12 months", "3 months - 4 years", "18mths-3yrs"
  if ((m = t.match(/(\d{1,2})\s*(weeks?|wks?|m|mths?|months?|yrs?|years?|y)\s*(?:-|to|until)\s*(\d{1,2})\s*(m|mths?|months?|yrs?|years?|y)\b/))) {
    const lo = /^w/.test(m[2]) ? Math.round(+m[1] / 4.3) : +m[1] * unit(m[2]);
    return [lo, +m[3] * unit(m[4])];
  }
  // "3-5 yrs", "0 to 4 years", "ages 2-4", "aged 3 - 5"
  if ((m = t.match(/(\d{1,2})\s*(?:-|to|&|and)\s*(\d{1,2})\s*(m|mths?|months?|y|yrs?|years?|year olds?|yo|y\/o)\b/))) { const u = unit(m[3].split(' ')[0].replace(/^(year|yo|y\/o)$/, 'yrs')); if (+m[1] < +m[2]) return [+m[1] * u, +m[2] * u]; }
  if (/\ba(d(ult)?)?\s?&\s?c(h(ild)?)?\b/.test(t) && (m = t.match(/\b(\d{1,2})\s*-\s*(\d{2})\b(?!:)/)) && +m[2] > 12 && +m[1] < +m[2]) return [+m[1], +m[2]];
  if ((m = t.match(/\bage[sd]?\s*(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\b/))) { if (+m[1] < +m[2]) return [+m[1] * 12, +m[2] * 12]; }
  if ((m = t.match(/\b(?:under|u)[- ]?(\d{1,2})'?s?\b/)) && +m[1] <= 18) return [0, +m[1] * 12];
  if ((m = t.match(/\b(\d{1,2})\s*(?:yrs?|years?)\s*(?:old\s*)?(?:and|&|or)\s*(?:under|younger|below)\b/))) return [0, +m[1] * 12];
  if ((m = t.match(/\bup to\s*(?:the age of\s*)?(\d{1,2})\s*(mths?|months?|yrs?|years?)\b/))) return [0, +m[1] * unit(m[2])];
  if ((m = t.match(/\b(?:from|aged?)\s*(\d{1,2})\s*(mths?|months?|yrs?|years?)\s*(?:\+|and (?:over|up|above)|upwards)?/))) return [+m[1] * unit(m[2]), null];
  if ((m = t.match(/\b(\d{1,2})\s*(mths?|months?|yrs?|years?)\s*(?:\+|and (?:over|up|above)|upwards)/))) return [+m[1] * unit(m[2]), null];
  if ((m = t.match(/\b(\d{1,2})\s*(?:yrs?|years?|year olds?)\b/)) && +m[1] <= 18) return [+m[1] * 12, +m[1] * 12 + 11];
  return null;
}
const DEFAULT_AGE = (t) => (/newborn/i.test(t) ? [0, 6] : /\bbab(y|ies)\b/i.test(t) && /toddler|child|pre-?\s?school/i.test(t) ? [0, 48] : /\bbab(y|ies)\b|post-?natal|buggy|pram/i.test(t) ? [0, 18] : /toddler|\btots?\b/i.test(t) ? [12, 48] : /pre-?\s?school|duckling/i.test(t) ? [36, 60] : [0, 60]);

// Returns { ok, why, age:[min,max], explicit }.
// mode 'course' (leisurecloud courses: the title is a booking code, the category is the name),
// 'indie' (Bookwhen/TeamUp: categories are free hashtags, so only the title counts) or 'centre'.
const modeOf = (ds, c) => (/leisurecloud/.test(ds.catalogue) && c.k === 'CourseInstance' && c.c[0] ? 'course' : /bookwhen|teamup/.test(ds.group) ? 'indie' : 'centre');
function judge(s, mode = 'centre') {
  const title = mode === 'course' ? s.c[0] : s.n;
  const head = mode === 'course' ? s.c.join(' | ') : mode === 'indie' ? s.n : `${s.n} | ${s.c.join(' | ')}`;
  if (!title) return { ok: false, why: 'no name' };
  if (NEVER.test(head)) return { ok: false, why: 'excluded word in name' };
  if (ADULT.test(head) && !CHILDY.test(head)) return { ok: false, why: 'adult session' };
  const strongHead = STRONG.test(head) || s.act.some((a) => /^soft\s?play$/i.test(a));
  const strongDesc = !strongHead && STRONG.test(s.d) && !/baby\s?chang/i.test(s.d);
  const named = parseAges(title) || (mode === 'indie' ? null : parseAges(s.c.join(' | ')));
  const described = parseAges(s.d);
  // Feed ageRange in years; many systems fill in 0–99 for everything, so only a tight range counts.
  const fa = s.age && s.age[1] != null && s.age[1] >= 1 && s.age[1] <= 12 ? [Math.round((s.age[0] || 0) * 12), Math.round(s.age[1] * 12) + (s.age[1] >= 1 ? 11 : 0)] : null;
  const feedMin = s.age && s.age[0] != null ? s.age[0] : null;
  // a "baby" or "toddler" title with a feed range starting at 3+ is a mis-filled field, not a fact
  const little = /\bbab(y|ies)\b|toddler|\btots?\b/i.test(head);
  const faOk = fa && !(little && fa[0] >= 36) ? fa : null;
  const descOk = described && described[0] < 60 && !(little && described[0] >= 36) ? described : null;
  // "parent and child" on its own does not say how old the child is
  const vague = !little && !/pre-?\s?school|under|soft\s?play|duckling|newborn|infant|\bu[2-5]/i.test(head) && /\b(parent|adult|mum|dad|carer)s?\s*(and|&|n|\+)\s*child|\ba\s?&\s?c\b|\bad\s?&\s?ch\b/i.test(head);
  const age = named || faOk || (strongHead ? null : described);
  if (named && named[0] >= 60) return { ok: false, why: `name says ${named[0] / 12}+ years` };
  // (on a "parent and baby" class a 16+ range describes the parent)
  if (feedMin != null && feedMin >= 5 && !named && !(feedMin >= 16 && strongHead)) return { ok: false, why: `feed ageRange starts at ${feedMin}` };
  if (age && age[0] >= 60) return { ok: false, why: 'ages start at 5 or over' };
  if (strongHead) {
    const a = age || descOk || DEFAULT_AGE(head);
    return { ok: true, age: [a[0], a[1] ?? Math.max(a[0] + 12, 60)], explicit: !!(named || faOk), why: 'name', doubtful: vague && !named && !faOk && !descOk };
  }
  // No clear word in the name: needs a real under-5 age band from the name or the feed.
  if (age && age[0] < 48 && age[1] != null && age[1] <= 71 && (named || faOk)) return { ok: true, age, explicit: true, why: 'age band' };
  if (strongDesc && WEAK.test(head) && (!described || described[0] < 48)) { const a = described || DEFAULT_AGE(s.d); return { ok: true, age: [a[0], a[1] ?? 60], explicit: !!described, why: 'description', doubtful: true }; }
  return { ok: false, why: strongDesc ? 'only the description mentions under-5s' : 'no under-5 signal' };
}

function categoryOf(s, title, useActs) {
  // the title decides; categories and then activity labels only break a tie
  for (const t of [title, `${title} ${s.c.join(' ')}`, useActs ? `${title} ${s.c.join(' ')} ${s.act.join(' ')}` : null]) { if (t == null) continue; const c = categoryFrom(t.toLowerCase()); if (c) return c; }
  return 'movement';
}
function categoryFrom(t) {
  if (/soft\s?play|play\s?(zone|area|centre|frame|den|park)|active play|adventure bounce/.test(t)) return 'softplay';
  if (/swim|aqua|duckling|\bpool\b|splash|water|dipper/.test(t)) return 'swim';
  if (/massage/.test(t)) return 'massage';
  if (/post-?\s?natal|buggy|pram|pilates|\bfit(ness)?\b|bootcamp|workout|circuit|conditioning|mama\b|exercise|cycl|sculpt|pump|bodybalance|balance|\bcore\b|l\s?b\s?t\b/.test(t)) return 'fitness';
  if (/sensory|messy/.test(t)) return 'sensory';
  if (/music|sing|rhyme|song/.test(t)) return 'music';
  if (/stay\s*(and|&)\s*play|play\s?group|toddler group|baby group|play session|\bcreche|toddler time/.test(t)) return 'stayplay';
  if (/toddler'?s?'? world/.test(t)) return 'softplay';
  if (/gym|tramp|bounce|dance|ballet|football|rugby|tennis|sport|tumble|kick|parkour|athlet|climb|skat|movers|yoga/.test(t)) return 'movement';
  return null;
}
const GENERIC = {
  softplay: 'Soft play session for babies, toddlers and young children.', swim: 'Swimming session for little ones with a parent or carer in the water.', massage: 'Baby massage class.',
  fitness: 'Exercise class for new parents, babies welcome.', sensory: 'Sensory play session for babies and toddlers.', music: 'Music and singing session for little ones.',
  stayplay: 'Play session for babies, toddlers and their grown-ups.', movement: 'Active class for toddlers and pre-schoolers.',
};

// ---------- times ----------
const LDN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function london(iso) {
  const t = Date.parse(iso); if (isNaN(t)) return null;
  const p = Object.fromEntries(LDN.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { day: p.weekday.slice(0, 3), hm: `${p.hour}:${p.minute}`, t };
}
// Better's old feed writes local clock times with a "Z" on the end (the same 11:00 either side of the
// clock change, matching the 11:00 in its new feed), so those are read as written.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function wall(iso) {
  const t = Date.parse(String(iso).replace(/(Z|[+-]\d{2}:?\d{2})$/, '') + 'Z'); if (isNaN(t)) return null;
  const d = new Date(t);
  return { day: DOW[d.getUTCDay()], hm: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`, t };
}
const hm = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const today = NOW.toISOString().slice(0, 10);

// Weekly sessions for one candidate: from its schedule, or from its dated occurrences.
function sessionsOf(s, dated, wallClock, datedComplete) {
  const when = wallClock ? wall : london;
  const out = []; let basis = '';
  for (const sc of s.sch || []) {
    if (sc.to && sc.to.slice(0, 10) < today) continue; // schedule already ended
    if (sc.f && !/^P(1W|7D|1D)$/.test(sc.f)) continue; // fortnightly/monthly are not "every week"
    for (const d of sc.by) if (DAY_ORDER.includes(d) && hm(sc.s)) { out.push({ day: d, start: hm(sc.s), end: hm(sc.e) }); basis = 'schedule'; }
  }
  // Where upcoming dated sessions are known, a weekly slot only counts if one of them falls on it.
  const live = new Set((dated || []).map(([a]) => when(a)).filter((a) => a && a.t > Date.now() - 864e5).map((a) => `${a.day}|${a.hm}`));
  if (out.length && live.size && datedComplete) { const still = out.filter((x) => live.has(`${x.day}|${x.start}`)); out.length = 0; out.push(...still); if (!out.length) basis = ''; }
  if (!out.length) {
    const occ = [...(s.sub || []), ...(dated || [])].map(([a, b]) => [when(a), b ? when(b) : null]).filter(([a]) => a && a.t > Date.now() - 864e5 && a.t < Date.now() + 42 * 864e5);
    const weeks = new Map();
    for (const [a, b] of occ) { const k = `${a.day}|${a.hm}|${b ? b.hm : ''}`; if (!weeks.has(k)) weeks.set(k, new Set()); weeks.get(k).add(Math.floor(a.t / (7 * 864e5))); }
    for (const [k, w] of weeks) { const [day, start, end] = k.split('|'); out.push({ day, start, end: end || null, n: w.size }); }
    if (out.length) basis = 'dates';
  }
  return { sessions: out, basis };
}

// ---------- build ----------
const titleCase = (s) => (s === s.toUpperCase() && /[A-Z]{4}/.test(s) ? s.toLowerCase().replace(/(^|[\s\-/(&])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s);
const FIRST_NAMES = 'anne?|anna|amy|amanda|alex|alison|andy|andrew|becky|beth|ben|carol|caroline|cath|catherine|charlotte|chloe|chris|claire|clare|dan|dave|david|debbie|donna|ellie|emma|emily|fiona|gemma|hannah|hayley|helen|jack|james|jane|jen|jenny|jess|jessica|jo|joanne|john|julie|karen|kate|katie|kelly|kim|laura|lauren|leanne|lisa|liz|louise|lucy|lynn|maria|marie|mark|matt|michelle|mike|natalie|nicola|nicky|paul|rachel|rebecca|rob|ruth|sam|sarah|sara|sharon|sophie|steve|sue|susan|tanya|tom|tracey|tracy|vicky|wendy|zoe';
const NOT_A_NAME = /^(parents?|bab(y|ies)|toddlers?|mums?|dads?|me|child(ren)?|music|friends|family|carers?|tots|kids|siblings|the|a|an|your|our|little|added|free|optional)$/i;
function cleanName(n) {
  let s = String(n || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\d{1,2}([:.]\d{2})?\s*(am|pm)\s*[-–:]?\s*/i, ''); // "10am Little Movers"
  s = s.replace(/\s*[([]\s*([A-Z]{1,3}|\d+)\s*[)\]]\s*$/g, ''); // booking-system codes like [WB]
  s = s.replace(/\b(a\s?&\s?c|ad\s?&\s?ch)\b/i, 'Adult & Child');
  // trailing day/time written into the title by the booking system: "… Fri 07:00", "… Sat 0930 Dc"
  s = s.replace(/^(mon|tues?|wed(nes)?|thu(rs?)?|fri|sat(ur)?|sun)(day)?s?\s+\d{1,2}[:;.]?\d{2}\s*(am|pm)?\s*[-–:]?\s*/i, ''); // "Mon 09:15 Mini Movers"
  s = s.replace(/[\s\-–,]+(mon|tues?|wed(nes)?|thu(rs?)?|fri|sat(ur)?|sun)(day)?s?(?=[\s\d]|$)[\s\d:;.\-–apm@]*(\s[A-Za-z]{1,3})?\s*$/i, '');
  s = s.replace(new RegExp(`\\s+(${FIRST_NAMES})\\s*$`, 'i'), ''); // staff first names tacked on by booking systems
  s = s.replace(/[\s\-–,@]+\d{1,2}[:.]?\d{2}\s*(am|pm)?(\s*(-|–|to)\s*\d{1,2}[:.]?\d{2}\s*(am|pm)?)?\s*$/i, '');
  s = s.replace(/\s*\((block of \d+|\d{1,2}[:.]?\d{0,2}\s*(am|pm))\)/gi, '').replace(/\s+(new term|term \d+)\s*$/i, '').replace(/\*+$/, '');
  // teacher names are not kept: "… with Sarah", "… (Hannah)"
  s = s.replace(/\s+(with|by|w\/)\s+([A-Z][a-z]+)(\s+[A-Z][a-z]+)?\s*$/, (m, w, a) => (NOT_A_NAME.test(a) ? m : ''));
  s = s.replace(/\s*\(([A-Z][a-z]+)\)\s*$/, (m, a) => (NOT_A_NAME.test(a) ? m : ''));
  return titleCase(s.replace(/[\s\-–,:|]+$/, '').trim()).slice(0, 90);
}
const PERSONY = /\b(with|by|teacher|instructor|coach|tutor|hosted by|led by|taught by|run by|my name is|i am|i'm)\s+(is\s+)?[A-Z][a-z]+\b|\b(Miss|Mrs|Mr|Ms)\.?\s+[A-Z]/;
function describe(s, cat) {
  let d = String(s.d || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (!d || d.length < 25 || PERSONY.test(d) || /@|\b0\d{3,4}\s?\d{3}\s?\d{3,4}\b/.test(d)) return GENERIC[cat];
  if (d.length > 220) { const cut = d.slice(0, 220); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! ')); d = i > 80 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, '') + '…'; }
  return d;
}
const siteOf = (ds) => (ds.site && !/openactive|\/api\/|\/login/i.test(ds.site) ? ds.site : ''); // a data page is not a page for parents
const money = (n) => (n === 0 ? 'Free' : `£${n.toFixed(2)}`);
const slugKey = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const UK = (lat, lng) => lat > 49.8 && lat < 60.95 && lng > -8.7 && lng < 1.9;

async function geocode(postcodes) {
  const file = path.join(CACHE, 'postcodes.json');
  const cache = readJson(file, {});
  const need = [...new Set(postcodes)].filter((p) => p && !(p in cache));
  for (let i = 0; i < need.length; i += 100) {
    const r = await politeFetch('https://api.postcodes.io/postcodes', { method: 'POST', body: JSON.stringify({ postcodes: need.slice(i, i + 100) }), headers: { 'Content-Type': 'application/json' } });
    try { for (const x of JSON.parse(r.text).result) cache[x.query] = x.result ? [x.result.latitude, x.result.longitude] : null; } catch { log('postcode lookup failed', r.status, r.error || ''); break; }
  }
  fs.writeFileSync(file, JSON.stringify(cache));
  return cache;
}

async function build(datasets) {
  const report = { built: new Date().toISOString(), feeds: [], operators: {}, rejected: {}, samples: { rejected: [], doubtful: [] } };
  const groups = new Map();
  // TeamUp's robots.txt lists providers who do not want their pages crawled; their classes are left out.
  const tuRules = datasets.some((d) => d.group === 'teamup' && d.feeds.some((f) => fs.existsSync(feedDir(f.url)))) ? await robotsRules('https://goteamup.com').catch(() => []) : [];
  for (const ds of datasets.filter((d) => d.feeds.length)) {
    const states = ds.feeds.filter((f) => wantKind(f.kind)).map((f) => ({ f, st: readJson(path.join(feedDir(f.url), 'state.json'), null) })).filter((x) => x.st);
    if (!states.length) continue;
    const opName = ds.publisher || ds.name || new URL(ds.url).host;
    const op = (report.operators[opName] ||= { group: ds.group, dataset: ds.url, items: 0, deleted: 0, candidates: 0, kept_series: 0, no_location: 0, no_times: 0, one_off: 0, stale: 0, records: 0 });
    for (const { f, st } of states) { report.feeds.push({ group: ds.group, operator: opName, kind: f.kind, url: f.url, pages: st.pages, items: st.items, deleted: st.deleted, candidates: st.live ?? st.cand, status: st.error ? 'failed' : st.done ? 'complete' : 'partial', error: st.error || undefined, updatedAt: st.updatedAt }); op.items += st.items; op.deleted += st.deleted; }
    // dated sessions, grouped under their series
    const dated = new Map(); const standalone = [];
    for (const { f } of states.filter((x) => x.f.kind === 'ScheduledSession')) for (const c of loadCands(feedDir(f.url)).values()) {
      if (c.sup) { if (!dated.has(c.sup)) dated.set(c.sup, []); dated.get(c.sup).push(c); } else if (c.n) standalone.push(c);
    }
    const schedStates = states.filter((x) => x.f.kind === 'ScheduledSession');
    const schedDone = schedStates.length > 0 && schedStates.every((x) => x.st.done);
    const cands = [];
    const seriesIds = new Set();
    for (const { f } of states.filter((x) => x.f.kind !== 'ScheduledSession')) for (const c of loadCands(feedDir(f.url)).values()) { cands.push({ c, f }); if (c.id) seriesIds.add(c.id); }
    // sessions that name themselves (TeamUp) but whose series was not a candidate or carries no place
    const orphan = new Map();
    for (const [sup, list] of dated) if (!seriesIds.has(sup) && list[0].n) orphan.set(sup, list);
    for (const [sup, list] of orphan) { const a = list.find((x) => x.loc) || list[0]; cands.push({ c: { k: 'SessionSeries', n: a.n, d: a.d || '', c: [], act: [], age: a.age || null, off: a.off || [], loc: a.loc || null, url: (a.url || '').replace(/\/e\/[^/]+\/?$/, '/'), org: a.org || null, sch: [], sub: [], id: sup }, f: states.find((x) => x.f.kind === 'ScheduledSession').f }); }
    // single dated Events (Better's legacy feed, TeamUp/Bookwhen events): fold same name + place together
    const evGroups = new Map();
    for (const x of [...cands]) {
      if (x.c.k === 'CourseInstance' || x.c.sch.length || x.c.sub.length || !x.c.st || dated.has(x.c.id)) continue;
      const k = `${slugKey(cleanName(x.c.n))}|${x.c.loc?.pc || x.c.loc?.n || ''}|${x.c.age ? x.c.age.join('-') : ''}`;
      if (!evGroups.has(k)) { evGroups.set(k, { ...x, c: { ...x.c, sub: [], folded: true } }); cands.push(evGroups.get(k)); }
      evGroups.get(k).c.sub.push([x.c.st, x.c.en]);
      x.skip = true;
    }
    for (const { c, f, skip } of cands) {
      if (skip) continue;
      op.candidates++;
      const mode = modeOf(ds, c);
      const v = judge(c, mode);
      if (!v.ok) { report.rejected[v.why.replace(/\d+(\.\d+)?/g, 'N')] = (report.rejected[v.why.replace(/\d+(\.\d+)?/g, 'N')] || 0) + 1; if (LOOSE.test(c.n) && report.samples.rejected.length < 400) report.samples.rejected.push({ op: opName, name: c.n, cat: c.c.join(' / '), age: c.age, venue: c.loc?.n, why: v.why }); continue; }
      if (ds.group === 'teamup' && c.url && !robotsOk(tuRules, c.url)) { report.rejected['provider page disallowed by robots.txt'] = (report.rejected['provider page disallowed by robots.txt'] || 0) + 1; continue; }
      op.kept_series++;
      const loc = c.loc;
      if (!loc || (!loc.pc && !(loc.lat && loc.lng))) { op.no_location++; continue; }
      if (loc.c && !/^(GB|UK|United Kingdom)$/i.test(loc.c)) { op.no_location++; continue; }
      const dts = (dated.get(c.id) || []).map((x) => [x.st, x.en]);
      // Where the dated feed was read to the end, a series with no session left to book is stale.
      if (schedDone && c.k === 'SessionSeries' && !orphan.has(c.id) && !dts.some(([a]) => Date.parse(a) > Date.now() - 864e5)) { op.stale++; continue; }
      const verified = dts.length > 0 || c.sub.length > 0;
      const { sessions, basis } = sessionsOf(c, dts, /data\.better\.org\.uk/.test(ds.url), schedDone);
      // a single dated occurrence of an Event is a one-off, not a weekly session
      // (leisure centres only publish a week or two ahead, so there a single sighting is normal)
      const oneOff = basis === 'dates' && c.folded && /bookwhen|teamup|other|bookteq/.test(ds.group) && sessions.every((x) => x.n < 2);
      if (oneOff) { op.one_off++; continue; }
      if (!sessions.length) op.no_times++;
      const independent = mode === 'indie';
      const name = cleanName(mode === 'course' ? c.c[0] : c.n) || c.n;
      // independents: no weekly time means a one-off or an ended block; seasonal specials are one-offs too
      if (independent && (!sessions.length || /christmas|xmas|new year|halloween|easter|special|catch[- ]?up|taster|workshop|party/i.test(c.n))) { op.one_off++; continue; }
      const cat = categoryOf(c, name, !/data\.better\.org\.uk/.test(ds.url)); // Better's old feed tags everything "Swimming"
      const key = `${ds.url}|${loc.pc || `${loc.lat},${loc.lng}`}|${slugKey(loc.n)}|${slugKey(name)}`;
      let g = groups.get(key);
      if (!g) { g = { ds, opName, f, name, cat, loc, c, sessions: [], ages: [], prices: [], explicit: false, doubtful: false, verified: false, basis: new Set(), whys: new Set(), course: false }; groups.set(key, g); }
      for (const x of sessions) if (!g.sessions.some((y) => y.day === x.day && y.start === x.start)) g.sessions.push({ day: x.day, start: x.start, end: x.end });
      g.ages.push(v.age); if (v.explicit) g.explicit = true; if (v.doubtful) g.doubtful = true;
      if (basis) g.basis.add(basis); g.whys.add(v.why); if (verified || basis === 'dates') g.verified = true;
      if (c.k === 'CourseInstance') g.course = true;
      if (c.k !== 'CourseInstance') for (const o of c.off) if (o.p != null && !/staff|employee/i.test(o.n)) g.prices.push(o.p); // course prices are per term or per month, so not shown
      if (!g.c.d && c.d) g.c = c;
    }
  }
  // geocode what has a postcode but no coordinates
  const pcs = await geocode([...groups.values()].filter((g) => !(g.loc.lat && g.loc.lng) && g.loc.pc).map((g) => g.loc.pc));
  const out = [];
  for (const g of groups.values()) {
    const op = report.operators[g.opName];
    let { lat, lng } = g.loc;
    if (!(lat && lng) && g.loc.pc && pcs[g.loc.pc]) [lat, lng] = pcs[g.loc.pc];
    if (!(lat && lng) || !UK(lat, lng)) { op.no_location++; continue; }
    g.sessions.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.start.localeCompare(b.start));
    // Soft play is often sold as arrival slots every 15 minutes: join slots that overlap into one session.
    if (g.sessions.length > 14 && g.sessions.every((x) => x.end)) {
      const joined = [];
      for (const x of g.sessions) { const p = joined[joined.length - 1]; if (p && p.day === x.day && x.start <= p.end) { if (x.end > p.end) p.end = x.end; } else joined.push({ ...x }); }
      g.sessions = joined;
    }
    const amin = Math.min(...g.ages.map((a) => a[0])); const amax = Math.max(...g.ages.map((a) => a[1]));
    const prices = [...new Set(g.prices)].sort((a, b) => a - b);
    const free = prices.length > 0 && prices.every((p) => p === 0);
    const paid = prices.filter((p) => p > 0); // a £0 offer next to paid ones is a concession (under-3s, members), not the price
    const venue = titleCase(g.loc.n) || g.opName;
    const independent = g.ds.group === 'bookwhen' || g.ds.group === 'teamup';
    const provider = independent ? g.c.org?.n || venue : g.ds.group === 'better' ? 'Better' : g.opName;
    const hasTimes = g.sessions.length > 0;
    // no page to send a parent to means no link back to the provider, so the record is not kept
    if (!(g.c.url || g.loc.u || g.c.org?.u || siteOf(g.ds))) { op.no_url = (op.no_url || 0) + 1; continue; }
    const note = hasTimes
      ? `${g.basis.has('schedule') ? 'Weekly times' : 'Times of the sessions bookable now'} from the provider's open data (checked ${today}); check before you go`
      : 'Times on the booking page';
    out.push({
      name: g.name, provider, category: g.cat,
      venue, address: [g.loc.a, g.loc.pc].filter(Boolean).join(', '), postcode: g.loc.pc || '', lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6),
      sessions: g.sessions, tier: hasTimes ? 'timetable' : 'venue', schedule_note: note,
      age_min_months: amin, age_max_months: amax,
      price: free ? 'Free' : paid.length ? (paid[0] === paid[paid.length - 1] ? money(paid[0]) : `${money(paid[0])}–${money(paid[paid.length - 1])}`) : '',
      free, booking: g.course ? 'term' : 'book', indoor: true,
      description: describe(g.c, g.cat),
      url: g.c.url || g.loc.u || g.c.org?.u || siteOf(g.ds),
      phone: independent ? '' : g.loc.tel || '',
      source: g.ds.url, feed: g.f.url, licence: 'CC BY 4.0', attribution: `${g.ds.publisher || g.opName} (OpenActive open data)`,
      confidence: g.doubtful ? 'low' : g.explicit && hasTimes ? 'high' : 'medium',
      evidence: `${[...g.whys].join('+')}; age ${g.explicit ? 'stated' : 'assumed from the name'}; times from ${[...g.basis].join('+') || 'none'}${g.basis.has('schedule') ? (g.verified ? ', upcoming dates seen' : ', upcoming dates not checked') : ''}`,
    });
    op.records++;
    if (g.doubtful && report.samples.doubtful.length < 200) report.samples.doubtful.push({ op: g.opName, name: g.name, venue, desc: g.c.d.slice(0, 160) });
  }
  // The same class can sit in two datasets of one operator (Better has an old and a new feed):
  // keep the one built from a weekly schedule, then the one with more sessions.
  const seen = new Map();
  const rank = (x) => (/from schedule/.test(x.evidence) ? 1e6 : 0) + x.sessions.length;
  for (const r of out) {
    // Better's old feed says "Soft Play (U 10's)" where the new one says "Soft Play" or "Soft Play Under 10s"
    const base = r.provider === 'Better' ? r.name.replace(/\(?\b(u|under)\s?\d+'?s?\b\)?/i, '').replace(/\([^)]*\)/g, '') : r.name;
    const k = `${r.provider}|${r.postcode || `${r.lat},${r.lng}`}|${slugKey(base).replace(/\b(session|sessions|s)\b/g, '').replace(/\s+/g, '')}`;
    (seen.get(k) || seen.set(k, []).get(k)).push(r);
  }
  for (const list of seen.values()) {
    if (list.length < 2) continue;
    // one dataset wins the whole slot (the one with the best record); within it, same-named records fold
    const best = list.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    const names = new Set();
    for (const r of list.sort((a, b) => rank(b) - rank(a))) {
      if (r.source !== best.source || names.has(r.name)) { r.drop = true; report.duplicates_within = (report.duplicates_within || 0) + 1; }
      names.add(r.name);
    }
  }
  for (let i = out.length - 1; i >= 0; i--) if (out[i].drop) out.splice(i, 1);
  out.sort((a, b) => a.provider.localeCompare(b.provider) || a.venue.localeCompare(b.venue) || a.name.localeCompare(b.name));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const byCat = {}; const byTier = {}; const venues = new Set();
  for (const r of out) { byCat[r.category] = (byCat[r.category] || 0) + 1; byTier[r.tier] = (byTier[r.tier] || 0) + 1; venues.add(`${r.postcode}|${slugKey(r.venue)}`); }
  report.totals = { records: out.length, with_times: byTier.timetable || 0, venues: venues.size, byCategory: byCat };
  fs.writeFileSync(path.join(CACHE, 'report.json'), JSON.stringify(report, null, 1));
  log(`wrote ${out.length} records to ${OUT}`);
  console.log(JSON.stringify(report.totals));
  console.log('operator | items seen | deleted | candidates | kept series | records | no location | no times | one-offs | stale');
  for (const [n, o] of Object.entries(report.operators)) console.log(`${n} | ${o.items} | ${o.deleted} | ${o.candidates} | ${o.kept_series} | ${o.records} | ${o.no_location} | ${o.no_times} | ${o.one_off} | ${o.stale}`);
  console.log('feeds:');
  for (const f of report.feeds) console.log(`  ${f.status.padEnd(8)} ${f.kind.padEnd(16)} pages ${String(f.pages).padStart(5)} items ${String(f.items).padStart(8)}  ${f.url}${f.error ? '  — ' + f.error : ''}`);
  console.log(`full report: ${path.join(CACHE, 'report.json')}`);
}

// ---------- main ----------
const datasets = await discover();
if (RESET) for (const ds of datasets.filter((d) => selected(d, RESET))) for (const f of ds.feeds) fs.rmSync(feedDir(f.url), { recursive: true, force: true });
if (LIST) {
  for (const ds of datasets) for (const f of ds.feeds) { const st = readJson(path.join(feedDir(f.url), 'state.json'), null); console.log(`${ds.group.padEnd(14)} ${f.kind.padEnd(16)} ${st ? (st.error ? 'failed' : st.done ? 'complete' : 'partial').padEnd(8) + ' pages ' + st.pages + ' items ' + st.items : 'not started'}  ${f.url}`); }
  console.log(`cache: ${CACHE}`);
} else {
  if (!BUILD_ONLY) await walkAll(datasets);
  await build(datasets);
}
