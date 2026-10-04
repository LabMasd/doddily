import { useRouter } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F, R } from '@/constants/theme';
import { CATS } from '@/lib/categories';
import { distLabel } from '@/lib/geo';
import { ageText } from '@/lib/schedule';
import { useTextScale } from '@/lib/text-scale';
import type { Activity, Row } from '@/lib/types';

type Props = { row: Row; when?: { start: string; end: string | null } | null; faded?: boolean };

export const ActivityRow = memo(function ActivityRow({ row, when, faded }: Props) {
  const router = useRouter();
  const { it, d } = row;
  const cat = CATS[it.category] ?? { e: '📍', label: '' };
  // The time column is sized for ordinary text. With larger text it would squeeze the name into a
  // sliver, so the time moves to a line of its own above the name.
  const { roomy } = useTextScale();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/activity/[id]', params: { id: it.id } })}
      style={({ pressed }) => [s.row, roomy && s.rowRoomy, faded && s.faded, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${when ? when.start + ', ' : ''}${it.name}, ${distLabel(d)}`}>
      <View style={roomy ? s.whenRoomy : s.when}>
        {when ? (
          <>
            <Text style={s.time}>{when.start}</Text>
            <Text style={[s.sub, roomy && s.subRoomy]} numberOfLines={2}>{when.end ? `to ${when.end}` : cat.label}</Text>
          </>
        ) : (
          <Text style={s.emoji}>{cat.e}</Text>
        )}
      </View>
      <View style={s.body}>
        <View style={s.head}>
          <Text style={s.name}>{it.name}</Text>
          <Text style={s.dist}>{distLabel(d)}</Text>
        </View>
        <Text style={s.venue} numberOfLines={2}>{venueLine(it) || cat.label}</Text>
        <Tags it={it} />
      </View>
    </Pressable>
  );
});

const norm = (x?: string) => String(x || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
export function venueLine(it: Activity) {
  const v = norm(it.venue), p = norm(it.provider), n = norm(it.name);
  const showProvider = p && !v.includes(p) && !p.includes(v) && !n.includes(p);
  return [it.venue, showProvider ? it.provider : ''].filter(Boolean).join(', ');
}

export function Tags({ it }: { it: Activity }) {
  const tags: { label: string; tone?: 'free' | 'drop' | 'warn' }[] = [];
  if (it.free) tags.push({ label: 'Free', tone: 'free' });
  else if (it.price) tags.push({ label: it.price });
  if (!it.osm) {
    if (it.booking === 'drop-in') tags.push({ label: 'Drop in', tone: 'drop' });
    else if (it.booking === 'book') tags.push({ label: 'Book ahead' });
    else if (it.booking === 'term') tags.push({ label: 'Term booking' });
    tags.push({ label: ageText(it) });
  }
  if (it.tier === 'venue') tags.push({ label: 'Times on their site' });
  else if (it.confidence === 'low') tags.push({ label: 'Check times', tone: 'warn' });
  if (!tags.length) return null;
  return (
    <View style={s.tags}>
      {tags.map((t) => (
        <Text key={t.label} style={[s.tag, t.tone && tone[t.tone]]} numberOfLines={1}>{t.label}</Text>
      ))}
    </View>
  );
}

const tone = StyleSheet.create({
  free: { backgroundColor: C.leafSoft, color: C.leaf },
  drop: { backgroundColor: C.accentSoft, color: C.accentText },
  warn: { backgroundColor: C.warnSoft, color: C.warn },
});

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  faded: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
  rowRoomy: { flexDirection: 'column', gap: 4 },
  when: { width: 62, paddingTop: 2 },
  whenRoomy: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  time: { fontFamily: F.display, fontSize: 22, color: C.ink, fontVariant: ['tabular-nums'] },
  sub: { fontFamily: F.textMedium, fontSize: 13, color: C.muted, marginTop: 4 },
  subRoomy: { marginTop: 0 },
  emoji: { fontSize: 26 },
  body: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  name: { flex: 1, fontFamily: F.textSemi, fontSize: 17, lineHeight: 22, color: C.ink },
  dist: { fontFamily: F.text, fontSize: 14, color: C.muted, paddingTop: 2 },
  venue: { fontFamily: F.text, fontSize: 15, color: C.muted, marginTop: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: { fontFamily: F.textMedium, fontSize: 13, color: C.chipText, backgroundColor: C.chip, borderRadius: R.pill, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 3 },
});
