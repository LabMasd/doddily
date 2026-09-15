import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { LocationForm } from '@/components/location-form';
import { C, F, MaxContentWidth } from '@/constants/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const still = useSharedValue(0); // nothing scrolls here, so the flower only breathes
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <BrandMark scrollY={still} size={64 / 28} />
        <Text style={s.title}>Doddily</Text>
        <Text style={s.sub}>Baby and toddler classes, groups and places near you, sorted by day and time.</Text>
        <View style={s.card}>
          <LocationForm submitLabel="Show what’s on" onDone={() => router.replace('/')} askChild />
        </View>
        <Text style={s.privacy}>Your location stays on this phone. It’s only used to find things nearby.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  content: { paddingHorizontal: 20, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  title: { fontFamily: F.display, fontSize: 40, lineHeight: 44, color: C.ink, marginTop: 20 },
  sub: { fontFamily: F.text, fontSize: 18, lineHeight: 25, color: C.muted, marginTop: 8, maxWidth: 360 },
  card: { backgroundColor: C.card, borderRadius: 20, padding: 18, marginTop: 28, borderWidth: 1, borderColor: C.line },
  privacy: { fontFamily: F.text, fontSize: 13, color: C.muted, marginTop: 16, textAlign: 'center' },
});
