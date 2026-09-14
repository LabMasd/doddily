import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { activityCache } from './data';
import type { Activity, Session } from './types';

const KEY = 'ld:reminders:v1';
type Stored = Record<string, { notificationId: string; at: number; item: Activity }>;

async function read(): Promise<Stored> {
  try {
    const all = JSON.parse((await AsyncStorage.getItem(KEY)) || '{}') as Stored;
    // Forget reminders that have already fired.
    const now = Date.now();
    for (const k of Object.keys(all)) if (all[k].at < now) delete all[k];
    return all;
  } catch {
    return {};
  }
}
const write = (s: Stored) => AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});

export async function getReminder(id: string) {
  return (await read())[id] ?? null;
}

/** Reminds an hour before (or 15 minutes before if it's sooner than that). */
export async function setReminder(it: Activity, next: { date: Date; session: Session }): Promise<'set' | 'denied' | 'too-late' | 'error'> {
  try {
    const start = next.date.getTime();
    let at = start - 60 * 60_000;
    if (at < Date.now() + 60_000) at = start - 15 * 60_000;
    if (at < Date.now() + 60_000) return 'too-late';

    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return 'denied';

    const minutes = Math.round((start - at) / 60_000);
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${it.name} at ${next.session.start}`,
        body: `${it.venue || it.provider || ''}${it.venue || it.provider ? ' · ' : ''}starts in ${minutes === 60 ? 'an hour' : `${minutes} minutes`}`,
        data: { id: it.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
    });
    const all = await read();
    if (all[it.id]) await Notifications.cancelScheduledNotificationAsync(all[it.id].notificationId).catch(() => {});
    all[it.id] = { notificationId, at, item: it };
    await write(all);
    return 'set';
  } catch {
    return 'error';
  }
}

export async function clearReminder(id: string) {
  const all = await read();
  if (all[id]) {
    await Notifications.cancelScheduledNotificationAsync(all[id].notificationId).catch(() => {});
    delete all[id];
    await write(all);
  }
}

/** So a tapped reminder can open its class even before listings load. */
export async function hydrateReminderActivities() {
  const all = await read();
  for (const r of Object.values(all)) activityCache.set(r.item.id, r.item);
}
