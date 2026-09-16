import AsyncStorage from '@react-native-async-storage/async-storage';
import { queueLanding, ShopCode } from './shopCode';

// Option (b), decided with the owner 2026-09-15: a shop's queue link opens the
// app. The link is held until Home uses it — through a sign-in or a sign-up if
// that comes first (QL-16, ADDENDUM A4 blocker 6) — and only for the day it was
// opened, because the line it points at is today's.

const KEY = 'pending_queue_link';

export type QueueLink = ShopCode & { url: string; at: number };

/** Hold a link the phone handed the app. Anything that is not a shop's landing is ignored. */
export async function holdQueueLink(url: string | null): Promise<QueueLink | null> {
  if (!url) return null;
  const code = queueLanding(url);
  if (!code) return null;
  const link: QueueLink = { ...code, url: url.trim(), at: Date.now() };
  await AsyncStorage.setItem(KEY, JSON.stringify(link)).catch(() => {});
  return link;
}

/** The link held from before the app was last closed, if it is still today's. */
export async function heldQueueLink(): Promise<QueueLink | null> {
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!raw) return null;
  try {
    const link = JSON.parse(raw) as QueueLink;
    if (new Date(link.at).toDateString() === new Date().toDateString()) return link;
  } catch {
    // unreadable: dropped below
  }
  await dropQueueLink();
  return null;
}

export function dropQueueLink() {
  return AsyncStorage.removeItem(KEY).catch(() => {});
}
