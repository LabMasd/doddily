import { SymbolView } from 'expo-symbols';
import { Redirect } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityRow } from '@/components/activity-row';
import { BrandHeader, useIntro } from '@/components/brand-header';
import { FilterBar } from '@/components/filter-bar';
import { WeekStrip } from '@/components/week-strip';
import { C, F, GUTTER, MaxContentWidth, R } from '@/constants/theme';
import { CATS } from '@/lib/categories';
import { DAY_LONG, daySections, filterRows, selectedBands, weekSections, type Section } from '@/lib/schedule';
import { useStore } from '@/lib/store';

export default function TodayScreen() {
  const { ready, settings, toggles, forKid, day, setDay, data, reload } = useStore();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const scrollY = useSharedValue(0);
  const intro = useIntro();

  const rows = useMemo(
    () => (settings.loc ? filterRows([...data.items, ...data.places], settings.loc, settings.radius, { group: settings.group, ...toggles }, selectedBands(settings.kids, forKid)) : []),
    [data.items, data.places, settings.loc, settings.radius, settings.group, settings.kids, forKid, toggles]
  );

  // Search looks across the whole week, so a class isn't hidden just because it isn't on today.
  const q = query.trim().toLowerCase();
  const found = useMemo(() => {
    if (!q) return rows;
    const words = q.split(/\s+/);
    return rows.filter(({ it }) => {
      const hay = [it.name, it.provider, it.venue, it.address, it.postcode, CATS[it.category]?.label].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, q]);

  const view = useMemo((): { sections: Section[]; summary: string; empty: null | 'done' | 'none' | 'search'; dayName: string } => {
    const where = `within ${settings.radius} mi of ${settings.loc?.name ?? 'you'}`;
    if (q) {
      const n = found.length;
      return { sections: weekSections(found), summary: `${n} match${n === 1 ? '' : 'es'} for “${query.trim()}” ${where}`, empty: n ? null : 'search', dayName: '' };
    }
    if (day === 'week') {
      return { sections: weekSections(rows), summary: `${rows.length} things ${where}, any day`, empty: null, dayName: '' };
    }
    const r = daySections(rows, day, settings.group);
    const dayName = day === 0 ? 'today' : day === 1 ? 'tomorrow' : `on ${DAY_LONG[r.date.getDay()]}`;
    const empty = r.timedCount ? null : r.pastCount ? 'done' : 'none';
    return { sections: r.sections, summary: `${r.timedCount} session${r.timedCount === 1 ? '' : 's'} ${dayName} ${where}`, empty, dayName };
  }, [rows, found, q, query, day, settings.group, settings.radius, settings.loc]);

  if (!ready) return <View style={s.screen} />;
  if (!settings.onboarded || !settings.loc) return <Redirect href="/welcome" />;

  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const checked = data.checked ? new Date(data.checked).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <BrandHeader scrollY={scrollY} t={intro.t} onReady={intro.start} />
        <Animated.View style={[s.headerRest, intro.contentStyle]}>
          <View style={s.search}>
            <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={C.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search classes, groups and places"
              placeholderTextColor={C.muted}
              returnKeyType="search"
              autoCorrect={false}
              style={s.searchInput}
              accessibilityLabel="Search classes, groups and places"
            />
            {!!query && (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <SymbolView name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }} size={18} tintColor={C.muted} />
              </Pressable>
            )}
          </View>
          <View style={s.gap12} />
          <WeekStrip day={q ? 'week' : day} onChange={(d) => { setQuery(''); setDay(d); }} />
          <FilterBar />
        </Animated.View>
      </View>

      <Animated.View style={[s.fill, intro.contentStyle]}>
        <SectionList<Section['data'][number], Section>
          sections={view.sections}
          keyExtractor={(r, i) => `${r.it.id}-${r.s?.day ?? ''}-${r.s?.start ?? ''}-${i}`}
          stickySectionHeadersEnabled={false}
          onScroll={(e) => { scrollY.value = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.muted} />}
          ListHeaderComponent={
            <View>
              <Text style={s.summary}>{data.status === 'loading' && !data.items.length ? 'Finding what’s on…' : view.summary}</Text>
              {view.empty === 'done' && (
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>That’s everything for today</Text>
                  <Pressable onPress={() => setDay(1)} style={s.emptyBtn}><Text style={s.emptyBtnText}>See tomorrow</Text></Pressable>
                </View>
              )}
              {view.empty === 'none' && data.status !== 'loading' && settings.group !== 'parks' && settings.group !== 'change' && (
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>Nothing timetabled {view.dayName}</Text>
                  <Text style={s.emptyText}>Try a wider distance, another day, or the places below.</Text>
                </View>
              )}
              {view.empty === 'search' && (
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>Nothing matches “{query.trim()}” nearby</Text>
                  <Text style={s.emptyText}>Try another word, or widen your distance in You.</Text>
                </View>
              )}
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Text style={s.sectionTitle}>
              {section.title}
              {section.count != null && <Text style={s.count}>  {section.count}</Text>}
            </Text>
          )}
          renderSectionFooter={({ section }) => (section.note ? <Text style={s.summary}>{section.note}</Text> : null)}
          renderItem={({ item, section }) => (
            <ActivityRow
              row={item}
              when={item.s && (section.key === 'timed' || section.key === 'past') ? { start: item.s.start ?? 'Time?', end: item.s.end } : null}
              faded={section.faded}
            />
          )}
          ListFooterComponent={
            <View style={s.footer}>
              {data.placesStatus === 'loading' && <Text style={s.summary}>Finding parks and playgrounds nearby…</Text>}
              {data.status === 'offline' && <Text style={s.summary}>You’re offline. Showing what was saved on this phone.</Text>}
              <Text style={s.foot}>
                {checked ? `Class times checked ${checked}. ` : ''}Timetables change, so check the provider’s page before you head out. Parks and playgrounds from OpenStreetMap.
              </Text>
            </View>
          }
        />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  header: { paddingHorizontal: GUTTER, paddingTop: 8, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', zIndex: 1 },
  headerRest: { marginTop: 10 },
  fill: { flex: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 2 },
  searchInput: { flex: 1, fontFamily: F.textMedium, fontSize: 16, color: C.ink, paddingVertical: 10 },
  gap12: { height: 12 },
  list: { paddingHorizontal: GUTTER, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  summary: { fontFamily: F.text, fontSize: 15, color: C.muted, marginTop: 8, marginBottom: 4 },
  sectionTitle: { fontFamily: F.display, fontSize: 19, color: C.ink, marginTop: 22, marginBottom: 6 },
  count: { fontFamily: F.textMedium, fontSize: 14, color: C.muted },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 6 },
  emptyTitle: { fontFamily: F.display, fontSize: 20, color: C.ink, textAlign: 'center' },
  emptyText: { fontFamily: F.text, fontSize: 15, color: C.muted, textAlign: 'center' },
  emptyBtn: { marginTop: 8, backgroundColor: C.ink, borderRadius: R.md, paddingHorizontal: 18, paddingVertical: 12 },
  emptyBtnText: { fontFamily: F.textSemi, fontSize: 16, color: '#fff' },
  footer: { marginTop: 20 },
  foot: { fontFamily: F.text, fontSize: 13, color: C.muted, marginTop: 8 },
});
