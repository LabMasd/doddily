import * as Calendar from 'expo-calendar';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform, Share } from 'react-native';

import { DAYS } from './schedule';
import type { Activity, Session } from './types';

export function openDirections(it: Activity) {
  const { lat, lng } = it;
  const label = encodeURIComponent(it.venue || it.name);
  const url = Platform.select({
    ios: `maps://?daddr=${lat},${lng}&dirflg=w&q=${label}`,
    android: `google.navigation:q=${lat},${lng}&mode=w`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`,
  });
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`)
  );
}

export function openLink(url: string) {
  if (Platform.OS === 'web') return Linking.openURL(url);
  return WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'done', presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
}

export function callPhone(phone: string) {
  return Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);
}

export function shareActivity(it: Activity) {
  const when = it.sessions.map((s) => `${s.day}${s.start ? ' ' + s.start : ''}`).join(', ');
  const message = [it.name, it.venue, when, it.price, it.url].filter(Boolean).join('\n');
  return Share.share({ message, title: it.name }).catch(() => {});
}

/** The next date this activity runs, from today (a session that already ended today rolls to next week). */
export function nextOccurrence(it: Activity, now = new Date()): { date: Date; session: Session } | null {
  let best: { date: Date; session: Session } | null = null;
  for (const s of it.sessions) {
    const target = DAYS.indexOf(s.day);
    if (target < 0) continue;
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    let add = (target - now.getDay() + 7) % 7;
    if (add === 0 && s.start) {
      const [h, m] = s.start.split(':').map(Number);
      if (h * 60 + m < now.getHours() * 60 + now.getMinutes()) add = 7;
    }
    date.setDate(date.getDate() + add);
    if (s.start) {
      const [h, m] = s.start.split(':').map(Number);
      date.setHours(h, m);
    }
    if (!best || date < best.date) best = { date, session: s };
  }
  return best;
}

/** Opens the system "new event" form, filled in, so the parent confirms it in their own calendar. */
export async function addToCalendar(it: Activity, next: { date: Date; session: Session }): Promise<'added' | 'canceled' | 'error'> {
  try {
    const start = next.date;
    const end = new Date(start);
    if (next.session.end) {
      const [h, m] = next.session.end.split(':').map(Number);
      end.setHours(h, m);
    } else {
      end.setHours(start.getHours() + 1);
    }
    let calendar: Calendar.ExpoCalendar | undefined;
    if (Platform.OS === 'ios') {
      calendar = Calendar.getDefaultCalendarSync();
    } else {
      const all = await Calendar.getCalendars();
      calendar = all.find((c) => c.isPrimary && c.allowsModifications) ?? all.find((c) => c.allowsModifications);
    }
    if (!calendar) return 'error';
    const res = await calendar.addEventWithForm({
      title: it.name,
      startDate: start,
      endDate: end,
      allDay: !next.session.start,
      location: [it.venue, it.address, it.postcode].filter(Boolean).join(', '),
      notes: [it.price, it.booking === 'drop-in' ? 'Drop in' : 'Book ahead', it.url].filter(Boolean).join('\n'),
      url: it.url,
    });
    return res.action === 'saved' ? 'added' : 'canceled';
  } catch {
    return 'error';
  }
}
