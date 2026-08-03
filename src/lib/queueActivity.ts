import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// 29b — the lock-screen card that follows your place in the queue.
//
// WHAT THIS IS NOT: the mock draws a Live Activity — a custom card with the
// coral fill, Playfair numerals and a four-segment progress bar. That rendering
// is ActivityKit, which means a SwiftUI widget extension and a dev build; it
// cannot be done from JS at any effort.
//
// WHAT THIS IS: the behaviour underneath it. One notification with a stable
// identifier, re-posted as the queue moves, so it updates in place on the lock
// screen instead of stacking. Ongoing on Android so it pins. Standard
// notification chrome, three phases, no new dependency.
//
// It is deliberately SILENT. The one moment that should buzz — "you're next" —
// already comes through the server push rail (0037's queue_next kind). If this
// tracker also made noise the phone would rattle every time the line moved.

const ID = 'queue-activity';
const CHANNEL = 'queue-tracker';

export type QueuePhase = 'waiting' | 'next' | 'chair';

export type QueueActivity = {
  phase: QueuePhase;
  ticketNo: number;
  ahead: number;
  etaMin: number;
  barberName: string;
  salonName: string;
  depositCents?: number;
  priceCents?: number;
};

let channelReady = false;
async function ensureChannel() {
  if (Platform.OS !== 'android' || channelReady) return;
  // LOW keeps it on the lock screen without a sound or heads-up banner
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Queue tracker',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: null,
    showBadge: false,
  });
  channelReady = true;
}

function body(a: QueueActivity) {
  const first = a.barberName.split(' ')[0];
  switch (a.phase) {
    case 'next':
      return {
        title: "You're next — head over",
        text: `${first} · ${a.salonName}`,
      };
    case 'chair': {
      const dep = (a.depositCents ?? 0) / 100;
      const due = ((a.priceCents ?? 0) - (a.depositCents ?? 0)) / 100;
      return {
        title: `In the chair with ${first}`,
        text: a.priceCents
          ? `${dep.toFixed(0)} DH paid · ${due.toFixed(0)} DH at the counter`
          : a.salonName,
      };
    }
    default:
      return {
        title: `${a.ahead} ahead · ~${a.etaMin} min`,
        text: `${first} · ${a.salonName}`,
      };
  }
}

/**
 * Post or update the card. Safe to call on every poll tick — same identifier,
 * so the OS replaces the existing one rather than adding another.
 */
export async function syncQueueActivity(a: QueueActivity) {
  await ensureChannel();
  const { title, text } = body(a);
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: {
        title,
        body: text,
        subtitle: `Ticket Nº ${String(a.ticketNo).padStart(2, '0')}`,
        sound: false,   // silent: the one buzz that matters comes from the push rail
        // ongoing on Android: it stays put while the queue is live
        sticky: a.phase !== 'chair',
        autoDismiss: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
        data: { kind: 'queue_activity', phase: a.phase },
        ...(Platform.OS === 'android' ? { channelId: CHANNEL } : null),
      },
      trigger: null,
    });
  } catch {
    // ponytail: cosmetic. A lock-screen card failing must never break the queue
    // screen the customer is actually looking at.
  }
}

/** The cut is done or the ticket is gone — take the card away. */
export async function clearQueueActivity() {
  try {
    await Notifications.dismissNotificationAsync(ID);
    await Notifications.cancelScheduledNotificationAsync(ID);
  } catch {
    /* already gone */
  }
}
