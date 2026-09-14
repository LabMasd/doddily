import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { DAY_LONG, DAYS, dateFor } from '@/lib/schedule';

type Props = { day: number | 'week'; onChange: (d: number | 'week') => void };

export function WeekStrip({ day, onChange }: Props) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = dateFor(i);
    return { key: i, top: i === 0 ? 'Today' : DAYS[d.getDay()], big: String(d.getDate()), label: `${DAY_LONG[d.getDay()]} ${d.getDate()}` };
  });
  return (
    <View style={s.row} accessibilityRole="tablist">
      {days.map((d) => {
        const on = day === d.key;
        return (
          <Pressable key={d.key} onPress={() => onChange(d.key)} style={[s.day, on && s.on]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={d.label}>
            <Text style={[s.top, on && s.topOn]}>{d.top}</Text>
            <Text style={s.big}>{d.big}</Text>
          </Pressable>
        );
      })}
      <Pressable onPress={() => onChange('week')} style={[s.day, day === 'week' && s.on]} accessibilityRole="tab" accessibilityState={{ selected: day === 'week' }} accessibilityLabel="The whole week">
        <Text style={[s.top, day === 'week' && s.topOn]}>Week</Text>
        <Text style={[s.big, s.all]}>All</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  day: { flex: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 8, borderRadius: 14 },
  on: { backgroundColor: C.marigold },
  top: { fontFamily: F.textMedium, fontSize: 12, color: C.muted },
  topOn: { color: C.ink },
  big: { fontFamily: F.display, fontSize: 20, lineHeight: 24, color: C.ink, fontVariant: ['tabular-nums'] },
  all: { fontSize: 15 },
});
