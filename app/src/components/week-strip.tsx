import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { C, F } from '@/constants/theme';
import { DAY_LONG, DAYS, dateFor } from '@/lib/schedule';
import { CHROME_MAX } from '@/lib/text-scale';

type Props = { day: number | 'week'; onChange: (d: number | 'week') => void };

/** How far ahead a parent can look: four weeks, and no further. */
export const WEEKS_AHEAD = 4;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const GAP = 4;
// The calendar slides open and shut instead of appearing: a little longer to open so it settles, quicker to close.
const OPEN_MS = 420;
const CLOSE_MS = 360;
const OPENING = Easing.bezierFn(0.22, 1, 0.36, 1); // quick start, long gentle settle, the same curve the header uses
const CLOSING = Easing.bezierFn(0.45, 0, 0.2, 1); // starts gently, so it never snaps shut, then eases to rest

const describe = (i: number) => {
  const d = dateFor(i);
  const first = d.getDate() === 1 && i !== 0;
  return {
    key: i,
    // The first of a month says so, the way a calendar does, or the numbers would run 30, 31, 1 with no clue.
    top: i === 0 ? 'Today' : first ? MONTHS[d.getMonth()] : DAYS[d.getDay()],
    month: first,
    big: String(d.getDate()),
    label: `${DAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`,
  };
};

/** Weeks run Monday to Sunday. How many days into its week today is: 0 on a Monday, 6 on a Sunday. */
const intoWeek = () => (new Date().getDay() + 6) % 7;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * One week of days, Monday to Sunday, then "All" at the end (Victoria, 5 Oct: it felt wrong at the start). Days of this week that have already gone are greyed out.
 * The calendar under the arrow shows one month, Monday first, weekends in a quieter grey. The little arrow underneath drops down the next four weeks as a
 * calendar; picking a day there closes it and the bar moves to that day's week.
 * The calendar stays mounted and its height, fade and the arrow's turn are animated, so opening and closing are eased
 * (Marcos, 6 Oct: it closed abruptly). With Reduce Motion on it simply appears.
 */
export function WeekStrip({ day, onChange }: Props) {
  const [open, setOpen] = useState(false);
  // Which week the bar shows. It follows the chosen day, and stays put while "All" is on.
  const lead = intoWeek();
  const weekOf = (d: number) => Math.floor((d + lead) / 7);
  const [week, setWeek] = useState(typeof day === 'number' ? weekOf(day) : 0);
  useEffect(() => { if (typeof day === 'number') setWeek(weekOf(day)); }, [day]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The seven days of a week, as days from today; a negative one has already gone. */
  const daysOf = (w: number) => Array.from({ length: 7 }, (_, i) => describe(w * 7 - lead + i));

  const pick = (d: number | 'week') => { setOpen(false); onChange(d); };

  // The calendar: which month it shows (0 is this month), and how far ahead a day can be picked.
  const today = dateFor(0);
  const furthest = WEEKS_AHEAD * 7 - lead - 1;
  const monthsTo = (offset: number) => { const d = dateFor(offset); return (d.getFullYear() - today.getFullYear()) * 12 + d.getMonth() - today.getMonth(); };
  const lastMonth = monthsTo(furthest);
  const [month, setMonth] = useState(0);
  // It opens on the month of the day that is chosen, or of the week in the bar.
  const toggle = () => { if (!open) setMonth(monthsTo(typeof day === 'number' ? day : Math.max(0, week * 7 - lead))); setOpen((o) => !o); };
  const all = day === 'week';

  // 0 is shut, 1 is fully open. The calendar's own height is measured, because a five-row month is shorter than a six-row one.
  const calm = useReducedMotion();
  const openness = useSharedValue(0);
  const calHeight = useSharedValue(0);
  useEffect(() => {
    openness.value = withTiming(open ? 1 : 0, { duration: calm ? 0 : open ? OPEN_MS : CLOSE_MS, easing: open ? OPENING : CLOSING });
  }, [open, calm, openness]);
  const onCalLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    // the first measure is taken as it is; after that a change of month eases to its new height
    calHeight.value = calHeight.value === 0 || calm ? h : withTiming(h, { duration: 220, easing: CLOSING });
  };
  const drawer = useAnimatedStyle(() => ({ height: calHeight.value * openness.value, opacity: openness.value }));
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${openness.value * 180}deg` }] }));

  return (
    <View>
      <View style={s.row} accessibilityRole="tablist">
        {daysOf(week).map((d) => {
          const on = day === d.key;
          const gone = d.key < 0;
          return (
            <Pressable key={d.key} onPress={() => pick(d.key)} disabled={gone} style={[s.day, on && s.on, gone && s.gone]} accessibilityRole="tab" accessibilityState={gone ? { selected: false, disabled: true } : { selected: on }} accessibilityLabel={d.label}>
              <Text style={[s.top, d.month && s.month, on && s.topOn]} maxFontSizeMultiplier={CHROME_MAX} numberOfLines={1}>{d.top}</Text>
              <Text style={s.big} maxFontSizeMultiplier={CHROME_MAX}>{d.big}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => pick('week')} style={[s.day, s.allTab, all && s.on]} accessibilityRole="tab" accessibilityState={{ selected: all }} accessibilityLabel="All, any day">
          <Text style={[s.big, s.all]} maxFontSizeMultiplier={CHROME_MAX} numberOfLines={1}>All</Text>
        </Pressable>
      </View>

      <Pressable onPress={toggle} hitSlop={{ top: 4, bottom: 6, left: 40, right: 40 }} style={s.arrow} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? 'Close the calendar' : 'Open the calendar'}>
        <Animated.View style={turn}>
          <SymbolView name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={14} weight="semibold" tintColor={C.muted} />
        </Animated.View>
      </Pressable>

      {(() => {
        // One month at a time, Monday first, like a wall calendar. Days outside the month, days already gone and
        // days more than four weeks away are greyed out and cannot be picked.
        const first = new Date(today.getFullYear(), today.getMonth() + month, 1);
        const inMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        const before = (first.getDay() + 6) % 7;
        const rows = Math.ceil((before + inMonth) / 7);
        const startOffset = Math.round((first.getTime() - today.getTime()) / 864e5) - before;
        return (
          <Animated.View style={[s.drawer, drawer]} pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
          <View style={s.calWrap} onLayout={onCalLayout}>
          <View style={s.cal}>
            <View style={s.calHead}>
              <Pressable onPress={() => setMonth(0)} disabled={month === 0} hitSlop={8} style={[s.step, month === 0 && s.gone]} accessibilityRole="button" accessibilityLabel="Earlier month">
                <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={13} weight="semibold" tintColor={C.ink} />
              </Pressable>
              <Text style={s.calTitle} maxFontSizeMultiplier={CHROME_MAX}>{MONTH_LONG[first.getMonth()]} {first.getFullYear()}</Text>
              <Pressable onPress={() => setMonth(lastMonth)} disabled={month >= lastMonth} hitSlop={8} style={[s.step, month >= lastMonth && s.gone]} accessibilityRole="button" accessibilityLabel="Later month">
                <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={13} weight="semibold" tintColor={C.ink} />
              </Pressable>
            </View>
            <View style={s.row}>
              {WEEKDAYS.map((w, i) => <Text key={w} style={[s.head, i > 4 && s.weekend]} maxFontSizeMultiplier={CHROME_MAX}>{w}</Text>)}
            </View>
            {Array.from({ length: rows }, (_, r) => (
              <View key={r} style={s.row}>
                {Array.from({ length: 7 }, (_, c) => {
                  const offset = startOffset + r * 7 + c;
                  const d = describe(offset);
                  const outside = r * 7 + c < before || r * 7 + c >= before + inMonth;
                  const off = outside || offset < 0 || offset > furthest;
                  const on = day === offset && !outside;
                  return (
                    <Pressable key={c} onPress={() => pick(offset)} disabled={off} style={[s.cell, off && s.gone]} accessibilityRole="button" accessibilityState={{ selected: on, disabled: off }} accessibilityLabel={d.label}>
                      <View style={[s.dot, offset === 0 && !outside && s.todayDot, on && s.onDot]}>
                        <Text style={[s.calNum, c > 4 && !on && s.weekend]} maxFontSizeMultiplier={CHROME_MAX}>{d.big}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
          </View>
          </Animated.View>
        );
      })()}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP },
  day: { flex: 1, minWidth: 0, alignItems: 'center', paddingTop: 6, paddingBottom: 8, borderRadius: 14 },
  on: { backgroundColor: C.accent },
  gone: { opacity: 0.32 },
  top: { fontFamily: F.textMedium, fontSize: 12, color: C.muted },
  month: { fontFamily: F.textSemi, color: C.accentText },
  topOn: { color: C.ink },
  big: { fontFamily: F.display, fontSize: 20, color: C.ink, fontVariant: ['tabular-nums'] },
  allTab: { justifyContent: 'center', paddingTop: 0, paddingBottom: 0 },
  all: { fontSize: 16 },
  arrow: { alignSelf: 'center', width: 44, height: 18, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  // The drawer's height is animated; the calendar inside is laid out at its full height and clipped, so it can be measured while shut.
  drawer: { overflow: 'hidden' },
  calWrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 4 },
  cal: { gap: 2, paddingTop: 10, paddingBottom: 4, borderTopWidth: 1, borderTopColor: C.line },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingBottom: 8 },
  calTitle: { fontFamily: F.display, fontSize: 17, color: C.ink },
  step: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.chip },
  head: { flex: 1, textAlign: 'center', fontFamily: F.textMedium, fontSize: 12, color: C.ink, paddingBottom: 4 },
  weekend: { color: C.muted },
  cell: { flex: 1, minWidth: 0, height: 42, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  todayDot: { borderWidth: 1.5, borderColor: C.ink },
  onDot: { backgroundColor: C.accent, borderColor: C.accent },
  calNum: { fontFamily: F.display, fontSize: 16, color: C.ink, fontVariant: ['tabular-nums'] },
});
