import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { queueUrl } from './qr';
import { queueLanding, referrerLanding, ShopCode } from './shopCode';

// A shop's queue link opens the app (option b, 2026-09-15; QL-19 under Q3). The
// link is held until Home uses it — through a sign-in or a sign-up if that comes
// first (QL-22) — and only for the day it was opened, because the line it points
// at is today's.

const KEY = 'pending_queue_link';
const REFERRER_READ = 'install_referrer_read';

/** `fresh`: it arrived through the store, on the first open after an install (QL-21). */
export type QueueLink = ShopCode & { url: string; at: number; fresh?: boolean };

async function keep(link: QueueLink) {
  await AsyncStorage.setItem(KEY, JSON.stringify(link)).catch(() => {});
  return link;
}

/** Hold a link the phone handed the app. Anything that is not a shop's landing is ignored. */
export async function holdQueueLink(url: string | null): Promise<QueueLink | null> {
  if (!url) return null;
  const code = queueLanding(url);
  if (!code) return null;
  return keep({ ...code, url: url.trim(), at: Date.now() });
}

/**
 * QL-20 → QL-21, Android only: the shop QL-18's store hand-off wrote into Google
 * Play's install referrer. Read once per install — after that the referrer is the
 * same old string on every open. iOS has no referrer, so an iPhone that installs
 * from the page opens the app with no shop (BACKLOG).
 */
export async function takeInstallLink(): Promise<QueueLink | null> {
  if (Platform.OS !== 'android') return null;
  const read = await AsyncStorage.getItem(REFERRER_READ).catch(() => 'unreadable');
  if (read) return null;
  await AsyncStorage.setItem(REFERRER_READ, '1').catch(() => {});
  // no Play Store, or a store without the referrer API: nothing to carry
  const referrer = await Application.getInstallReferrerAsync().catch(() => null);
  const code = referrerLanding(referrer);
  if (!code) return null;
  return keep({ ...code, url: queueUrl(code.shop, code.barber), at: Date.now(), fresh: true });
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
