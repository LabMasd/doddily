import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { GroupId } from './categories';
import { loadActivities, loadPlaces } from './data';
import type { Activity, Loc } from './types';

const KEY = 'ld:settings:v1';
const SAVED_KEY = 'ld:saved:v1';

export type Settings = { loc: Loc | null; radius: number; born: string | null; group: GroupId; onboarded: boolean };
type Toggles = { free: boolean; drop: boolean; indoor: boolean; ageFit: boolean };
type Status = 'idle' | 'loading' | 'ready' | 'offline';

type Ctx = {
  ready: boolean;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  toggles: Toggles;
  flip: (k: keyof Toggles) => void;
  day: number | 'week';
  setDay: (d: number | 'week') => void;
  saved: Record<string, Activity>;
  toggleSaved: (it: Activity) => void;
  data: { items: Activity[]; places: Activity[]; checked: string; status: Status; placesStatus: Status };
  reload: () => Promise<void>;
};

const StoreContext = createContext<Ctx | null>(null);

const DEFAULTS: Settings = { loc: null, radius: 3, born: null, group: 'all', onboarded: false };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [toggles, setToggles] = useState<Toggles>({ free: false, drop: false, indoor: false, ageFit: true });
  const [day, setDay] = useState<number | 'week'>(0);
  const [saved, setSaved] = useState<Record<string, Activity>>({});
  const [data, setData] = useState<Ctx['data']>({ items: [], places: [], checked: '', status: 'idle', placesStatus: 'idle' });
  const loadId = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const [s, sv] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(SAVED_KEY)]);
        // Always open on Everything; a remembered filter makes the list look empty days later.
        if (s) setSettings({ ...DEFAULTS, ...JSON.parse(s), group: 'all' });
        if (sv) setSaved(JSON.parse(sv));
      } catch { /* start fresh */ }
      setReady(true);
    })();
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const toggleSaved = useCallback((it: Activity) => {
    setSaved((prev) => {
      const next = { ...prev };
      if (next[it.id]) delete next[it.id];
      else next[it.id] = it;
      AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const { loc, radius } = settings;
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
  }, [loc, radius]);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo<Ctx>(() => ({
    ready, settings, update, toggles,
    flip: (k) => setToggles((t) => ({ ...t, [k]: !t[k] })),
    day, setDay, saved, toggleSaved, data, reload,
  }), [ready, settings, update, toggles, day, saved, toggleSaved, data, reload]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
