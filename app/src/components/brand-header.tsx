import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark, MARK } from '@/components/brand-mark';
import { C, F } from '@/constants/theme';

// Opening sequence: the icon pops in, winds back and sweeps round in the middle of the screen,
// "Little" and "Days" slide out either side, and the wordmark rises to the top, where it stays.

// Arrivals decelerate, travel eases both ways.
const EASE_OUT = Easing.bezierFn(0.22, 1, 0.36, 1); // quick start, long gentle settle
const TRAVEL = Easing.bezierFn(0.7, 0, 0.2, 1); // moving across the screen
const POP = Easing.out(Easing.back(1.6)); // grows just past full size, then settles
const WIND_UP = Easing.bezierFn(0.45, 0, 0.55, 1); // small, soft turn backwards
const RELEASE = Easing.bezierFn(0.16, 1, 0.3, 1); // quick sweep forward, long soft settle

const DURATION = 2100;
const P = {
  appear: [0, 550],
  windUp: [0, 200],
  spin: [200, 1100],
  little: [350, 950],
  days: [420, 1020], // a beat after "Little"
  up: [1050, 1750],
  content: [1350, 2100],
} as const;
const ROW = 40; // height of the header row
const HEADER_TOP = 8; // matches the Today header's paddingTop
const GAP = 6; // between the icon and "Little" / "Days"
const WIND_DEG = -14;
const SPIN_DEG = 216; // three petals' worth: the five-petal flower ends looking as it started
const APPEAR_SCALE = 0.4;
const CENTRE_SCALE = 1.8;
const WORD_BOX = 120; // room for "Little" / "Days" beside the icon

let played = false; // once per app launch

/** 0 → 1 over one phase of the intro, shaped by `ease`. */
function seg(ms: number, [a, b]: readonly [number, number], ease: (x: number) => number) {
  'worklet';
  return ease(Math.min(1, Math.max(0, (ms - a) / (b - a))));
}

/** The intro clock, plus a style that fades the rest of the screen in as the wordmark rises. */
export function useIntro() {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(played || reduceMotion ? DURATION : 0);
  const start = () => {
    if (played || reduceMotion) return;
    played = true;
    t.value = withTiming(DURATION, { duration: DURATION, easing: Easing.linear });
  };
  const contentStyle = useAnimatedStyle(() => {
    const p = seg(t.value, P.content, EASE_OUT);
    return { opacity: p, transform: [{ translateY: (1 - p) * 16 }] };
  });
  return { t, start, contentStyle };
}

/** "Little ✿ Days", centred at the top of Today, with the opening sequence. */
export function BrandHeader({ scrollY, t, onReady }: { scrollY: SharedValue<number>; t: SharedValue<number>; onReady: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const littleW = useSharedValue(0);
  const daysW = useSharedValue(0);
  const centreY = height / 2 - (insets.top + HEADER_TOP + ROW / 2);

  // Winds back a little as it pops in, then sweeps forward and settles.
  const spin = useDerivedValue(() => WIND_DEG * seg(t.value, P.windUp, WIND_UP) + (SPIN_DEG - WIND_DEG) * seg(t.value, P.spin, RELEASE));

  const group = useAnimatedStyle(() => {
    const appear = seg(t.value, P.appear, POP);
    const up = seg(t.value, P.up, TRAVEL);
    const centre = APPEAR_SCALE + (CENTRE_SCALE - APPEAR_SCALE) * appear;
    return {
      opacity: Math.min(1, t.value / 150),
      transform: [{ translateY: centreY * (1 - up) }, { scale: centre + (1 - centre) * up }],
    };
  });

  // Each style reads t.value itself, so Reanimated knows to update it as the clock runs.
  const little = useAnimatedStyle(() => ({
    opacity: littleW.value ? 1 : 0,
    transform: [{ translateX: (1 - seg(t.value, P.little, EASE_OUT)) * (littleW.value + GAP) }],
  }));
  const days = useAnimatedStyle(() => ({
    opacity: daysW.value ? 1 : 0,
    transform: [{ translateX: -(1 - seg(t.value, P.days, EASE_OUT)) * (daysW.value + GAP) }],
  }));

  return (
    <View style={s.row} accessibilityRole="header" accessibilityLabel="Little Days" onLayout={() => onReady()}>
      <Animated.View style={[s.group, group]}>
        <View style={[s.mask, s.littleMask]}>
          <Animated.Text style={[s.word, little]} numberOfLines={1} onLayout={(e) => { littleW.value = e.nativeEvent.layout.width; }}>Little</Animated.Text>
        </View>
        <View style={[s.mask, s.daysMask]}>
          <Animated.Text style={[s.word, days]} numberOfLines={1} onLayout={(e) => { daysW.value = e.nativeEvent.layout.width; }}>Days</Animated.Text>
        </View>
        {/* Last, so the words slide out from behind the icon. */}
        <BrandMark scrollY={scrollY} spin={spin} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { height: ROW, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  group: { width: MARK, height: MARK },
  // Masks get explicit widths: on iOS an absolute child of the 28pt group is otherwise squeezed to that width.
  mask: { position: 'absolute', top: -8, bottom: -8, justifyContent: 'center', overflow: 'hidden' },
  littleMask: { right: MARK + GAP, width: WORD_BOX, alignItems: 'flex-end' },
  daysMask: { left: MARK + GAP, width: WORD_BOX, alignItems: 'flex-start' },
  word: { fontFamily: F.display, fontSize: 16, color: C.ink },
});
