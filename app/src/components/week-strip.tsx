import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { DAY_LONG, DAYS, dateFor } from '@/lib/schedule';
import { CHROME_MAX, useTextScale } from '@/lib/text-scale';

type Props = { day: number | 'week'; onChange: (d: number | 'week') => void };

export function WeekStrip({ day, onChange }: Props) {
  const { chrome, roomy } = useTextScale();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = dateFor(i);
    return { key: i, top: i === 0 ? 'Today' : DAYS[d.getDay()], big: String(d.getDate()), label: `${DAY_LONG[d.getDay()]} ${d.getDate()}` };
  });
  // Eight equal columns only fit at ordinary text sizes. With larger text each day gets the width
  // its words need and the strip scrolls sideways.
  const cell = roomy ? [s.day, s.dayRoomy, { minWidth: 46 * chrome }] : [s.day, s.dayFit];
  const strip = (
    <>
      {days.map((d) => {
        const on = day === d.key;
        return (
          <Pressable key={d.key} onPress={() => onChange(d.key)} style={[cell, on && s.on]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={d.label}>
            <Text style={[s.top, on && s.topOn]} maxFontSizeMultiplier={CHROME_MAX} numberOfLines={1}>{d.top}</Text>
            <Text style={s.big} maxFontSizeMultiplier={CHROME_MAX}>{d.big}</Text>
          </Pressable>
        );
      })}
      <Pressable onPress={() => onChange('week')} style={[cell, day === 'week' && s.on]} accessibilityRole="tab" accessibilityState={{ selected: day === 'week' }} accessibilityLabel="The whole week">
        <Text style={[s.top, day === 'week' && s.topOn]} maxFontSizeMultiplier={CHROME_MAX} numberOfLines={1}>Week</Text>
        <Text style={[s.big, s.all]} maxFontSizeMultiplier={CHROME_MAX}>All</Text>
      </Pressable>
    </>
  );
  if (roomy) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} accessibilityRole="tablist">
        {strip}
      </ScrollView>
    );
  }
  return <View style={s.row} accessibilityRole="tablist">{strip}</View>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  day: { alignItems: 'center', paddingTop: 6, paddingBottom: 8, borderRadius: 14 },
  dayFit: { flex: 1 },
  dayRoomy: { paddingHorizontal: 10 },
  on: { backgroundColor: C.accent },
  top: { fontFamily: F.textMedium, fontSize: 12, color: C.muted },
  topOn: { color: C.ink },
  big: { fontFamily: F.display, fontSize: 20, color: C.ink, fontVariant: ['tabular-nums'] },
  all: { fontSize: 15, lineHeight: 24 },
});
