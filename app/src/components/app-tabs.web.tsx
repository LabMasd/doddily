import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { C, F } from '@/constants/theme';

// Web only: drawn to match the iPhone's floating tab bar (same icons, labels and selected state).
const BLUE = '#0A84FF';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <View style={s.bar}>
          <TabTrigger name="index" href="/" asChild><TabButton icon={require('@/assets/images/tabIcons/today.png')}>Today</TabButton></TabTrigger>
          <TabTrigger name="map" href="/map" asChild><TabButton icon={require('@/assets/images/tabIcons/map.png')}>Map</TabButton></TabTrigger>
          <TabTrigger name="saved" href="/saved" asChild><TabButton icon={require('@/assets/images/tabIcons/saved.png')}>Saved</TabButton></TabTrigger>
          <TabTrigger name="you" href="/you" asChild><TabButton icon={require('@/assets/images/tabIcons/you.png')}>You</TabButton></TabTrigger>
        </View>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, icon, isFocused, ...props }: TabTriggerSlotProps & { icon: ImageSourcePropType }) {
  return (
    <Pressable {...props} style={[s.btn, isFocused && s.on]}>
      <Image source={icon} style={[s.icon, { tintColor: isFocused ? BLUE : C.ink }]} />
      <Text style={s.label}>{children}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 14,
    flexDirection: 'row',
    padding: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    boxShadow: '0 8px 30px rgba(30,37,54,0.14)',
    backdropFilter: 'blur(18px) saturate(1.6)',
  },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 7, borderRadius: 999 },
  on: { backgroundColor: 'rgba(118,118,128,0.14)' },
  icon: { width: 26, height: 26 },
  label: { fontFamily: F.textSemi, fontSize: 11, color: C.ink },
});
