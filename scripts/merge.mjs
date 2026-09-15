// Merge research into map tiles the app loads by location.
//   data/research/*.json     hand-checked local research (wins on duplicates)
//   data/uk-research/*.json  UK-wide directories from national sources
// Output: data/tiles/<ty>_<tx>.json + data/tiles/index.json
// Usage: node scripts/merge.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TILE = 0.5; // degrees; about 35 x 21 miles in the UK
const CATS = new Set(['library', 'stayplay', 'support', 'music', 'sensory', 'movement', 'massage', 'fitness', 'swim', 'cinema', 'museum', 'farm', 'softplay', 'cafe', 'outdoor']);
const DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const HM = /^\d{1,2}:\d{2}$/;
const UK = (lat, lng) => lat > 49.8 && lat < 60.95 && lng > -8.7 && lng < 1.9;

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pad = (t) => (t && HM.test(t) ? t.padStart(5, '0') : null);
const pcKey = (p) => String(p || '').replace(/\s+/g, '').toUpperCase();
const brand = (s) => slug(s).split('-').slice(0, 2).join('-');

const items = [];
const byId = new Set();
const byDupe = new Set();
const problems = [];
const perSource = {};

function readDir(dir, local) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { problems.push(`${f}: bad JSON (${e.message})`); continue; }
    if (!Array.isArray(arr)) { problems.push(`${f}: not an array`); continue; }
    let kept = 0;
    for (const raw of arr) {
      const it = { ...raw };
      if (!it.name || typeof it.lat !== 'number' || typeof it.lng !== 'number' || !UK(it.lat, it.lng)) continue;
      if (!CATS.has(it.category)) it.category = 'support';
      it.sessions = (it.sessions || [])
        .map((s) => ({ day: String(s.day || '').slice(0, 3), start: pad(s.start), end: pad(s.end) }))
        .filter((s) => DAYS.has(s.day));
      if (!['drop-in', 'book', 'term'].includes(it.booking)) it.booking = 'book';
      it.free = !!it.free;
      it.indoor = it.indoor !== false;
      it.tier = it.sessions.some((s) => s.start) ? 'timetable' : it.tier === 'place' ? 'place' : (it.tier === 'venue' || !local ? 'venue' : 'place');
      if (local && !it.sessions.length) it.tier = 'place';
      if (local) it.local = true;
      // Same brand + category + age group at the same postcode = the same class, whichever source found it.
      // (Age is part of the key: one venue often runs a baby class and a toddler class.)
      const dupe = `${pcKey(it.postcode)}|${it.category}|${brand(it.name)}|${it.age_min_months ?? ''}-${it.age_max_months ?? ''}`;
      if (it.postcode && byDupe.has(dupe)) continue;
      let id = slug(`${it.name}-${it.venue || it.provider}-${pcKey(it.postcode)}`) || slug(`${it.name}-${it.lat}`);
      if (byId.has(id)) continue;
      byId.add(id); if (it.postcode) byDupe.add(dupe);
      delete it.evidence;
      it.id = id;
      items.push(it);
      kept++;
    }
    perSource[`${local ? 'research' : 'uk'}/${f}`] = kept;
  }
}

readDir(path.join(root, 'data/research'), true);
readDir(path.join(root, 'data/uk-research'), false);

const tiles = new Map();
for (const it of items) {
  const key = `${Math.floor(it.lat / TILE)}_${Math.floor(it.lng / TILE)}`;
  if (!tiles.has(key)) tiles.set(key, []);
  tiles.get(key).push(it);
}

const outDir = path.join(root, 'data/tiles');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const checked = new Date().toISOString().slice(0, 10);
const index = { checked, tile: TILE, tiles: {} };
for (const [key, arr] of tiles) {
  fs.writeFileSync(path.join(outDir, `${key}.json`), JSON.stringify(arr));
  index.tiles[key] = arr.length;
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));

const tiers = items.reduce((m, it) => ((m[it.tier] = (m[it.tier] || 0) + 1), m), {});
console.log(`${items.length} activities in ${tiles.size} tiles (checked ${checked})`, tiers);
for (const [k, v] of Object.entries(perSource)) console.log(`  ${k}: ${v}`);
if (problems.length) console.log(problems.join('\n'));
