import { Redirect, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WeekStrip } from '@/components/week-strip';
import { C, F, GUTTER, R } from '@/constants/theme';
import { CATS } from '@/lib/categories';
import { MI } from '@/lib/geo';
import { daySections, filterRows } from '@/lib/schedule';
import { useStore } from '@/lib/store';
import type { Row } from '@/lib/types';

export default function MapScreen() {
  const { ready, settings, toggles, day, setDay, data } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const rows = useMemo(() => {
    if (!settings.loc) return [] as Row[];
    const all = filterRows([...data.items, ...data.places], settings.loc, settings.radius, { group: settings.group, ...toggles }, settings.born);
    const list = day === 'week' ? all : daySections(all, day, settings.group).sections.filter((x) => x.key !== 'past').flatMap((x) => x.data);
    const seen = new Set<string>();
    return list.filter((r) => (seen.has(r.it.id) ? false : (seen.add(r.it.id), true))).slice(0, 300);
  }, [data.items, data.places, settings, toggles, day]);

  if (!ready) return <View style={s.screen} />;
  if (!settings.onboarded || !settings.loc) return <Redirect href="/welcome" />;

  const { lat, lng } = settings.loc;
  const span = (settings.radius / 69) * 2.4;

  return (
    <View style={s.screen}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: span, longitudeDelta: span / Math.cos((lat * Math.PI) / 180) }}
        showsUserLocation
        showsPointsOfInterests={false}>
        <Circle center={{ latitude: lat, longitude: lng }} radius={settings.radius * MI} strokeColor={C.marigold} strokeWidth={2} fillColor="rgba(242,160,7,0.06)" />
        {rows.map((r) => (
          <Marker
            key={r.it.id}
            coordinate={{ latitude: r.it.lat, longitude: r.it.lng }}
            title={r.it.name}
            description={r.s?.start ? `${r.s.start}${r.s.end ? '–' + r.s.end : ''}` : CATS[r.it.category]?.label}
            onCalloutPress={() => router.push({ pathname: '/activity/[id]', params: { id: r.it.id } })}
            tracksViewChanges={false}>
            <View style={[s.pin, r.it.osm && s.pinPlace]}>
              <Text style={r.it.osm ? s.emojiSmall : s.emoji}>{CATS[r.it.category]?.e ?? '📍'}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
      <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={s.card}>
          <WeekStrip day={day} onChange={setDay} />
          <Text style={s.count}>{rows.length} on the map · tap a pin, then its name</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  top: { position: 'absolute', left: 0, right: 0, paddingHorizontal: GUTTER },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 8, shadowColor: '#1E2536', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  count: { fontFamily: F.text, fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 4 },
  pin: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  pinPlace: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: '#8A93A6' },
  emoji: { fontSize: 16 },
  emojiSmall: { fontSize: 13 },
});
