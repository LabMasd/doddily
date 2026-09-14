import { GROUPS, QUIET_IN_ALL, type GroupId } from './categories';
import { miles } from './geo';
import type { Activity, Day, Loc, Row } from './types';

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

export function babyMonths(born: string | null) {
  if (!born) return null;
  const [y, m] = born.split('-').map(Number);
  const now = new Date();
  return Math.max(0, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m));
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

export function filterRows(items: Activity[], loc: Loc, radius: number, f: Filters, born: string | null): Row[] {
  const g = GROUPS.find((x) => x.id === f.group)!;
  const age = babyMonths(born);
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
    if (f.ageFit && age != null && !it.osm) {
      if ((it.age_min_months ?? 0) > age + 1) continue;
      if (it.age_max_months != null && it.age_max_months < age) continue;
    }
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
