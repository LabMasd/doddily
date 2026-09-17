import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { C, F, R } from '@/constants/theme';
import { lookupPostcode, postcodeFor } from '@/lib/data';
import { BANDS } from '@/lib/schedule';
import type { Kid } from '@/lib/types';
import { newKidId, useStore } from '@/lib/store';
import type { Loc } from '@/lib/types';


/** `askChild`: also ask for a first child's name and birth month (used on the welcome screen). */
export function LocationForm({ submitLabel, onDone, askChild }: { submitLabel: string; onDone: () => void; askChild?: boolean }) {
  const { settings, update } = useStore();
  const [pc, setPc] = useState(settings.loc?.postcode ?? '');
  const [pending, setPending] = useState<Loc | null>(null);
  const [radius, setRadius] = useState(settings.radius);
  const [band, setBand] = useState<Kid["band"] | null>(settings.kids[0]?.band ?? null);
  const [childName, setChildName] = useState(settings.kids[0]?.name ?? '');
  const [busy, setBusy] = useState<'geo' | 'save' | null>(null);
  const [error, setError] = useState('');

  async function useWhereIAm() {
    setError('');
    setBusy('geo');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { setError('Location is off for Doddily. Type a postcode instead.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = pos.coords;
      const postcode = await postcodeFor(lat, lng);
      setPending({ lat, lng, name: postcode || 'Current location', postcode });
      setPc(postcode);
    } catch {
      setError('Couldn’t find where you are. Type a postcode instead.');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError('');
    let loc = pending;
    const typed = pc.replace(/\s+/g, '').toUpperCase();
    if (!loc && typed && typed !== (settings.loc?.postcode ?? '').replace(/\s+/g, '')) {
      setBusy('save');
      loc = await lookupPostcode(typed);
      setBusy(null);
      if (!loc) { setError('That postcode wasn’t found. Check it and try again.'); return; }
    }
    loc = loc ?? settings.loc;
    if (!loc) { setError('Add a postcode or use where you are.'); return; }
    const kids = askChild && band
      ? [{ id: settings.kids[0]?.id ?? newKidId(), name: childName.trim(), band }, ...settings.kids.slice(1)]
      : settings.kids;
    update({ loc, radius, kids, onboarded: true });
    onDone();
  }


  return (
    <View style={s.wrap}>
      <Text style={s.label}>Postcode</Text>
      <View style={s.row}>
        <TextInput
          value={pc}
          onChangeText={(t) => { setPc(t); setPending(null); }}
          placeholder="E8 1EA"
          placeholderTextColor={C.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="postal-code"
          textContentType="postalCode"
          returnKeyType="done"
          onSubmitEditing={save}
          style={s.input}
          accessibilityLabel="Postcode"
        />
        <Pressable onPress={useWhereIAm} style={s.ghost} accessibilityRole="button">
          {busy === 'geo' ? <ActivityIndicator color={C.ink} /> : <Text style={s.ghostText}>Use where I am</Text>}
        </Pressable>
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}

      <Text style={[s.label, s.gap]}>Distance</Text>
      <View style={s.row}>
        <Slider
          style={s.slider}
          minimumValue={0.5}
          maximumValue={10}
          step={0.5}
          value={radius}
          onValueChange={setRadius}
          minimumTrackTintColor={C.accentLine}
          maximumTrackTintColor={C.line}
          thumbTintColor={C.accent}
          accessibilityLabel="Distance in miles"
        />
        <Text style={s.value}>{radius} mi</Text>
      </View>
      <Text style={s.hint}>About {Math.round(radius * 25)} minutes’ walk with a buggy at the edge.</Text>

      {askChild && (<>
      <Text style={[s.label, s.gap]}>Your child <Text style={s.optional}>(optional)</Text></Text>
      <TextInput
        value={childName}
        onChangeText={setChildName}
        placeholder="Name"
        placeholderTextColor={C.muted}
        autoCapitalize="words"
        textContentType="givenName"
        style={[s.input, s.nameInput]}
        accessibilityLabel="Child's name"
      />
      <View style={s.bands}>
        {BANDS.map((b) => {
          const on = band === b.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => setBand(on ? null : b.id)}
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
      <Text style={s.hint}>We never ask for a birthday. Pick an age group and Doddily hides what they’re too young or too old for. You can add more children later, in the You tab.</Text>
      </>)}

      <Pressable onPress={save} style={({ pressed }) => [s.primary, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        {busy === 'save' ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{submitLabel}</Text>}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontFamily: F.textSemi, fontSize: 16, color: C.ink },
  optional: { fontFamily: F.text, color: C.muted },
  gap: { marginTop: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, fontFamily: F.textMedium, fontSize: 17, color: C.ink, backgroundColor: C.milk, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 12 },
  ghost: { borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.milk, paddingHorizontal: 14, paddingVertical: 12, minWidth: 130, alignItems: 'center' },
  ghostText: { fontFamily: F.textSemi, fontSize: 15, color: C.ink },
  error: { fontFamily: F.text, fontSize: 14, color: C.warn },
  bands: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  band: { borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.milk, paddingHorizontal: 12, paddingVertical: 8 },
  bandOn: { backgroundColor: C.ink, borderColor: C.ink },
  bandName: { fontFamily: F.textSemi, fontSize: 15, color: C.ink },
  bandRange: { fontFamily: F.text, fontSize: 12, color: C.muted, marginTop: 1 },
  bandTextOn: { color: '#fff' },
  slider: { flex: 1, height: 40 },
  value: { fontFamily: F.display, fontSize: 20, color: C.ink, minWidth: 64, textAlign: 'right' },
  month: { flex: 1, textAlign: 'center', fontSize: 18 },
  hint: { fontFamily: F.text, fontSize: 14, color: C.muted },
  step: { width: 44, height: 44, borderRadius: R.md, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.milk },
  stepText: { fontFamily: F.display, fontSize: 22, color: C.ink },
  clear: { paddingHorizontal: 8, paddingVertical: 10 },
  nameInput: { flex: 0, textTransform: 'none', marginBottom: 6 },
  primary: { marginTop: 26, backgroundColor: C.ink, borderRadius: R.md, paddingVertical: 15, alignItems: 'center' },
  primaryText: { fontFamily: F.textSemi, fontSize: 17, color: '#fff' },
});
