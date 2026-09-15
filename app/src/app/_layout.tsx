import { BricolageGrotesque_500Medium, BricolageGrotesque_700Bold, useFonts } from '@expo-google-fonts/bricolage-grotesque';
import { Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold } from '@expo-google-fonts/figtree';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { C } from '@/constants/theme';
import { hydrateReminderActivities } from '@/lib/reminders';
import { StoreProvider } from '@/lib/store';

SplashScreen.preventAutoHideAsync();

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export default function RootLayout() {
  const router = useRouter();
  const [loaded] = useFonts({ BricolageGrotesque_500Medium, BricolageGrotesque_700Bold, Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  // Tapping a class reminder opens that class.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (id?: unknown) => {
      if (typeof id === 'string') hydrateReminderActivities().then(() => router.push({ pathname: '/activity/[id]', params: { id } }));
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data?.id);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.id));
    return () => sub.remove();
  }, [router]);

  if (!loaded) return <View style={[s.page, { backgroundColor: C.milk }]} />;

  const app = (
    <StoreProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.milk } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="activity/[id]"
          options={{ headerShown: true, title: '', headerBackTitle: 'Back', headerTintColor: C.ink, headerShadowVisible: false, headerStyle: { backgroundColor: C.milk } }}
        />
        <Stack.Screen
          name="settings"
          options={{ presentation: 'formSheet', sheetAllowedDetents: [0.85], sheetGrabberVisible: true, contentStyle: { backgroundColor: C.card } }}
        />
        <Stack.Screen name="welcome" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      </Stack>
    </StoreProvider>
  );

  // On the web, show the app at phone width so it looks like the iPhone version on a computer too.
  if (Platform.OS !== 'web') return app;
  return (
    <View style={s.page}>
      <View style={s.phone}>{app}</View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', backgroundColor: '#E7EAF0' },
  phone: { flex: 1, width: '100%', maxWidth: 430, backgroundColor: C.milk, overflow: 'hidden', boxShadow: '0 0 40px rgba(30,37,54,0.10)' },
});
