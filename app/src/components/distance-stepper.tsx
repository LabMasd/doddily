import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { DIST_STEPS, nearestStep } from '@/lib/geo';
import { useStore } from '@/lib/store';

/** Change how far to look without leaving the map. It is the same distance as in the You tab, so the list follows. */
export function DistanceStepper() {
  const { settings, update } = useStore();
  const i = nearestStep(settings.radius);
  const go = (to: number) => update({ radius: DIST_STEPS[Math.max(0, Math.min(DIST_STEPS.length - 1, to))] });
  const less = i > 0, more = i < DIST_STEPS.length - 1;
  return (
    <View style={s.row} accessibilityRole="adjustable" accessibilityLabel="Distance" accessibilityValue={{ text: `${settings.radius} miles` }}>
      <Pressable onPress={() => go(i - 1)} disabled={!less} hitSlop={8} style={[s.btn, !less && s.off]} accessibilityRole="button" accessibilityLabel="Nearer">
        <Text style={s.sign} allowFontScaling={false}>−</Text>
      </Pressable>
      <Text style={s.value}>{settings.radius} mi</Text>
      <Pressable onPress={() => go(i + 1)} disabled={!more} hitSlop={8} style={[s.btn, !more && s.off]} accessibilityRole="button" accessibilityLabel="Further">
        <Text style={s.sign} allowFontScaling={false}>+</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.milk, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.35 },
  sign: { fontFamily: F.textSemi, fontSize: 17, lineHeight: 20, color: C.ink },
  value: { fontFamily: F.textSemi, fontSize: 14, color: C.ink, minWidth: 48, textAlign: 'center' },
});
