import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { GroupId } from './categories';
import { dropListingCache, loadActivities, loadPlaces } from './data';
import type { Activity, Kid, Loc, MapApp } from './types';
import { bandForMonths, daySections, filterRows, selectedBands } from './schedule';

const KEY = 'ld:settings:v1';
const SAVED_KEY = 'ld:saved:v1';

export type Settings = { loc: Loc | null; radius: number; group: GroupId; onboarded: boolean; name: string; kids: Kid[]; mapApp: MapApp };
export type Toggles = { free: boolean; drop: boolean; indoor: boolean; ageFit: boolean };
type Status = 'idle' | 'loading' | 'ready' | 'offline';

type Ctx = {
  ready: boolean;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  toggles: Toggles;
  flip: (k: keyof Toggles) => void;
  /** Which child the list is filtered for. */
  forKid: 'all' | string;
  setForKid: (id: 'all' | string) => void;
  /** Back to how the app opens: everything, right for the children, no other filter. */
  clearFilters: () => void;
  /** What is typed in search. Shared, so the list and the map show the same things. */
  query: string;
  setQuery: (q: string) => void;
  day: number | 'week';
  setDay: (d: number | 'week') => void;
  /** Goes up by one each time the list should return to its top (Today tapped again, another day picked). */
  topTick: number;
  goTop: () => void;
  saved: Record<string, Activity>;
  toggleSaved: (it: Activity) => void;
  data: { items: Activity[]; places: Activity[]; checked: string; status: Status; placesStatus: Status };
  reload: () => Promise<void>;
};

const StoreContext = createContext<Ctx | null>(null);

const DEFAULTS: Settings = { loc: null, radius: 10, group: 'all', onboarded: false, name: '', kids: [], mapApp: Platform.OS === 'ios' ? 'apple' : 'google' };

/** What the family typed must survive closing the app. If storage is full, the downloaded listings go, not this. */
async function keep(key: string, value: unknown) {
  const text = JSON.stringify(value);
  try { await AsyncStorage.setItem(key, text); }
  catch {
    await dropListingCache();
    try { await AsyncStorage.setItem(key, text); } catch { /* storage is unavailable (private browsing); nothing more to try */ }
  }
}

/** From this hour, a day with no sessions left counts as over. */
const EVENING_HOUR = 18;

export const newKidId = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [toggles, setToggles] = useState<Toggles>({ free: false, drop: false, indoor: false, ageFit: true });
  const [day, setDayRaw] = useState<number | 'week'>(0);
  // Once the person has picked a day themselves, the app never moves it for them.
  const pickedDay = useRef(false);
  const eveningChecked = useRef(false);
  const setDay = useCallback((d: number | 'week') => { pickedDay.current = true; setDayRaw(d); }, []);
  const [topTick, setTopTick] = useState(0);
  const goTop = useCallback(() => setTopTick((n) => n + 1), []);
  const [forKid, setForKid] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState<Record<string, Activity>>({});
  const [data, setData] = useState<Ctx['data']>({ items: [], places: [], checked: '', status: 'idle', placesStatus: 'idle' });
  const loadId = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const [s, sv] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(SAVED_KEY)]);
        // Always open on Everything; a remembered filter makes the list look empty days later.
        if (s) {
          const raw = JSON.parse(s);
          // Older settings stored a birth month; turn it into the band that month falls in.
          const monthsSince = (born: string) => {
            const [y, m] = born.split("-").map(Number);
            const now = new Date();
            return Math.max(0, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m));
          };
          const oldKids: { id: string; name: string; born?: string; band?: Kid["band"] }[] =
            raw.kids ?? (raw.born ? [{ id: "k1", name: "", born: raw.born }] : []);
          const kids: Kid[] = oldKids.map((k) => ({
            id: k.id,
            name: k.name,
            band: k.band ?? (k.born ? bandForMonths(monthsSince(k.born)) : "1to2"),
          }));
          delete raw.born;
          setSettings({ ...DEFAULTS, ...raw, kids, group: 'all' });
        }
        if (sv) setSaved(JSON.parse(sv));
      } catch { /* start fresh */ }
      setReady(true);
    })();
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      keep(KEY, next);
      return next;
    });
  }, []);

  const toggleSaved = useCallback((it: Activity) => {
    setSaved((prev) => {
      const next = { ...prev };
      if (next[it.id]) delete next[it.id];
      else next[it.id] = it;
      keep(SAVED_KEY, next);
      return next;
    });
  }, []);

  const { loc, radius, kids } = settings;
  const reload = useCallback(async () => {
    if (!loc) return;
    const id = ++loadId.current;
    setData((d) => ({ ...d, status: 'loading', placesStatus: 'loading' }));
    let items: Activity[] = [];
    try {
      const res = await loadActivities(loc, radius);
      items = res.items;
      if (id !== loadId.current) return;
      setData((d) => ({ ...d, items, checked: res.checked, status: 'ready' }));
      // Opened in the evening with nothing left today: start on tomorrow, not on an empty list.
      // Only on the first load after opening, and never once the person has chosen a day.
      if (!eveningChecked.current) {
        eveningChecked.current = true;
        if (!pickedDay.current && new Date().getHours() >= EVENING_HOUR) {
          const rows = filterRows(items, loc, radius, { group: 'all', free: false, drop: false, indoor: false, ageFit: true }, selectedBands(kids, 'all'));
          if (daySections(rows, 0, 'all').timedCount === 0) setDayRaw(1);
        }
      }
      // A saved class is a copy made on the day it was saved. Bring the copies up to date with what was
      // just loaded, so a changed time or price doesn't stay wrong in Saved.
      const fresh = new Map(items.map((it) => [it.id, it]));
      setSaved((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const k of Object.keys(prev)) {
          const now = fresh.get(k);
          if (now && JSON.stringify(now) !== JSON.stringify(prev[k])) { next[k] = now; changed = true; }
        }
        if (changed) keep(SAVED_KEY, next);
        return changed ? next : prev;
      });
    } catch {
      if (id !== loadId.current) return;
      setData((d) => ({ ...d, status: 'offline' }));
    }
    try {
      const places = await loadPlaces(loc, radius, items);
      if (id !== loadId.current) return;
      setData((d) => ({ ...d, places, placesStatus: 'ready' }));
    } catch {
      if (id !== loadId.current) return;
      setData((d) => ({ ...d, placesStatus: 'offline' }));
    }
  }, [loc, radius]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reload(); }, [reload]);

  const clearFilters = useCallback(() => {
    update({ group: 'all' });
    setToggles({ free: false, drop: false, indoor: false, ageFit: true });
    setForKid('all');
  }, [update]);

  const value = useMemo<Ctx>(() => ({
    ready, settings, update, toggles,
    flip: (k) => setToggles((t) => ({ ...t, [k]: !t[k] })),
    forKid, setForKid, clearFilters, query, setQuery,
    day, setDay, topTick, goTop, saved, toggleSaved, data, reload,
  }), [ready, settings, update, toggles, forKid, clearFilters, query, day, setDay, topTick, goTop, saved, toggleSaved, data, reload]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
