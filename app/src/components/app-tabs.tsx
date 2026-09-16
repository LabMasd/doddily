import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { C } from '@/constants/theme';

export default function AppTabs() {
  return (
    // The selected tab uses the brand purple rather than the system blue.
    <NativeTabs
      backgroundColor={C.card}
      indicatorColor={C.accentSoft}
      tintColor={C.accentLine}
      disableTransparentOnScrollEdge // iOS 26 otherwise hides the bar background when the list scrolls under it
      iconColor={{ default: C.ink, selected: C.accentLine }}
      labelStyle={{ default: { color: C.ink }, selected: { color: C.ink } }}>
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
      <NativeTabs.Trigger name="you">
        <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/you.png')} renderingMode="template" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
