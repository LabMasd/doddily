import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { C } from '@/constants/theme';

const BREATH_MS = 3200; // one slow in-and-out
const BREATH_SCALE = 0.12;
const DEG_PER_PX = 0.6; // spin follows the scroll, so faster scrolling spins faster
const IDLE_MS = 180; // this long without scrolling and it goes back to breathing

// A five-petal flower like ✿, built from circles placed around the exact centre,
// so it turns about its middle (a text glyph sits off-centre in its line box).
export const MARK = 28;
const FLOWER = 18;
const PETAL = 7.2; // petal diameter
const RING = 5.4; // centre to petal centre; petals overlap slightly, leaving notches and a small gap in the middle
const PETALS = [0, 1, 2, 3, 4].map((i) => {
  const a = ((-90 + i * 72) * Math.PI) / 180;
  return { left: FLOWER / 2 + RING * Math.cos(a) - PETAL / 2, top: FLOWER / 2 + RING * Math.sin(a) - PETAL / 2 };
});

/** The flower in the wordmark: breathes while the list is still, spins as it scrolls. `spin` adds extra turn in degrees. */
export function BrandMark({ scrollY, spin }: { scrollY: SharedValue<number>; spin?: SharedValue<number> }) {
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);
  const now = useSharedValue(0);
  const lastScrollAt = useSharedValue(-1e9);
  const breath = useSharedValue(1); // 0 while scrolling, 1 when still
  const phase = useSharedValue(0);

  useAnimatedReaction(
    () => scrollY.value,
    (y, prev) => {
      if (prev == null || reduceMotion) return;
      rotation.value = (rotation.value + (y - prev) * DEG_PER_PX) % 360;
      lastScrollAt.value = now.value;
    }
  );

  const frame = useFrameCallback((f) => {
    const dt = f.timeSincePreviousFrame ?? 16;
    now.value = f.timestamp;
    const still = f.timestamp - lastScrollAt.value > IDLE_MS;
    breath.value += ((still ? 1 : 0) - breath.value) * Math.min(1, dt / 250);
    phase.value = (phase.value + dt / BREATH_MS) % 1;
    scale.value = 1 + BREATH_SCALE * breath.value * (0.5 - 0.5 * Math.cos(phase.value * 2 * Math.PI));
  }, false);

  // Only animate while Today is on screen, and never with Reduce Motion on.
  useFocusEffect(
    useCallback(() => {
      frame.setActive(!reduceMotion);
      return () => frame.setActive(false);
    }, [frame, reduceMotion])
  );

  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value + (spin ? spin.value : 0)}deg` }, { scale: scale.value }] }));

  return (
    <View style={s.mark}>
      <Animated.View style={[s.flower, turn]}>
        {PETALS.map((p, i) => <View key={i} style={[s.petal, p]} />)}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  mark: { width: MARK, height: MARK, borderRadius: 8, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  flower: { width: FLOWER, height: FLOWER },
  petal: { position: 'absolute', width: PETAL, height: PETAL, borderRadius: PETAL / 2, backgroundColor: C.marigold },
});
