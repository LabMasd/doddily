import { BricolageGrotesque_500Medium, BricolageGrotesque_700Bold, useFonts } from '@expo-google-fonts/bricolage-grotesque';
import { Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold } from '@expo-google-fonts/figtree';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { C } from '@/constants/theme';
import { StoreProvider } from '@/lib/store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({ BricolageGrotesque_500Medium, BricolageGrotesque_700Bold, Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
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
}
