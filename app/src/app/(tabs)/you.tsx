import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocationForm } from '@/components/location-form';
import { C, F, GUTTER, MaxContentWidth, R } from '@/constants/theme';
import { MAP_APPS } from '@/lib/actions';
import { BANDS } from '@/lib/schedule';
import { newKidId, useStore } from '@/lib/store';
import type { Kid } from '@/lib/types';


export default function YouScreen() {
  const { settings, update } = useStore();
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState(false);

  const setKids = (kids: Kid[]) => update({ kids });
  const addKid = () => setKids([...settings.kids, { id: newKidId(), name: '', band: '1to2' }]);

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 110 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>You</Text>
        <Text style={s.sub}>Saved on this phone only. It helps Today show what suits your family.</Text>

        <Text style={s.section}>Where</Text>
        <View style={s.card}>
          <LocationForm
            submitLabel={saved ? 'Saved' : 'Save location'}
            onDone={() => {
              setSaved(true);
              setTimeout(() => setSaved(false), 1800);
            }}
          />
        </View>

        <Text style={s.section}>Directions</Text>
        <Text style={s.hint}>The app that opens when you tap Directions.</Text>
        <View style={s.options}>
          {MAP_APPS.map((m) => {
            const on = settings.mapApp === m.id;
            return (
              <Pressable key={m.id} onPress={() => update({ mapApp: m.id })} style={[s.option, on && s.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Text style={[s.optionText, on && s.optionTextOn]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.section}>Children</Text>
        {settings.kids.length === 0 && <Text style={s.hint}>Add your children so Today only shows classes that suit their ages.</Text>}
        {settings.kids.map((k, i) => (
          <KidCard
            key={k.id}
            kid={k}
            index={i}
            onChange={(next) => setKids(settings.kids.map((x) => (x.id === k.id ? next : x)))}
            onRemove={() => setKids(settings.kids.filter((x) => x.id !== k.id))}
          />
        ))}
        <Pressable onPress={addKid} style={({ pressed }) => [s.add, pressed && s.pressed]} accessibilityRole="button">
          <Text style={s.addText}>+ Add a child</Text>
        </Pressable>

        <Text style={s.section}>Your name</Text>
        <TextInput
          value={settings.name}
          onChangeText={(name) => update({ name })}
          placeholder="Optional"
          placeholderTextColor={C.muted}
          autoCapitalize="words"
          textContentType="givenName"
          style={s.input}
          accessibilityLabel="Your name"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function KidCard({ kid, index, onChange, onRemove }: { kid: Kid; index: number; onChange: (k: Kid) => void; onRemove: () => void }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <TextInput
          value={kid.name}
          onChangeText={(name) => onChange({ ...kid, name })}
          placeholder={`Child ${index + 1}’s name`}
          placeholderTextColor={C.muted}
          autoCapitalize="words"
          style={[s.input, s.kidName]}
          accessibilityLabel={`Child ${index + 1} name`}
        />
        <Pressable onPress={onRemove} style={s.remove} accessibilityRole="button" accessibilityLabel={`Remove ${kid.name || `child ${index + 1}`}`}>
          <Text style={s.removeText}>Remove</Text>
        </Pressable>
      </View>
      <Text style={s.small}>How old are they?</Text>
      <View style={s.bands}>
        {BANDS.map((b) => {
          const on = kid.band === b.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => onChange({ ...kid, band: b.id })}
              style={[s.band, on && s.bandOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${b.name}, ${b.range}`}>
              <Text style={[s.bandName, on && s.bandTextOn]}>{b.name}</Text>
              <Text style={[s.bandRange, on && s.bandTextOn]}>{b.range}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  content: { paddingHorizontal: GUTTER, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  title: { fontFamily: F.display, fontSize: 30, color: C.ink },
  sub: { fontFamily: F.text, fontSize: 15, color: C.muted, marginTop: 4 },
  section: { fontFamily: F.display, fontSize: 19, color: C.ink, marginTop: 26, marginBottom: 8 },
  hint: { fontFamily: F.text, fontSize: 15, color: C.muted, marginBottom: 10 },
  input: { fontFamily: F.textMedium, fontSize: 17, color: C.ink, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 12 },
  card: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 10, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kidName: { flex: 1, backgroundColor: C.milk },
  remove: { paddingHorizontal: 8, paddingVertical: 10 },
  removeText: { fontFamily: F.textSemi, fontSize: 15, color: C.warn },
  small: { fontFamily: F.textMedium, fontSize: 14, color: C.muted, marginTop: 4 },
  bands: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  band: { borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.milk, paddingHorizontal: 12, paddingVertical: 8 },
  bandOn: { backgroundColor: C.ink, borderColor: C.ink },
  bandName: { fontFamily: F.textSemi, fontSize: 15, color: C.ink },
  bandRange: { fontFamily: F.text, fontSize: 12, color: C.muted, marginTop: 1 },
  bandTextOn: { color: '#fff' },
  add: { borderRadius: R.md, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed', paddingVertical: 14, alignItems: 'center', backgroundColor: C.card },
  addText: { fontFamily: F.textSemi, fontSize: 16, color: C.ink },
  pressed: { opacity: 0.8 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderRadius: R.pill, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, paddingHorizontal: 14, paddingVertical: 10 },
  optionOn: { backgroundColor: C.ink, borderColor: C.ink },
  optionText: { fontFamily: F.textMedium, fontSize: 15, color: C.ink },
  optionTextOn: { color: '#fff' },
});
