import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WeekStrip } from '@/components/week-strip';
import { C, F, GUTTER, R } from '@/constants/theme';
import { CATS } from '@/lib/categories';
import { MI } from '@/lib/geo';
import { useMapRows } from '@/lib/map-rows';
import { useStore } from '@/lib/store';

// Web only: the same map as the phone app (pins, distance circle, week strip), drawn with Leaflet and OpenStreetMap tiles.
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
const doc = (globalThis as any).document;
let leaflet: Promise<any> | null = null;

function loadLeaflet(): Promise<any> {
  if (!leaflet) {
    leaflet = new Promise((resolve, reject) => {
      const css = doc.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${LEAFLET}leaflet.min.css`;
      const look = doc.createElement('style');
      // Keep the credit clear of the tab bar, and give popups the app's type.
      look.textContent = `.leaflet-bottom{bottom:84px}.leaflet-popup-content{margin:12px 14px;font-family:${F.text},system-ui,sans-serif;font-size:14px;line-height:1.35;color:${C.ink}}.leaflet-popup-content b{display:block;font-family:${F.textSemi},system-ui,sans-serif;font-size:15px}.dd-open{margin-top:8px;border:0;border-radius:999px;background:${C.ink};color:#fff;padding:7px 12px;font:600 13px ${F.textSemi},system-ui,sans-serif;cursor:pointer}`;
      const js = doc.createElement('script');
      js.src = `${LEAFLET}leaflet.min.js`;
      js.onload = () => resolve((globalThis as any).L);
      js.onerror = reject;
      doc.head.append(css, look, js);
    });
  }
  return leaflet;
}

export default function MapScreen() {
  const { ready, settings, day, setDay } = useStore();
  const rows = useMapRows();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const box = useRef<any>(null);
  const map = useRef<any>(null);
  const pins = useRef<any>(null);
  const [L, setL] = useState<any>(null);
  const loc = settings.loc;
  const showing = ready && settings.onboarded && !!loc;

  useEffect(() => {
    loadLeaflet().then(setL).catch(() => {});
  }, []);

  // The map itself, made once its box is on the page.
  useEffect(() => {
    if (!L || !showing || !box.current) return;
    const m = L.map(box.current, { zoomControl: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
    pins.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [L, showing]);

  // Frame the distance circle when the place or distance changes.
  useEffect(() => {
    const m = map.current;
    if (!m || !loc) return;
    // Wait a frame so the map knows its real size before framing, otherwise it zooms out too far.
    const t = setTimeout(() => {
      m.invalidateSize();
      m.fitBounds(L.latLng(loc.lat, loc.lng).toBounds(settings.radius * MI * 2), { padding: [16, 16] });
    }, 60);
    return () => clearTimeout(t);
  }, [L, showing, loc?.lat, loc?.lng, settings.radius]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pins: the same emoji badges as the phone; tap one for its name and a link to the details.
  useEffect(() => {
    const m = map.current;
    if (!m || !loc) return;
    const g = pins.current;
    g.clearLayers();
    L.circle([loc.lat, loc.lng], { radius: settings.radius * MI, color: C.accentLine, weight: 2, fillColor: C.accentLine, fillOpacity: 0.08, interactive: false }).addTo(g);
    for (const r of rows) {
      const place = !!r.it.osm;
      const size = place ? 26 : 32;
      const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#fff;border:${place ? '1.5px solid #8A93A6' : `2px solid ${C.ink}`};display:flex;align-items:center;justify-content:center;font-size:${place ? 13 : 16}px;box-sizing:border-box">${CATS[r.it.category]?.e ?? '📍'}</div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
      const pop = doc.createElement('div');
      const name = doc.createElement('b');
      name.textContent = r.it.name;
      const when = doc.createElement('div');
      when.textContent = r.s?.start ? `${r.s.start}${r.s.end ? '–' + r.s.end : ''}` : CATS[r.it.category]?.label ?? '';
      const open = doc.createElement('button');
      open.className = 'dd-open';
      open.textContent = 'See details';
      open.onclick = () => router.push({ pathname: '/activity/[id]', params: { id: r.it.id } });
      pop.append(name, when, open);
      L.marker([r.it.lat, r.it.lng], { icon, title: r.it.name }).bindPopup(pop).addTo(g);
    }
  }, [L, showing, rows, loc, settings.radius, router]);

  // Leaflet measures its box when made; re-measure when the tab comes back into view.
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(() => map.current?.invalidateSize(), 50);
      return () => clearTimeout(t);
    }, [])
  );

  if (!ready) return <View style={s.screen} />;
  if (!settings.onboarded || !loc) return <Redirect href="/welcome" />;

  return (
    <View style={s.screen}>
      <div ref={box} style={{ position: 'absolute', inset: 0, background: '#E8ECF1' }} />
      <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={s.card}>
          <WeekStrip day={day} onChange={setDay} />
          <Text style={s.count}>{rows.length} on the map · tap a pin for details</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  top: { position: 'absolute', left: 0, right: 0, paddingHorizontal: GUTTER, zIndex: 1000 },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 8, boxShadow: '0 4px 12px rgba(30,37,54,0.12)' },
  count: { fontFamily: F.text, fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 4 },
});
