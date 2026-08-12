import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

// Android's hardware back button. The app has no navigator — every screen is a
// `view` state in one of six container components — so there is no stack for
// the OS to pop and, until now, back quit the app from anywhere.
//
// ponytail: no navigator, no history library. `BackHandler` already behaves as
// a stack: subscriptions fire **last-registered-first** and the first one to
// return true stops the chain. Containers mount parent-before-child, so the
// deepest screen showing is the one that answers. That is exactly the
// behaviour a navigator would give us, for the price of this file.
//
// Register at the level that OWNS the navigation state, not on each screen —
// a child that only receives an `onBack` prop does not know what "back" means.
// Pass undefined (or null) when this level is already at its root: the chain
// then falls through to the next container up, and finally to Android, which
// backgrounds the app the way it should from a tab root.
//
// Modals are not covered here and must not be: React Native routes the back
// button on an open `<Modal>` to its own `onRequestClose`, which every sheet in
// this app already wires to its close handler.

export function useAndroidBack(handler?: (() => void) | null) {
  // kept in a ref so an inline arrow doesn't resubscribe on every render —
  // resubscribing would quietly move this handler to the top of the chain
  const latest = useRef(handler);
  latest.current = handler;

  const enabled = !!handler;
  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      latest.current?.();
      return true;   // handled here; nothing further up the chain runs
    });
    return () => sub.remove();
  }, [enabled]);
}
