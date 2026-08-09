import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// 4a — what a barber sees while his hands are busy. The banner itself is drawn
// by the OS; our job is the payload, the Accept/Decline actions on it, and the
// token the server pushes to. 0032 decides *whether* a given event buzzes.
//
// NOTE: Expo Go dropped remote push in SDK 53. Registration below no-ops there;
// a development build is needed to receive a real push. Everything else — the
// inbox, the preferences, the handler — works in Expo Go.

export const BOOKING_CATEGORY = 'BOOKING_REQUEST';
// 8a — a cancellation banner carries the customer's own words and two ways out:
// answer him, or refill the hole. Neither can be done from the lock screen, so
// both open the app rather than resolving in place like Accept/Decline do.
export const CANCELLED_CATEGORY = 'BOOKING_CANCELLED';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const inExpoGo = Constants.appOwnership === 'expo';

/** Accept / Decline straight from the banner, without opening the app. */
async function registerCategory() {
  await Notifications.setNotificationCategoryAsync(BOOKING_CATEGORY, [
    {
      identifier: 'DECLINE',
      buttonTitle: 'Decline',
      options: { opensAppToForeground: false, isDestructive: true },
    },
    {
      identifier: 'ACCEPT',
      buttonTitle: 'Accept',
      options: { opensAppToForeground: false },
    },
  ]);

  await Notifications.setNotificationCategoryAsync(CANCELLED_CATEGORY, [
    { identifier: 'REPLY', buttonTitle: 'Reply', options: { opensAppToForeground: true } },
    { identifier: 'OFFER', buttonTitle: 'Offer the slot', options: { opensAppToForeground: true } },
  ]);
}

/**
 * Asks once, stores the token against the barber, and wires the banner actions.
 * Safe to call on every sign-in; returns the token or null when unavailable.
 */
export async function registerPush(userId: string): Promise<string | null> {
  await registerCategory();

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Sterncut',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E8442E',
    });
  }

  if (!Device.isDevice || inExpoGo) return null; // simulator / Expo Go: no remote push

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    ?? (Constants as any).easConfig?.projectId;
  if (!projectId) return null; // ponytail: needs an EAS project before tokens mean anything

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await supabase.from('push_tokens')
    .upsert({ token, user_id: userId, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'token' });
  return token;
}

/** Whether the OS is letting anything through — drives 4c's "Push is on" card. */
export async function pushPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/**
 * Banner buttons. Accept/Decline run the same RPCs the app does, so acting from
 * the lock screen and acting in the app cannot diverge.
 */
export function onBannerAction(onHandled: () => void) {
  return Notifications.addNotificationResponseReceivedListener(async (res) => {
    const data = res.notification.request.content.data as { bookingId?: string } | undefined;
    const id = data?.bookingId;
    if (!id) return onHandled();
    if (res.actionIdentifier === 'ACCEPT') {
      await supabase.rpc('accept_booking', { p_booking: id });
    } else if (res.actionIdentifier === 'DECLINE') {
      await supabase.rpc('cancel_booking', { p_booking: id, p_reason: 'Declined from the notification' });
    }
    onHandled();
  });
}

export async function clearBadge() {
  await Notifications.setBadgeCountAsync(0);
}
