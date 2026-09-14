import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, F, GUTTER, R } from '@/constants/theme';
import { GROUPS } from '@/lib/categories';
import { babyMonths } from '@/lib/schedule';
import { useStore } from '@/lib/store';

export function FilterBar() {
  const { settings, update, toggles, flip } = useStore();
  const age = babyMonths(settings.born);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} style={s.scroll}>
      {GROUPS.map((g) => (
        <Chip key={g.id} label={g.label} on={settings.group === g.id} onPress={() => update({ group: g.id })} />
      ))}
      <View style={s.sep} />
      <Chip label="Free" on={toggles.free} onColor={C.leaf} onPress={() => flip('free')} />
      <Chip label="No booking" on={toggles.drop} onColor={C.leaf} onPress={() => flip('drop')} />
      <Chip label="Rainy day" on={toggles.indoor} onColor={C.rain} onPress={() => flip('indoor')} />
      {age != null && <Chip label={`Right for ${age} months`} on={toggles.ageFit} onColor={C.leaf} onPress={() => flip('ageFit')} />}
    </ScrollView>
  );
}

function Chip({ label, on, onPress, onColor = C.ink }: { label: string; on: boolean; onPress: () => void; onColor?: string }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && { backgroundColor: onColor, borderColor: onColor }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[s.label, on && s.labelOn]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  scroll: { marginHorizontal: -GUTTER, flexGrow: 0 },
  row: { gap: 8, paddingHorizontal: GUTTER, paddingTop: 10, paddingBottom: 6 },
  chip: { borderRadius: R.pill, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, paddingHorizontal: 13, paddingVertical: 8 },
  label: { fontFamily: F.textMedium, fontSize: 15, color: C.ink },
  labelOn: { color: '#fff' },
  sep: { width: 1, backgroundColor: C.line, marginVertical: 6 },
});
