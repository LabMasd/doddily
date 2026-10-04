import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, F, GUTTER, R } from '@/constants/theme';
import { GROUPS } from '@/lib/categories';
import { activeFilters } from '@/lib/filters';
import { bandById } from '@/lib/schedule';
import { useStore } from '@/lib/store';
import { CHROME_MAX } from '@/lib/text-scale';

/**
 * The filter chips, in one row that scrolls sideways. A chip that is on can be scrolled out of sight,
 * so whenever any filter has been chosen a "Clear" pill with their number stays pinned at the start.
 * `bleed` is the side padding of whatever holds the bar: the row runs to that container's edges.
 */
export function FilterBar({ bleed = GUTTER }: { bleed?: number }) {
  const { settings, update, toggles, flip, forKid, setForKid, clearFilters } = useStore();
  const kids = settings.kids.map((k) => ({ ...k, band: bandById(k.band) }));
  const forAge = (id: 'all' | string) => { setForKid(id); if (!toggles.ageFit) flip('ageFit'); };
  const { count } = activeFilters(settings, toggles, forKid);

  // Every chip, in its usual order. `chosen` marks the ones the person picked (not the ones that are
  // simply on from the start): those move to the front of the row, so they are never scrolled out of sight.
  const chips: ChipProps[] = [
    ...GROUPS.map((g) => ({ key: g.id, label: g.label, on: settings.group === g.id, chosen: settings.group === g.id && g.id !== 'all', onPress: () => update({ group: g.id }) })),
    { key: 'free', label: 'Free', on: toggles.free, chosen: toggles.free, onColor: C.leaf, onPress: () => flip('free') },
    { key: 'drop', label: 'No booking', on: toggles.drop, chosen: toggles.drop, onColor: C.leaf, onPress: () => flip('drop') },
    { key: 'indoor', label: 'Rainy day', on: toggles.indoor, chosen: toggles.indoor, onColor: C.rain, onPress: () => flip('indoor') },
  ];
  if (kids.length === 1) {
    chips.push({ key: 'age', label: `Right for ${kids[0].name || 'your child'} (${kids[0].band.name})`, on: toggles.ageFit, chosen: false, onColor: C.leaf, onPress: () => flip('ageFit') });
  } else if (kids.length > 1) {
    chips.push({ key: 'age-all', label: 'For everyone', on: toggles.ageFit && forKid === 'all', chosen: false, onColor: C.leaf, onPress: () => forAge('all') });
    kids.forEach((k, i) => chips.push({ key: `age-${k.id}`, label: `${k.name || `Child ${i + 1}`} (${k.band.name})`, on: toggles.ageFit && forKid === k.id, chosen: toggles.ageFit && forKid === k.id, onColor: C.leaf, onPress: () => forAge(k.id) }));
    chips.push({ key: 'age-none', label: 'All ages', on: !toggles.ageFit, chosen: !toggles.ageFit, onColor: C.leaf, onPress: () => { if (toggles.ageFit) flip('ageFit'); } });
  }
  const chosen = chips.filter((c) => c.chosen);
  const rest = chips.filter((c) => !c.chosen);
  return (
    <View style={[s.wrap, { marginHorizontal: -bleed }]}>
      {count > 0 && (
        <Pressable onPress={clearFilters} style={[s.clear, { marginLeft: bleed }]} accessibilityRole="button" accessibilityLabel={`Clear ${count} filter${count === 1 ? '' : 's'}`}>
          <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={12} weight="bold" tintColor="#fff" />
          <Text style={s.clearText} maxFontSizeMultiplier={CHROME_MAX}>Clear {count}</Text>
        </Pressable>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.row, { paddingLeft: count > 0 ? 8 : bleed, paddingRight: bleed }]} style={s.scroll}>
        {chosen.map(({ key, ...c }) => <Chip key={key} {...c} />)}
        {chosen.length > 0 && <View style={s.sep} />}
        {rest.map(({ key, ...c }) => <Chip key={key} {...c} />)}
      </ScrollView>
    </View>
  );
}

type ChipProps = { key: string; label: string; on: boolean; chosen: boolean; onPress: () => void; onColor?: string };

function Chip({ label, on, onPress, onColor = C.ink }: Omit<ChipProps, 'key' | 'chosen'> & { chosen?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && { backgroundColor: onColor, borderColor: onColor }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[s.label, on && s.labelOn]} maxFontSizeMultiplier={CHROME_MAX}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  scroll: { flex: 1, flexGrow: 1 },
  row: { gap: 8 },
  chip: { borderRadius: R.pill, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, paddingHorizontal: 13, paddingVertical: 8 },
  label: { fontFamily: F.textMedium, fontSize: 15, color: C.ink },
  labelOn: { color: '#fff' },
  sep: { width: 1, backgroundColor: C.line, marginVertical: 6 },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: R.pill, backgroundColor: C.accentLine, paddingHorizontal: 12, paddingVertical: 9 },
  clearText: { fontFamily: F.textSemi, fontSize: 15, color: '#fff' },
});
