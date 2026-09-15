import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { C, F, R } from '@/constants/theme';
import { lookupPostcode, postcodeFor } from '@/lib/data';
import { newKidId, useStore } from '@/lib/store';
import type { Loc } from '@/lib/types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `askChild`: also ask for a first child's name and birth month (used on the welcome screen). */
export function LocationForm({ submitLabel, onDone, askChild }: { submitLabel: string; onDone: () => void; askChild?: boolean }) {
  const { settings, update } = useStore();
  const [pc, setPc] = useState(settings.loc?.postcode ?? '');
  const [pending, setPending] = useState<Loc | null>(null);
  const [radius, setRadius] = useState(settings.radius);
  const [born, setBorn] = useState<string | null>(settings.kids[0]?.born ?? null);
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
    const kids = askChild && born
      ? [{ id: settings.kids[0]?.id ?? newKidId(), name: childName.trim(), born }, ...settings.kids.slice(1)]
      : settings.kids;
    update({ loc, radius, kids, onboarded: true });
    onDone();
  }

  const bornLabel = born ? `${MONTHS[+born.split('-')[1] - 1]} ${born.split('-')[0]}` : 'Not set';
  const shiftBorn = (delta: number) => {
    const now = new Date();
    const [y, m] = born ? born.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
    const d = new Date(y, m - 1 + delta, 1);
    if (d > now) return;
    setBorn(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

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
      <View style={s.row}>
        <Pressable onPress={() => shiftBorn(-1)} style={s.step} accessibilityLabel="Earlier month"><Text style={s.stepText}>‹</Text></Pressable>
        <Text style={[s.value, s.month]}>{bornLabel}</Text>
        <Pressable onPress={() => shiftBorn(1)} style={s.step} accessibilityLabel="Later month"><Text style={s.stepText}>›</Text></Pressable>
        {born && <Pressable onPress={() => setBorn(null)} style={s.clear}><Text style={s.ghostText}>Clear</Text></Pressable>}
      </View>
      <Text style={s.hint}>Birth month. Hides classes they’re too young or too old for. Add more children in You.</Text>
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
