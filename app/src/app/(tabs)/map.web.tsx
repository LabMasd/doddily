import { StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';

// Native maps only exist on iPhone and Android; the web preview shows a note instead.
export default function MapScreen() {
  return (
    <View style={s.screen}>
      <Text style={s.title}>The map is in the phone app</Text>
      <Text style={s.text}>On iPhone it uses Apple Maps, on Android Google Maps.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.milk, padding: 24 },
  title: { fontFamily: F.display, fontSize: 20, color: C.ink },
  text: { fontFamily: F.text, fontSize: 15, color: C.muted, textAlign: 'center' },
});
