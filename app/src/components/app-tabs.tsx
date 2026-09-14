import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { C } from '@/constants/theme';

export default function AppTabs() {
  return (
    <NativeTabs backgroundColor={C.card} indicatorColor={C.marigoldSoft} labelStyle={{ selected: { color: C.ink } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/today.png')} renderingMode="template" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="map">
        <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/map.png')} renderingMode="template" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/saved.png')} renderingMode="template" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
