import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DistanceStepper } from '@/components/distance-stepper';
import { FilterBar } from '@/components/filter-bar';
import { SearchField } from '@/components/search-field';
import { WeekStrip } from '@/components/week-strip';
import { C, F, GUTTER, R } from '@/constants/theme';
import { CATS } from '@/lib/categories';
import { activeFilters } from '@/lib/filters';
import { MI } from '@/lib/geo';
import { useMapRows } from '@/lib/map-rows';
import { useStore } from '@/lib/store';

const CARD_PAD = 8;

export default function MapScreen() {
  const { ready, settings, toggles, forKid, day, setDay, query, setQuery } = useStore();
  const filters = activeFilters(settings, toggles, forKid);
  const rows = useMapRows();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const home = settings.loc;

  // Frame the distance circle again when the place or the distance changes.
  useEffect(() => {
    if (!home) return;
    const d = (settings.radius / 69) * 2.4;
    map.current?.animateToRegion({ latitude: home.lat, longitude: home.lng, latitudeDelta: d, longitudeDelta: d / Math.cos((home.lat * Math.PI) / 180) }, 350);
  }, [home?.lat, home?.lng, settings.radius]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <View style={s.screen} />;
  if (!settings.onboarded || !settings.loc) return <Redirect href="/welcome" />;

  const { lat, lng } = settings.loc;
  const span = (settings.radius / 69) * 2.4;

  return (
    <View style={s.screen}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: span, longitudeDelta: span / Math.cos((lat * Math.PI) / 180) }}
        showsUserLocation
        showsPointsOfInterests={false}>
        <Circle center={{ latitude: lat, longitude: lng }} radius={settings.radius * MI} strokeColor={C.accentLine} strokeWidth={2} fillColor="rgba(138,111,214,0.08)" />
        {rows.map((r) => (
          <Marker
            key={r.it.id}
            coordinate={{ latitude: r.it.lat, longitude: r.it.lng }}
            title={r.it.name}
            description={r.s?.start ? `${r.s.start}${r.s.end ? '–' + r.s.end : ''}` : CATS[r.it.category]?.label}
            onCalloutPress={() => router.push({ pathname: '/activity/[id]', params: { id: r.it.id } })}
            tracksViewChanges={false}>
            <View style={[s.pin, r.it.osm && s.pinPlace]}>
              <Text style={r.it.osm ? s.emojiSmall : s.emoji} allowFontScaling={false}>{CATS[r.it.category]?.e ?? '📍'}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
      <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={s.card}>
          <SearchField />
          <View style={s.gap8} />
          <WeekStrip day={query.trim() ? 'week' : day} onChange={(d) => { setQuery(''); setDay(d); }} />
          <FilterBar bleed={CARD_PAD} surface={C.card} />
          <View style={s.foot}>
            <Text style={s.count} numberOfLines={1}>{rows.length} on the map · {filters.count ? filters.labels.join(' · ') : 'tap a pin, then its name'}</Text>
            <DistanceStepper />
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  top: { position: 'absolute', left: 0, right: 0, paddingHorizontal: GUTTER },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: CARD_PAD, overflow: 'hidden', shadowColor: '#1E2536', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  gap8: { height: 8 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingLeft: 6 },
  count: { flex: 1, minWidth: 0, fontFamily: F.text, fontSize: 13, color: C.muted },
  pin: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  pinPlace: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: '#8A93A6' },
  emoji: { fontSize: 16 },
  emojiSmall: { fontSize: 13 },
});
