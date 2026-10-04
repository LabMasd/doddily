import { StyleSheet, View, type ViewStyle } from 'react-native';

const STEPS = 10;

/**
 * A soft edge: `color` at full strength on one side, thinning to nothing on the other, so whatever scrolls
 * beneath fades out instead of being cut off. Drawn as thin slices so it needs no gradient library and
 * looks the same on iPhone, Android and the web. Touches pass straight through.
 * `solid` says which side is full strength.
 */
export function Fade({ solid, size, color, style }: { solid: 'top' | 'left' | 'right'; size: number; color: string; style?: ViewStyle }) {
  const across = solid !== 'top';
  const slices = Array.from({ length: STEPS }, (_, i) => {
    const t = (STEPS - i) / STEPS; // 1 at the solid side
    return t * t; // ease, so the solid side holds a little longer
  });
  if (solid === 'right') slices.reverse();
  return (
    <View pointerEvents="none" style={[across ? { width: size, flexDirection: 'row' } : { height: size }, s.box, style]}>
      {slices.map((o, i) => <View key={i} style={{ flex: 1, backgroundColor: color, opacity: o }} />)}
    </View>
  );
}

const s = StyleSheet.create({ box: { position: 'absolute' } });
