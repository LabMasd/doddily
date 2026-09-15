import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, F, GUTTER, R } from '@/constants/theme';
import { GROUPS } from '@/lib/categories';
import { ageLabel, babyMonths } from '@/lib/schedule';
import { useStore } from '@/lib/store';

export function FilterBar() {
  const { settings, update, toggles, flip, forKid, setForKid } = useStore();
  const kids = settings.kids.map((k) => ({ ...k, months: babyMonths(k.born) })).filter((k): k is typeof k & { months: number } => k.months != null);
  const forAge = (id: 'all' | string) => { setForKid(id); if (!toggles.ageFit) flip('ageFit'); };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} style={s.scroll}>
      {GROUPS.map((g) => (
        <Chip key={g.id} label={g.label} on={settings.group === g.id} onPress={() => update({ group: g.id })} />
      ))}
      <View style={s.sep} />
      <Chip label="Free" on={toggles.free} onColor={C.leaf} onPress={() => flip('free')} />
      <Chip label="No booking" on={toggles.drop} onColor={C.leaf} onPress={() => flip('drop')} />
      <Chip label="Rainy day" on={toggles.indoor} onColor={C.rain} onPress={() => flip('indoor')} />
      {kids.length === 1 && (
        <Chip label={`Right for ${kids[0].name || 'your child'} (${ageLabel(kids[0].months)})`} on={toggles.ageFit} onColor={C.leaf} onPress={() => flip('ageFit')} />
      )}
      {kids.length > 1 && (
        <>
          <View style={s.sep} />
          <Chip label="For everyone" on={toggles.ageFit && forKid === 'all'} onColor={C.leaf} onPress={() => forAge('all')} />
          {kids.map((k, i) => (
            <Chip key={k.id} label={`${k.name || `Child ${i + 1}`} (${ageLabel(k.months)})`} on={toggles.ageFit && forKid === k.id} onColor={C.leaf} onPress={() => forAge(k.id)} />
          ))}
          <Chip label="All ages" on={!toggles.ageFit} onColor={C.leaf} onPress={() => { if (toggles.ageFit) flip('ageFit'); }} />
        </>
      )}
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
