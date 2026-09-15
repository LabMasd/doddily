import { useMemo } from 'react';

import { daySections, filterRows, selectedAges } from './schedule';
import { useStore } from './store';
import type { Row } from './types';

/** What the Map shows: the chosen day's (or week's) filtered listings, one pin per activity, at most 300. */
export function useMapRows() {
  const { settings, toggles, forKid, day, data } = useStore();
  return useMemo(() => {
    if (!settings.loc) return [] as Row[];
    const all = filterRows([...data.items, ...data.places], settings.loc, settings.radius, { group: settings.group, ...toggles }, selectedAges(settings.kids, forKid));
    const list = day === 'week' ? all : daySections(all, day, settings.group).sections.filter((x) => x.key !== 'past').flatMap((x) => x.data);
    const seen = new Set<string>();
    return list.filter((r) => (seen.has(r.it.id) ? false : (seen.add(r.it.id), true))).slice(0, 300);
  }, [data.items, data.places, settings, toggles, forKid, day]);
}
