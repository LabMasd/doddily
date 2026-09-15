import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Tags, venueLine } from '@/components/activity-row';
import { C, F, GUTTER, MaxContentWidth, R } from '@/constants/theme';
import { addToCalendar, callPhone, nextOccurrence, openDirections, openLink, shareActivity } from '@/lib/actions';
import { CATS } from '@/lib/categories';
import { activityCache } from '@/lib/data';
import { distLabel, miles } from '@/lib/geo';
import { clearReminder, getReminder, setReminder } from '@/lib/reminders';
import { ageText } from '@/lib/schedule';
import { useStore } from '@/lib/store';

const DAY_NAMES: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const BOOKING: Record<string, string> = { 'drop-in': 'Drop in, no booking', book: 'Book ahead', term: 'Book by the term' };

export default function ActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { saved, toggleSaved, settings } = useStore();
  const insets = useSafeAreaInsets();
  const [calState, setCalState] = useState<'idle' | 'added' | 'error'>('idle');
  const [reminder, setReminderState] = useState<'none' | 'set' | 'denied' | 'too-late' | 'error'>('none');

  useEffect(() => {
    if (Platform.OS === 'web') return;
    getReminder(id).then((r) => setReminderState(r ? 'set' : 'none'));
  }, [id]);

  const it = activityCache.get(id) ?? saved[id];
  if (!it) {
    return (
      <View style={[s.screen, s.center]}>
        <Text style={s.missing}>This listing isn’t loaded. Go back and pull down to refresh.</Text>
      </View>
    );
  }

  const cat = CATS[it.category] ?? { e: '📍', label: '' };
  const d = settings.loc ? miles(settings.loc, it) : null;
  const isSaved = !!saved[it.id];
  const next = nextOccurrence(it);
  const where = [it.venue, it.address, it.postcode].filter(Boolean).join('\n');

  const onCalendar = async () => {
    if (!next) return;
    const res = await addToCalendar(it, next);
    setCalState(res === 'added' ? 'added' : res === 'error' ? 'error' : 'idle');
  };

  const onReminder = async () => {
    if (reminder === 'set') {
      await clearReminder(it.id);
      setReminderState('none');
    } else if (next) {
      setReminderState(await setReminder(it, next));
    }
  };
  const reminderLabel = { none: 'Remind me', set: 'Reminder on', denied: 'Alerts off', 'too-late': 'Too soon', error: 'Try again' }[reminder];

  const tiles: TileProps[] = [];
  if (it.url) {
    const book = !(it.booking === 'drop-in' || it.osm);
    tiles.push({ label: book ? 'Book' : 'Website', a11y: book ? 'Book or check times' : 'Open website', icon: { ios: 'safari', android: 'language', web: 'language' }, onPress: () => openLink(it.url!) });
  }
  if (it.phone) tiles.push({ label: 'Call', icon: { ios: 'phone', android: 'call', web: 'call' }, onPress: () => callPhone(it.phone!) });
  tiles.push({ label: isSaved ? 'Saved' : 'Save', icon: { ios: isSaved ? 'heart.fill' : 'heart', android: 'favorite', web: 'favorite' }, active: isSaved, onPress: () => toggleSaved(it) });
  if (next && Platform.OS !== 'web') {
    tiles.push({ label: calState === 'added' ? 'Added' : calState === 'error' ? 'Unavailable' : 'Calendar', a11y: 'Add to calendar', icon: { ios: 'calendar.badge.plus', android: 'calendar_add_on', web: 'calendar_add_on' }, active: calState === 'added', onPress: onCalendar });
  }
  if (next?.session.start && Platform.OS !== 'web') {
    tiles.push({ label: reminderLabel, icon: { ios: reminder === 'set' ? 'bell.fill' : 'bell', android: reminder === 'set' ? 'notifications_active' : 'notifications', web: 'notifications' }, active: reminder === 'set', onPress: onReminder });
  }
  tiles.push({ label: 'Send', a11y: 'Send to someone', icon: { ios: 'square.and.arrow.up', android: 'share', web: 'ios_share' }, onPress: () => shareActivity(it) });
  // Four fit on one row; more go three to a row, padded so every tile is the same width.
  const perRow = tiles.length <= 4 ? tiles.length : 3;
  const rows = Array.from({ length: Math.ceil(tiles.length / perRow) }, (_, i) => tiles.slice(i * perRow, (i + 1) * perRow));

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}>
      <Text style={s.cat}>{cat.e}  {cat.label}</Text>
      <Text style={s.title}>{it.name}</Text>
      <Text style={s.venue}>{[venueLine(it), d != null ? distLabel(d) : ''].filter(Boolean).join(' · ')}</Text>
      <Tags it={it} />

      <View style={s.actions}>
        <Pressable onPress={() => openDirections(it)} style={({ pressed }) => [s.primary, pressed && s.pressed]} accessibilityRole="button">
          <SymbolView name={{ ios: 'arrow.triangle.turn.up.right.diamond.fill', android: 'directions', web: 'directions' }} size={20} tintColor="#fff" />
          <Text style={s.primaryText}>Directions</Text>
        </Pressable>
        {rows.map((row, i) => (
          <View key={i} style={s.tileRow}>
            {row.map((t) => <Tile key={t.label + (t.a11y ?? '')} {...t} />)}
            {Array.from({ length: perRow - row.length }, (_, j) => <View key={`pad${j}`} style={s.tilePad} />)}
          </View>
        ))}
      </View>

      {(it.sessions.length > 0 || !!it.schedule_note) && (
        <Block title="When">
          {it.sessions.map((x, i) => (
            <Text key={i} style={s.line}>
              <Text style={s.strong}>{DAY_NAMES[x.day]}</Text>
              {x.start ? `  ${x.start}${x.end ? '–' + x.end : ''}` : '  time not listed'}
            </Text>
          ))}
          {!!it.schedule_note && <Text style={s.muted}>{it.schedule_note}</Text>}
          {next && <Text style={s.muted}>Next: {next.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}{next.session.start ? ` at ${next.session.start}` : ''}</Text>}
        </Block>
      )}

      {!!it.description && (
        <Block title="About">
          <Text style={s.line}>{it.description}</Text>
        </Block>
      )}

      {!it.osm && (
        <Block title="Details">
          {!!it.price && <Text style={s.line}><Text style={s.strong}>Price</Text>  {it.price}</Text>}
          <Text style={s.line}><Text style={s.strong}>Ages</Text>  {ageText(it)}</Text>
          <Text style={s.line}><Text style={s.strong}>Booking</Text>  {BOOKING[it.booking]}</Text>
          <Text style={s.line}><Text style={s.strong}>{it.indoor ? 'Indoors' : 'Outdoors'}</Text></Text>
        </Block>
      )}

      {!!where && (
        <Block title="Where">
          <Text style={s.line}>{where}</Text>
        </Block>
      )}

      <Text style={s.note}>
        {it.osm
          ? 'From OpenStreetMap. Opening times can differ from what’s listed.'
          : `Times and prices change. Check with ${it.provider || 'the provider'} before you go.`}
      </Text>
    </ScrollView>
  );
}

type TileProps = { label: string; a11y?: string; icon: SymbolViewProps['name']; onPress: () => void; active?: boolean };

function Tile({ label, a11y, icon, onPress, active }: TileProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.tile, active && s.tileActive, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ selected: !!active }}
    >
      <SymbolView name={icon} size={22} tintColor={active ? C.marigoldText : C.ink} />
      <Text style={[s.tileText, active && s.tileTextActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.milk },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  missing: { fontFamily: F.text, fontSize: 16, color: C.muted, textAlign: 'center' },
  content: { paddingHorizontal: GUTTER + 4, paddingTop: 4, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  cat: { fontFamily: F.textMedium, fontSize: 15, color: C.muted },
  title: { fontFamily: F.display, fontSize: 30, lineHeight: 34, color: C.ink, marginTop: 6 },
  venue: { fontFamily: F.text, fontSize: 16, color: C.muted, marginTop: 6 },
  actions: { gap: 8, marginTop: 20 },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.ink, borderRadius: R.md, paddingVertical: 15 },
  primaryText: { fontFamily: F.textSemi, fontSize: 17, color: '#fff' },
  pressed: { opacity: 0.8 },
  tileRow: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingVertical: 12, paddingHorizontal: 4 },
  tilePad: { flex: 1 },
  tileActive: { backgroundColor: C.marigoldSoft, borderColor: C.marigold },
  tileText: { fontFamily: F.textSemi, fontSize: 13, color: C.ink },
  tileTextActive: { color: C.marigoldText },
  block: { marginTop: 24, backgroundColor: C.card, borderRadius: R.lg, padding: 16, gap: 6, borderWidth: 1, borderColor: C.line },
  blockTitle: { fontFamily: F.display, fontSize: 17, color: C.ink, marginBottom: 2 },
  line: { fontFamily: F.text, fontSize: 16, lineHeight: 22, color: C.ink },
  strong: { fontFamily: F.textSemi },
  muted: { fontFamily: F.text, fontSize: 15, color: C.muted },
  note: { fontFamily: F.text, fontSize: 13, color: C.muted, marginTop: 20 },
});
