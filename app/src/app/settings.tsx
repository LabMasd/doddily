import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { LocationForm } from '@/components/location-form';
import { C, F } from '@/constants/theme';

export default function SettingsScreen() {
  const router = useRouter();
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Where and how far</Text>
      <Text style={s.sub}>Saved on this phone only.</Text>
      <LocationForm submitLabel="Save" onDone={() => router.back()} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.card },
  content: { padding: 20, paddingTop: 28 },
  title: { fontFamily: F.display, fontSize: 26, color: C.ink },
  sub: { fontFamily: F.text, fontSize: 15, color: C.muted, marginTop: 2, marginBottom: 18 },
});
