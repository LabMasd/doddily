import { GROUPS, QUIET_IN_ALL, type GroupId } from './categories';
import { miles } from './geo';
import type { AgeBandId, Activity, Day, Kid, Loc, Row } from './types';

export const DAYS: Day[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as Day[];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Filters = { group: GroupId; free: boolean; drop: boolean; indoor: boolean; ageFit: boolean };

export type Section = { key: string; title: string; count?: number; data: Row[]; faded?: boolean; note?: string };

const toMin = (t?: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

export function dateFor(offset: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}


export function ageText(it: Activity) {
  const a = it.age_min_months ?? 0, b = it.age_max_months;
  if (b == null || b >= 60) return a ? `${a}m+` : 'All ages';
  if (b <= 24) return `${a}–${b} months`;
  return `${a}m – ${Math.round(b / 12)} yrs`;
}

export function sessionsText(it: Activity) {
  return it.sessions.map((s) => `${s.day}${s.start ? ' ' + s.start : ''}${s.end ? '–' + s.end : ''}`).join(', ');
}

/** Right for a child of `months`: not too young for it, not too old. */


/** Ages in months of the children the list is filtered for. */
/**
 * The age bands a parent picks from. They line up with how providers write their own
 * ranges (0-6, 6-12, 12-24 months and so on), so matching stays honest without a birthday.
 */
export const BANDS: { id: AgeBandId; name: string; range: string; min: number; max: number }[] = [
  { id: 'u6', name: 'Newborns', range: 'Under 6 months', min: 0, max: 6 },
  { id: '6to12', name: 'Babies', range: '6-12 months', min: 6, max: 12 },
  { id: '1to2', name: 'Toddlers', range: '1-2 years', min: 12, max: 24 },
  { id: '2to3', name: 'Older toddlers', range: '2-3 years', min: 24, max: 36 },
  { id: '3to5', name: 'Pre-school', range: '3-5 years', min: 36, max: 60 },
];

export const bandById = (id: AgeBandId) => BANDS.find((b) => b.id === id) ?? BANDS[2];

/** The band a child of this many months falls into. Only used to carry old settings over. */
export function bandForMonths(months: number): AgeBandId {
  return (BANDS.find((b) => months >= b.min && months < b.max) ?? BANDS[BANDS.length - 1]).id;
}

/** True when a session's own age range overlaps the band at all. */
export function fitsBand(it: Activity, band: { min: number; max: number }) {
  const lo = it.age_min_months ?? 0;
  const hi = it.age_max_months ?? Infinity;
  return lo < band.max && hi > band.min;
}

export function selectedBands(kids: Kid[], forKid: 'all' | string) {
  const chosen = forKid === 'all' ? kids : kids.filter((k) => k.id === forKid);
  return chosen.map((k) => bandById(k.band));
}

/** `ages`: months of the selected children; an activity shows if it suits any of them. */
export function filterRows(items: Activity[], loc: Loc, radius: number, f: Filters, bands: { min: number; max: number }[]): Row[] {
  const g = GROUPS.find((x) => x.id === f.group)!;
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) continue;
    const d = miles(loc, it);
    if (d > radius) continue;
    if (g.cats && !g.cats.includes(it.category)) continue;
    if (g.id === 'all' && (QUIET_IN_ALL.includes(it.category) || (it.category === 'park' && !it.venue))) continue;
    if (f.free && !it.free) continue;
    if (f.drop && it.booking !== 'drop-in') continue;
    if (f.indoor && !it.indoor) continue;
    if (f.ageFit && bands.length && !it.osm && !bands.some((b) => fitsBand(it, b))) continue;
    seen.add(it.id);
    rows.push({ it, d });
  }
  return rows;
}

/** Sessions on one day in time order, then classes without published times, then places. */
export function daySections(rows: Row[], offset: number, group: GroupId, now = new Date()) {
  const date = dateFor(offset);
  const wd = DAYS[date.getDay()];
  const nowMin = offset === 0 ? now.getHours() * 60 + now.getMinutes() : -1;
  const timed: Row[] = [], past: Row[] = [], venues: Row[] = [], anytime: Row[] = [];

  for (const r of rows) {
    const today = r.it.sessions.filter((s) => s.day === wd);
    if (today.length) {
      for (const s of today) {
        // A session with no start time can't sit in the timetable; show it with "check times".
        if (!s.start) { venues.push(r); break; }
        const end = toMin(s.end) ?? (toMin(s.start) ?? 0) + 60;
        (s.start && end < nowMin ? past : timed).push({ ...r, s });
      }
    } else if (!r.it.sessions.length) {
      (r.it.tier === 'venue' ? venues : anytime).push(r);
    }
  }
  const byTime = (a: Row, b: Row) => (toMin(a.s?.start) ?? 9999) - (toMin(b.s?.start) ?? 9999) || a.d - b.d;
  const byDist = (a: Row, b: Row) => a.d - b.d;
  timed.sort(byTime); past.sort(byTime); venues.sort(byDist); anytime.sort(byDist);

  let anyShown = anytime;
  if (group === 'all') {
    // Everything view: every researched outing, plus only the nearest few parks.
    anyShown = [...anytime.filter((r) => !r.it.osm), ...anytime.filter((r) => r.it.osm).slice(0, 8)].sort(byDist);
  }
  const cap = group === 'all' ? 12 : 80;

  const sections: Section[] = [];
  if (timed.length) sections.push({ key: 'timed', title: 'Sessions', data: timed });
  if (venues.length) sections.push({ key: 'venues', title: 'Classes nearby, check times', count: venues.length, data: venues.slice(0, cap), note: venues.length > cap ? `Showing the closest ${cap}. Pick a category to see more.` : undefined });
  if (anyShown.length) sections.push({ key: 'any', title: 'Go any time', count: anyShown.length, data: anyShown.slice(0, group === 'all' ? 25 : 80) });
  if (past.length) sections.push({ key: 'past', title: 'Earlier today', count: past.length, data: past, faded: true });

  return { sections, timedCount: timed.length, pastCount: past.length, date, weekday: wd };
}

/** Whole week: grouped by category group, nearest first. */
export function weekSections(rows: Row[]): Section[] {
  const out: Section[] = [];
  for (const g of GROUPS) {
    if (!g.cats) continue;
    const data = rows.filter((r) => g.cats!.includes(r.it.category)).sort((a, b) => a.d - b.d);
    if (data.length) out.push({ key: g.id, title: g.label, count: data.length, data: data.slice(0, 80) });
  }
  return out;
}
