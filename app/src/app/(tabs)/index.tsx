import { Redirect, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityRow } from '@/components/activity-row';
import { FilterBar } from '@/components/filter-bar';
import { WeekStrip } from '@/components/week-strip';
import { C, F, GUTTER, MaxContentWidth, R } from '@/constants/theme';
import { DAY_LONG, daySections, filterRows, weekSections, type Section } from '@/lib/schedule';
import { useStore } from '@/lib/store';

export default function TodayScreen() {
  const { ready, settings, toggles, day, setDay, data, reload } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(
    () => (settings.loc ? filterRows([...data.items, ...data.places], settings.loc, settings.radius, { group: settings.group, ...toggles }, settings.born) : []),
    [data.items, data.places, settings.loc, settings.radius, settings.group, settings.born, toggles]
  );

  const view = useMemo(() => {
    if (day === 'week') {
      return { sections: weekSections(rows), summary: `${rows.length} things within ${settings.radius} miles, any day`, empty: null as null | 'done' | 'none', dayName: '' };
    }
    const r = daySections(rows, day, settings.group);
    const dayName = day === 0 ? 'today' : day === 1 ? 'tomorrow' : `on ${DAY_LONG[r.date.getDay()]}`;
    const empty = r.timedCount ? null : r.pastCount ? 'done' : 'none';
    return { sections: r.sections, summary: `${r.timedCount} session${r.timedCount === 1 ? '' : 's'} ${dayName} within ${settings.radius} miles`, empty, dayName };
  }, [rows, day, settings.group, settings.radius]);

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
        <Pressable onPress={() => router.push('/settings')} style={s.where} accessibilityRole="button" accessibilityLabel="Change location and distance">
          <Text style={s.pin}>📍</Text>
          <Text style={s.place} numberOfLines={1}>{settings.loc.name}</Text>
          <Text style={s.radius}>within {settings.radius} mi</Text>
          <Text style={s.caret}>▾</Text>
        </Pressable>
        <View style={s.gap12} />
        <WeekStrip day={day} onChange={setDay} />
        <FilterBar />
      </View>

      <SectionList<Section['data'][number], Section>
        sections={view.sections}
        keyExtractor={(r, i) => `${r.it.id}-${r.s?.day ?? ''}-${r.s?.start ?? ''}-${i}`}
        stickySectionHeadersEnabled={false}
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
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  header: { paddingHorizontal: GUTTER, paddingTop: 8, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  where: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 10 },
  pin: { fontSize: 15 },
  place: { fontFamily: F.textSemi, fontSize: 16, color: C.ink, flexShrink: 1 },
  radius: { fontFamily: F.text, fontSize: 16, color: C.muted },
  caret: { marginLeft: 'auto', color: C.muted },
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
