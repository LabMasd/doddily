import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { miles, tileKeys } from './geo';
import type { Activity, Category, Loc } from './types';

const BASE = 'https://labmasd.github.io/doddily/data/tiles';
const PLACE_MAX_MI = 5;
const HOUR = 36e5;

/** Every activity the app has shown, by id, so detail screens can open instantly. */
export const activityCache = new Map<string, Activity>();

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
}

/** Fresh from storage if young enough; otherwise network, falling back to stale storage when offline. */
async function cached<T>(key: string, maxAge: number, load: () => Promise<T>): Promise<T> {
  let stale: T | undefined;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const c = JSON.parse(raw) as { t: number; v: T };
      if (Date.now() - c.t < maxAge) return c.v;
      stale = c.v;
    }
  } catch { /* unreadable cache */ }
  try {
    const v = await load();
    AsyncStorage.setItem(key, JSON.stringify({ t: Date.now(), v })).catch(() => {});
    return v;
  } catch (e) {
    if (stale !== undefined) return stale;
    throw e;
  }
}

type TileIndex = { checked: string; tile: number; tiles: Record<string, number> };

export async function loadActivities(loc: Loc, radius: number) {
  const index = await cached<TileIndex>('ld:index', 6 * HOUR, () => fetchJSON(`${BASE}/index.json`));
  const keys = tileKeys(loc, radius, index.tile, index.tiles);
  const tiles = await Promise.all(
    keys.map((k) => cached<Activity[]>(`ld:tile:${index.checked}:${k}`, 30 * 24 * HOUR, () => fetchJSON(`${BASE}/${k}.json`)))
  );
  const items = tiles.flat();
  for (const it of items) activityCache.set(it.id, it);
  return { checked: index.checked, items };
}

// ---------- live places from OpenStreetMap ----------
type OsmEl = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

const PLACES_BASE = 'https://labmasd.github.io/doddily/data/places';

export async function loadPlaces(loc: Loc, radius: number, curated: Activity[]) {
  const r = Math.min(radius, PLACE_MAX_MI);
  let places: Activity[];
  try {
    places = await loadPlaceTiles(loc, r);
  } catch {
    places = await loadOverpass(loc, r);
  }
  const out = dedupeAgainst(places, curated);
  for (const p of out) activityCache.set(p.id, p);
  return out;
}

/** Prebuilt monthly from an OpenStreetMap extract (see .github/workflows/places.yml). */
async function loadPlaceTiles(loc: Loc, r: number) {
  const index = await cached<{ built: string; tile: number; tiles: Record<string, number> }>('ld:places-index', 24 * HOUR, () =>
    fetchJSON(`${PLACES_BASE}/index.json`)
  );
  const keys = tileKeys(loc, r, index.tile, index.tiles);
  const tiles = await Promise.all(
    keys.map((k) => cached<Activity[]>(`ld:places:${index.built}:${k}`, 60 * 24 * HOUR, () => fetchJSON(`${PLACES_BASE}/${k}.json`)))
  );
  return oneCardPerName(tiles.flat().filter((p) => miles(loc, p) <= r), loc);
}

/** Fallback while the prebuilt places aren't available. */
async function loadOverpass(loc: Loc, r: number) {
  const key = `ld:places:${loc.lat.toFixed(3)},${loc.lng.toFixed(3)},${r}`;
  return cached<Activity[]>(key, 7 * 24 * HOUR, async () => {
    const around = `(around:${Math.round(r * 1609.344)},${loc.lat},${loc.lng})`;
    const q = `[out:json][timeout:30];(
      nwr${around}[leisure=playground];
      nwr${around}[leisure=park][name];
      nwr${around}[amenity=library];
      nwr${around}[amenity=toilets][changing_table=yes];
      nwr${around}[leisure=sports_centre][sport=swimming][access!=private];
      nwr${around}[leisure=indoor_play];
      nwr${around}[tourism=zoo][zoo=petting_zoo];
      nwr${around}[tourism=museum];
    );out center tags;`;
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (Platform.OS !== 'web') headers['User-Agent'] = 'Doddily/0.1 (family app)';
    let lastErr: unknown;
    for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
      try {
        const json = await fetchJSON<{ elements: OsmEl[] }>(ep, { method: 'POST', headers, body: 'data=' + encodeURIComponent(q) });
        return shapePlaces(json.elements || [], loc);
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  });
}

function shapePlaces(els: OsmEl[], home: Loc): Activity[] {
  const pts = els
    .map((e) => ({ t: e.tags || {}, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, id: `osm:${e.type}/${e.id}` }))
    .filter((p): p is { t: Record<string, string>; lat: number; lng: number; id: string } => p.lat != null && p.lng != null);
  const parks = pts.filter((p) => p.t.leisure === 'park');
  const nearestPark = (p: { lat: number; lng: number }) => {
    let best: (typeof parks)[number] | null = null, bd = 0.2;
    for (const k of parks) { const d = miles(p, k); if (d < bd) { bd = d; best = k; } }
    return best;
  };
  const withPlay = new Set<string>();
  const out: Activity[] = [];
  const base = (p: (typeof pts)[number], category: Category, name: string, extra: Partial<Activity> = {}): Activity => ({
    id: p.id, name, category, lat: p.lat, lng: p.lng, sessions: [], tier: 'place', osm: true,
    free: true, price: 'Free', booking: 'drop-in', indoor: true,
    url: p.t.website || p.t['contact:website'] || '', phone: p.t.phone || p.t['contact:phone'] || '',
    schedule_note: p.t.opening_hours ? `Opening hours: ${p.t.opening_hours}` : '',
    venue: p.t['addr:street'] || '', ...extra,
  });
  for (const p of pts) {
    const t = p.t;
    if (t.leisure === 'playground') {
      const park = t.name ? null : nearestPark(p);
      if (park) withPlay.add(park.id);
      out.push(base(p, 'playground', t.name || (park ? `Playground in ${park.t.name}` : 'Playground'), { venue: park?.t.name || t['addr:street'] || '', indoor: t.indoor === 'yes' }));
    } else if (t.amenity === 'library') {
      out.push(base(p, 'libplace', t.name || 'Library', { description: 'Warm, quiet and free. Most have a children’s corner and a weekly rhyme time.' }));
    } else if (t.amenity === 'toilets') {
      out.push(base(p, 'change', t.name || 'Toilets with baby change', { venue: t['addr:street'] || nearestPark(p)?.t.name || '', free: t.fee !== 'yes', price: t.fee === 'yes' ? 'Small fee' : 'Free' }));
    } else if (t.leisure === 'sports_centre') {
      out.push(base(p, 'pool', t.name || 'Swimming pool', { free: false, price: '', booking: 'book', description: 'Leisure centre with a pool. Look for parent and baby swim sessions on their timetable.' }));
    } else if (t.leisure === 'indoor_play') {
      out.push(base(p, 'softplace', t.name || 'Soft play', { free: false, price: '' }));
    } else if (t.tourism === 'zoo') {
      out.push(base(p, 'farmplace', t.name || 'Petting farm', { indoor: false, free: t.fee !== 'yes', price: t.fee === 'yes' ? '' : 'Free' }));
    } else if (t.tourism === 'museum') {
      out.push(base(p, 'museumplace', t.name || 'Museum', { free: t.fee === 'no', price: t.fee === 'no' ? 'Free' : '' }));
    }
  }
  for (const k of parks) {
    const big = /park|fields|marsh|common|wetland|heath|wood/i.test(k.t.name);
    if (!big && !withPlay.has(k.id)) continue;
    out.push(base(k, 'park', k.t.name, { venue: withPlay.has(k.id) ? 'Has a playground' : '', indoor: false }));
  }
  return oneCardPerName(out, home);
}

/** One card per name: big parks often have several mapped playgrounds. Keeps the nearest. */
function oneCardPerName(list: Activity[], home: Loc) {
  const byName = new Map<string, Activity>();
  for (const p of list) {
    const key = `${p.category}|${p.name}`;
    const prev = byName.get(key);
    if (!prev || miles(home, p) < miles(home, prev)) byName.set(key, p);
  }
  return [...byName.values()];
}

const norm = (s?: string) => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

function dedupeAgainst(places: Activity[], curated: Activity[]) {
  return places.filter((p) => {
    if (!['park', 'libplace', 'museumplace', 'farmplace', 'softplace'].includes(p.category)) return true;
    const pn = norm(p.name);
    return !curated.some((c) => {
      const cn = norm(c.name), cv = norm(c.venue);
      return pn && miles(c, p) < 0.3 && (cn.includes(pn) || cv.includes(pn) || (cn && pn.includes(cn)));
    });
  });
}

// ---------- postcodes ----------
export async function lookupPostcode(raw: string): Promise<Loc | null> {
  const pc = raw.replace(/\s+/g, '').toUpperCase();
  if (!pc) return null;
  try {
    const j = await fetchJSON<{ status: number; result: { latitude: number; longitude: number; postcode: string } }>(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
    return { lat: j.result.latitude, lng: j.result.longitude, name: j.result.postcode, postcode: j.result.postcode };
  } catch { /* maybe a district like E17 */ }
  try {
    const j = await fetchJSON<{ status: number; result: { latitude: number; longitude: number; outcode: string } }>(`https://api.postcodes.io/outcodes/${encodeURIComponent(pc)}`);
    return { lat: j.result.latitude, lng: j.result.longitude, name: j.result.outcode, postcode: j.result.outcode };
  } catch { return null; }
}

export async function postcodeFor(lat: number, lng: number): Promise<string> {
  try {
    const j = await fetchJSON<{ result: { postcode: string }[] | null }>(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`);
    return j.result?.[0]?.postcode ?? '';
  } catch { return ''; }
}
