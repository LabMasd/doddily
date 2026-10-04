import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { DAY_LONG, DAYS, dateFor } from '@/lib/schedule';
import { CHROME_MAX } from '@/lib/text-scale';

type Props = { day: number | 'week'; onChange: (d: number | 'week') => void };

/** How far ahead a parent can look: four weeks, and no further. */
export const WEEKS_AHEAD = 4;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const GAP = 4;

const describe = (i: number) => {
  const d = dateFor(i);
  const first = d.getDate() === 1 && i > 0;
  return {
    key: i,
    // The first of a month says so, the way a calendar does, or the numbers would run 30, 31, 1 with no clue.
    top: i === 0 ? 'Today' : first ? MONTHS[d.getMonth()] : DAYS[d.getDay()],
    month: first,
    big: String(d.getDate()),
    label: `${DAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`,
  };
};

/**
 * "All" first, then one week of days. The little arrow underneath drops down the next four weeks as a
 * calendar; picking a day there closes it and the bar moves to that day's week.
 */
export function WeekStrip({ day, onChange }: Props) {
  const [open, setOpen] = useState(false);
  // Which week the bar shows. It follows the chosen day, and stays put while "All" is on.
  const [week, setWeek] = useState(typeof day === 'number' ? Math.floor(day / 7) : 0);
  useEffect(() => { if (typeof day === 'number') setWeek(Math.floor(day / 7)); }, [day]);

  const pick = (d: number | 'week') => { setOpen(false); onChange(d); };
  const all = day === 'week';

  return (
    <View>
      <View style={s.row} accessibilityRole="tablist">
        <Pressable onPress={() => pick('week')} style={[s.day, all && s.on]} accessibilityRole="tab" accessibilityState={{ selected: all }} accessibilityLabel="Everything, any day">
          <Text style={[s.top, all && s.topOn]} maxFontSizeMultiplier={CHROME_MAX} numberOfLines={1}>All</Text>
          <Text style={[s.big, s.all]} maxFontSizeMultiplier={CHROME_MAX}>days</Text>
        </Pressable>
        {Array.from({ length: 7 }, (_, i) => describe(week * 7 + i)).map((d) => {
          const on = day === d.key;
          return (
            <Pressable key={d.key} onPress={() => pick(d.key)} style={[s.day, on && s.on]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={d.label}>
              <Text style={[s.top, d.month && s.month, on && s.topOn]} maxFontSizeMultiplier={CHROME_MAX} numberOfLines={1}>{d.top}</Text>
              <Text style={s.big} maxFontSizeMultiplier={CHROME_MAX}>{d.big}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={{ top: 4, bottom: 6, left: 40, right: 40 }} style={s.arrow} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? 'Close the calendar' : 'Show the next four weeks'}>
        <SymbolView name={open ? { ios: 'chevron.up', android: 'keyboard_arrow_up', web: 'keyboard_arrow_up' } : { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={14} weight="semibold" tintColor={C.muted} />
      </Pressable>

      {open && (
        <View style={s.cal}>
          <View style={s.row}>
            {Array.from({ length: 7 }, (_, i) => (
              <Text key={i} style={s.head} maxFontSizeMultiplier={CHROME_MAX}>{DAYS[dateFor(i).getDay()]}</Text>
            ))}
          </View>
          {Array.from({ length: WEEKS_AHEAD }, (_, w) => (
            <View key={w} style={[s.row, w === week && !all && s.weekOn]}>
              {Array.from({ length: 7 }, (_, i) => describe(w * 7 + i)).map((d) => {
                const on = day === d.key;
                return (
                  <Pressable key={d.key} onPress={() => pick(d.key)} style={[s.cell, on && s.on]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={d.label}>
                    {d.month && <Text style={s.calMonth} maxFontSizeMultiplier={CHROME_MAX}>{d.top}</Text>}
                    <Text style={[s.calNum, d.key === 0 && s.today]} maxFontSizeMultiplier={CHROME_MAX}>{d.big}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP },
  day: { flex: 1, minWidth: 0, alignItems: 'center', paddingTop: 6, paddingBottom: 8, borderRadius: 14 },
  on: { backgroundColor: C.accent },
  top: { fontFamily: F.textMedium, fontSize: 12, color: C.muted },
  month: { fontFamily: F.textSemi, color: C.accentText },
  topOn: { color: C.ink },
  big: { fontFamily: F.display, fontSize: 20, color: C.ink, fontVariant: ['tabular-nums'] },
  all: { fontSize: 15, lineHeight: 24 },
  arrow: { alignSelf: 'center', width: 44, height: 18, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  cal: { gap: 2, marginTop: 4, paddingTop: 8, paddingBottom: 4, borderTopWidth: 1, borderTopColor: C.line },
  head: { flex: 1, textAlign: 'center', fontFamily: F.textMedium, fontSize: 12, color: C.muted, paddingBottom: 4 },
  weekOn: { backgroundColor: C.accentSoft, borderRadius: 12 },
  cell: { flex: 1, minWidth: 0, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  calMonth: { fontFamily: F.textSemi, fontSize: 10, lineHeight: 11, color: C.accentText },
  calNum: { fontFamily: F.display, fontSize: 17, color: C.ink, fontVariant: ['tabular-nums'] },
  today: { textDecorationLine: 'underline' },
});
