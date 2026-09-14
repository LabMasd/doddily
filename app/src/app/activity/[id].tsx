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
  const reminderLabel = { none: 'Remind me', set: '🔔 Reminder on', denied: 'Notifications are off', 'too-late': 'Starts too soon', error: 'Couldn’t set reminder' }[reminder];

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}>
      <Text style={s.cat}>{cat.e}  {cat.label}</Text>
      <Text style={s.title}>{it.name}</Text>
      <Text style={s.venue}>{[venueLine(it), d != null ? distLabel(d) : ''].filter(Boolean).join(' · ')}</Text>
      <Tags it={it} />

      <View style={s.actions}>
        <Action label="Directions" primary onPress={() => openDirections(it)} />
        {!!it.url && <Action label={it.booking === 'drop-in' || it.osm ? 'Website' : 'Book or check'} onPress={() => openLink(it.url!)} />}
        {!!it.phone && <Action label="Call" onPress={() => callPhone(it.phone!)} />}
        <Action label={isSaved ? '♥ Saved' : '♡ Save'} active={isSaved} onPress={() => toggleSaved(it)} />
        {next && Platform.OS !== 'web' && (
          <Action label={calState === 'added' ? 'Added to calendar' : calState === 'error' ? 'Calendar unavailable' : 'Add to calendar'} onPress={onCalendar} />
        )}
        {next?.session.start && Platform.OS !== 'web' && <Action label={reminderLabel} active={reminder === 'set'} onPress={onReminder} />}
        <Action label="Send" onPress={() => shareActivity(it)} />
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

function Action({ label, onPress, primary, active }: { label: string; onPress: () => void; primary?: boolean; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.act, primary && s.actPrimary, active && s.actActive, pressed && { opacity: 0.8 }]} accessibilityRole="button">
      <Text style={[s.actText, primary && s.actTextPrimary]}>{label}</Text>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  act: { borderRadius: R.pill, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 11 },
  actPrimary: { backgroundColor: C.ink, borderColor: C.ink },
  actActive: { backgroundColor: C.marigold, borderColor: C.marigold },
  actText: { fontFamily: F.textSemi, fontSize: 15, color: C.ink },
  actTextPrimary: { color: '#fff' },
  block: { marginTop: 24, backgroundColor: C.card, borderRadius: R.lg, padding: 16, gap: 6, borderWidth: 1, borderColor: C.line },
  blockTitle: { fontFamily: F.display, fontSize: 17, color: C.ink, marginBottom: 2 },
  line: { fontFamily: F.text, fontSize: 16, lineHeight: 22, color: C.ink },
  strong: { fontFamily: F.textSemi },
  muted: { fontFamily: F.text, fontSize: 15, color: C.muted },
  note: { fontFamily: F.text, fontSize: 13, color: C.muted, marginTop: 20 },
});
