// Build UK place tiles (parks, playgrounds, libraries, pools, soft play, farms, museums, baby change)
// from an OpenStreetMap extract. Run by .github/workflows/places.yml, not on a laptop.
//   node scripts/build-places.mjs places.geojsonseq data/places
// Input: `osmium export -f geojsonseq` (one GeoJSON Feature per line).
// Output: data/places/<ty>_<tx>.json (0.5° tiles) + data/places/index.json
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const [input = 'places.geojsonseq', outDir = 'data/places'] = process.argv.slice(2);
const TILE = 0.5;

const miles = (a, b) => {
  const R = 3958.8, rad = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

function centroid(g) {
  let ring;
  if (!g) return null;
  if (g.type === 'Point') return { lng: g.coordinates[0], lat: g.coordinates[1] };
  if (g.type === 'LineString') ring = g.coordinates;
  else if (g.type === 'Polygon') ring = g.coordinates[0];
  else if (g.type === 'MultiPolygon') ring = g.coordinates[0][0];
  if (!ring?.length) return null;
  let x = 0, y = 0;
  for (const [lng, lat] of ring) { x += lng; y += lat; }
  return { lng: x / ring.length, lat: y / ring.length };
}

function kindOf(t) {
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'park' && t.name) return 'park';
  if (t.amenity === 'library') return 'libplace';
  if (t.amenity === 'toilets' && t.changing_table === 'yes') return 'change';
  if (t.leisure === 'sports_centre' && /(^|;)\s*swimming\s*(;|$)/.test(t.sport || '') && t.access !== 'private') return 'pool';
  if (t.leisure === 'indoor_play') return 'softplace';
  if (t.tourism === 'zoo' && t.zoo === 'petting_zoo') return 'farmplace';
  if (t.tourism === 'museum') return 'museumplace';
  return null;
}

const r5 = (n) => Math.round(n * 1e5) / 1e5;
const tileKey = (p) => `${Math.floor(p.lat / TILE)}_${Math.floor(p.lng / TILE)}`;

const parks = [], rest = [];
const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
let lines = 0;
for await (const raw of rl) {
  const line = raw.replace(/^\x1e/, '').trim();
  if (!line) continue;
  lines++;
  let f;
  try { f = JSON.parse(line); } catch { continue; }
  const t = f.properties || {};
  const kind = kindOf(t);
  if (!kind) continue;
  const c = centroid(f.geometry);
  if (!c) continue;
  const id = `osm:${t['@id'] || f.id || `${c.lat},${c.lng}`}`;
  const p = { id, kind, t, lat: r5(c.lat), lng: r5(c.lng) };
  (kind === 'park' ? parks : rest).push(p);
}

// Spatial grid of parks so unnamed playgrounds can be called "Playground in <park>".
const CELL = 0.01;
const grid = new Map();
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
for (const k of parks) {
  const key = cellKey(k.lat, k.lng);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(k);
}
function nearestPark(p) {
  let best = null, bd = 0.2;
  const cy = Math.floor(p.lat / CELL), cx = Math.floor(p.lng / CELL);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    for (const k of grid.get(`${cy + dy}:${cx + dx}`) || []) {
      const d = miles(p, k);
      if (d < bd) { bd = d; best = k; }
    }
  }
  return best;
}

const out = [];
const withPlay = new Set();
const base = (p, category, name, extra = {}) => {
  const t = p.t;
  const item = { id: p.id, name, category, lat: p.lat, lng: p.lng, sessions: [], tier: 'place', osm: true, free: true, price: 'Free', booking: 'drop-in', indoor: true, ...extra };
  const url = t.website || t['contact:website'];
  const phone = t.phone || t['contact:phone'];
  if (url) item.url = url;
  if (phone) item.phone = phone;
  if (t.opening_hours) item.schedule_note = `Opening hours: ${t.opening_hours}`;
  if (!item.venue && t['addr:street']) item.venue = t['addr:street'];
  return item;
};

for (const p of rest) {
  const t = p.t;
  switch (p.kind) {
    case 'playground': {
      const park = t.name ? null : nearestPark(p);
      if (park) withPlay.add(park.id);
      out.push(base(p, 'playground', t.name || (park ? `Playground in ${park.t.name}` : 'Playground'), { venue: park?.t.name || t['addr:street'] || '', indoor: t.indoor === 'yes' }));
      break;
    }
    case 'libplace':
      out.push(base(p, 'libplace', t.name || 'Library', { description: 'Warm, quiet and free. Most have a children’s corner and a weekly rhyme time.' }));
      break;
    case 'change':
      out.push(base(p, 'change', t.name || 'Toilets with baby change', { venue: t['addr:street'] || nearestPark(p)?.t.name || '', free: t.fee !== 'yes', price: t.fee === 'yes' ? 'Small fee' : 'Free' }));
      break;
    case 'pool':
      out.push(base(p, 'pool', t.name || 'Swimming pool', { free: false, price: '', booking: 'book', description: 'Leisure centre with a pool. Look for parent and baby swim sessions on their timetable.' }));
      break;
    case 'softplace':
      out.push(base(p, 'softplace', t.name || 'Soft play', { free: false, price: '' }));
      break;
    case 'farmplace':
      out.push(base(p, 'farmplace', t.name || 'Petting farm', { indoor: false, free: t.fee !== 'yes', price: t.fee === 'yes' ? '' : 'Free' }));
      break;
    case 'museumplace':
      out.push(base(p, 'museumplace', t.name || 'Museum', { free: t.fee === 'no', price: t.fee === 'no' ? 'Free' : '' }));
      break;
  }
}
for (const k of parks) {
  const big = /park|fields|marsh|common|wetland|heath|wood/i.test(k.t.name);
  if (!big && !withPlay.has(k.id)) continue;
  out.push(base(k, 'park', k.t.name, { venue: withPlay.has(k.id) ? 'Has a playground' : '', indoor: false }));
}

// UK only (the extract includes a little of Ireland's border area).
const uk = out.filter((p) => p.lat > 49.8 && p.lat < 60.95 && p.lng > -8.7 && p.lng < 1.9);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const tiles = new Map();
for (const p of uk) {
  const k = tileKey(p);
  if (!tiles.has(k)) tiles.set(k, []);
  tiles.get(k).push(p);
}
const index = { built: new Date().toISOString().slice(0, 10), tile: TILE, source: 'OpenStreetMap contributors (ODbL)', tiles: {} };
for (const [k, arr] of tiles) {
  fs.writeFileSync(path.join(outDir, `${k}.json`), JSON.stringify(arr));
  index.tiles[k] = arr.length;
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));

const counts = uk.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
console.log(`read ${lines} features → ${uk.length} places in ${tiles.size} tiles`, counts);
