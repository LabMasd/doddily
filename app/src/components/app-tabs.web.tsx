import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F, R } from '@/constants/theme';

// Web preview only: a floating pill tab bar like the web version.
export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <View style={s.bar}>
          <TabTrigger name="index" href="/" asChild><TabButton>Today</TabButton></TabTrigger>
          <TabTrigger name="map" href="/map" asChild><TabButton>Map</TabButton></TabTrigger>
          <TabTrigger name="saved" href="/saved" asChild><TabButton>Saved</TabButton></TabTrigger>
          <TabTrigger name="you" href="/you" asChild><TabButton>You</TabButton></TabTrigger>
        </View>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} style={[s.btn, isFocused && s.on]}>
      <Text style={[s.label, isFocused && s.labelOn]}>{children}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: { position: 'absolute', bottom: 16, alignSelf: 'center', flexDirection: 'row', gap: 4, backgroundColor: C.ink, padding: 5, borderRadius: R.pill },
  btn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: R.pill },
  on: { backgroundColor: '#fff' },
  label: { fontFamily: F.textSemi, fontSize: 15, color: '#C8CEDA' },
  labelOn: { color: C.ink },
});
