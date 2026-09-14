import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityRow } from '@/components/activity-row';
import { C, F, GUTTER, MaxContentWidth } from '@/constants/theme';
import { miles } from '@/lib/geo';
import { useStore } from '@/lib/store';

export default function SavedScreen() {
  const { saved, settings } = useStore();
  const insets = useSafeAreaInsets();
  const rows = useMemo(() => {
    const list = Object.values(saved).map((it) => ({ it, d: settings.loc ? miles(settings.loc, it) : 0 }));
    return list.sort((a, b) => a.d - b.d);
  }, [saved, settings.loc]);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.it.id}
        contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
        ListHeaderComponent={<Text style={s.title}>Saved</Text>}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Nothing saved yet</Text>
            <Text style={s.emptyText}>Open anything you like the look of and tap Save. It stays here, even offline.</Text>
          </View>
        }
        renderItem={({ item }) => <ActivityRow row={item} />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  list: { paddingHorizontal: GUTTER, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  title: { fontFamily: F.display, fontSize: 30, color: C.ink, marginTop: 12, marginBottom: 10 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyTitle: { fontFamily: F.display, fontSize: 20, color: C.ink },
  emptyText: { fontFamily: F.text, fontSize: 15, color: C.muted, textAlign: 'center', maxWidth: 300 },
});
