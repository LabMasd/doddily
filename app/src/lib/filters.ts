import { CATS, GROUPS } from './categories';
import { bandById } from './schedule';
import type { Settings, Toggles } from './store';
import type { Row } from './types';

/**
 * The filters in force, as words for the screen, and how many of them the person chose.
 * "Right for <child>" is on from the start, so it is named but not counted: Clear leaves it on.
 */
export function activeFilters(settings: Settings, toggles: Toggles, forKid: 'all' | string): { labels: string[]; count: number } {
  const labels: string[] = [];
  let count = 0;
  const g = GROUPS.find((x) => x.id === settings.group);
  if (g && g.id !== 'all') { labels.push(g.label); count++; }
  if (toggles.free) { labels.push('Free'); count++; }
  if (toggles.drop) { labels.push('No booking'); count++; }
  if (toggles.indoor) { labels.push('Rainy day'); count++; }
  const kids = settings.kids;
  if (toggles.ageFit && kids.length === 1) {
    labels.push(`Right for ${kids[0].name || 'your child'} (${bandById(kids[0].band).name})`);
  } else if (toggles.ageFit && kids.length > 1) {
    const i = kids.findIndex((k) => k.id === forKid);
    if (i < 0) labels.push('Right for everyone');
    else { labels.push(`Right for ${kids[i].name || `child ${i + 1}`}`); count++; }
  } else if (!toggles.ageFit && kids.length) {
    labels.push('All ages'); count++;
  }
  return { labels, count };
}

/** Every word of the search has to appear somewhere in the listing's name, provider, venue, address or kind. */
export function searchRows(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const words = q.split(/\s+/);
  return rows.filter(({ it }) => {
    const hay = [it.name, it.provider, it.venue, it.address, it.postcode, CATS[it.category]?.label].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
