import { useMemo } from 'react';

import { searchRows } from './filters';
import { daySections, filterRows, selectedBands } from './schedule';
import { useStore } from './store';
import type { Row } from './types';

/** What the Map shows: the chosen day's (or week's) filtered listings, one pin per activity, at most 300.
 *  A search looks across the whole week, as it does in the list. */
export function useMapRows() {
  const { settings, toggles, forKid, day, data, query } = useStore();
  return useMemo(() => {
    if (!settings.loc) return [] as Row[];
    const all = filterRows([...data.items, ...data.places], settings.loc, settings.radius, { group: settings.group, ...toggles }, selectedBands(settings.kids, forKid));
    const searching = !!query.trim();
    const list = searching ? searchRows(all, query) : day === 'week' ? all : daySections(all, day, settings.group).sections.filter((x) => x.key !== 'past').flatMap((x) => x.data);
    const seen = new Set<string>();
    return list.filter((r) => (seen.has(r.it.id) ? false : (seen.add(r.it.id), true))).slice(0, 300);
  }, [data.items, data.places, settings, toggles, forKid, day, query]);
}
