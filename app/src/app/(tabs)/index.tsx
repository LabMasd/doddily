import { Redirect, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityRow } from '@/components/activity-row';
import { BrandHeader, useIntro } from '@/components/brand-header';
import { Fade } from '@/components/fade';
import { FilterBar } from '@/components/filter-bar';
import { SearchField } from '@/components/search-field';
import { WeekStrip } from '@/components/week-strip';
import { C, F, GUTTER, MaxContentWidth, R } from '@/constants/theme';
import { activeFilters, searchRows } from '@/lib/filters';
import { DAY_LONG, daySections, filterRows, selectedBands, weekSections, type Section } from '@/lib/schedule';
import { useStore } from '@/lib/store';

export default function TodayScreen() {
  const { ready, settings, toggles, forKid, day, setDay, data, reload, query, setQuery, topTick, goTop } = useStore();
  const list = useRef<SectionList<Section['data'][number], Section>>(null);
  // Today tapped again, or another day picked: glide back to the top of the list.
  useEffect(() => { if (topTick) list.current?.getScrollResponder()?.scrollTo({ y: 0, animated: true }); }, [topTick]);
  // The iPhone tab bar does this itself when it can find the list; this covers it when it cannot.
  const navigation = useNavigation();
  useEffect(() => navigation.addListener('tabPress' as never, () => { if (navigation.isFocused()) goTop(); }), [navigation, goTop]);
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useSharedValue(0);
  const intro = useIntro();

  const rows = useMemo(
    () => (settings.loc ? filterRows([...data.items, ...data.places], settings.loc, settings.radius, { group: settings.group, ...toggles }, selectedBands(settings.kids, forKid)) : []),
    [data.items, data.places, settings.loc, settings.radius, settings.group, settings.kids, forKid, toggles]
  );

  // Search looks across the whole week, so a class isn't hidden just because it isn't on today.
  const q = query.trim().toLowerCase();
  const found = useMemo(() => searchRows(rows, query), [rows, query]);
  const filters = activeFilters(settings, toggles, forKid);

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
    // Past the first week a weekday alone is ambiguous, so the date goes with it.
    const dayName = day === 0 ? 'today' : day === 1 ? 'tomorrow' : day < 7 ? `on ${DAY_LONG[r.date.getDay()]}` : `on ${DAY_LONG[r.date.getDay()]} ${r.date.getDate()} ${r.date.toLocaleDateString('en-GB', { month: 'long' })}`;
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
          <SearchField />
          <View style={s.gap12} />
          <WeekStrip day={q ? 'week' : day} onChange={(d) => { setQuery(''); setDay(d); goTop(); }} />
          <FilterBar />
        </Animated.View>
      </View>

      <Animated.View style={[s.fill, intro.contentStyle]}>
        <SectionList<Section['data'][number], Section>
          ref={list}
          sections={view.sections}
          keyExtractor={(r, i) => `${r.it.id}-${r.s?.day ?? ''}-${r.s?.start ?? ''}-${i}`}
          stickySectionHeadersEnabled={false}
          onScroll={(e) => { scrollY.value = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={[s.list, { paddingTop: 14, paddingBottom: insets.bottom + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.muted} />}
          ListHeaderComponent={
            <View>
              <Text style={s.summary}>{data.status === 'loading' && !data.items.length ? 'Finding what’s on…' : view.summary}</Text>
              {filters.labels.length > 0 && (
                <Text style={s.showing} accessibilityLabel={`Filters on: ${filters.labels.join(', ')}`}>
                  Showing <Text style={s.showingOn}>{filters.labels.join(' · ')}</Text>
                </Text>
              )}
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
        {/* The list slides under the filters: let it fade out there instead of being cut off mid-line. */}
        <Fade solid="top" size={22} color={C.milk} style={{ top: 0, left: 0, right: 0 }} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  header: { paddingHorizontal: GUTTER, paddingTop: 8, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', zIndex: 1 },
  headerRest: { marginTop: 10 },
  fill: { flex: 1 },
  gap12: { height: 12 },
  list: { paddingHorizontal: GUTTER, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  summary: { fontFamily: F.text, fontSize: 15, color: C.muted, marginTop: 8, marginBottom: 4 },
  showing: { fontFamily: F.text, fontSize: 15, color: C.muted, marginBottom: 4 },
  showingOn: { fontFamily: F.textSemi, color: C.ink },
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
