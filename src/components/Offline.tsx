import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';
import { Display } from './ui';

// 25a the banner over cached content, 25b the hard failure when there is no
// cache to fall back on.
//
// ponytail: no cache layer. Supabase-js already holds the last response in
// memory for the life of the screen, so what a customer sees offline is
// whatever loaded before the connection went — the banner's job is to say when
// that was, not to pretend it is live. A real disk cache is a bigger decision
// than a banner and belongs with whatever ships offline booking.

/** Online state plus the moment the last successful load happened. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  const seenAt = useRef<Date>(new Date());
  useEffect(() => {
    const unsub = NetInfo.addEventListener((st) => {
      const up = st.isConnected !== false && st.isInternetReachable !== false;
      if (up) seenAt.current = new Date();
      setOnline(up);
    });
    return () => unsub();
  }, []);
  return { online, since: seenAt.current };
}

const clock = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// ---- 25a -----------------------------------------------------------------
export function OfflineBanner({ since, onRetry }: { since: Date; onRetry?: () => void }) {
  return (
    <View style={s.banner}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.accent} />
      <View style={s.grow}>
        <Text style={s.bannerTitle}>You're offline</Text>
        <Text style={s.bannerSub}>Showing what we saved at {clock(since)}</Text>
      </View>
      <Pressable onPress={onRetry} disabled={!onRetry}
        style={({ pressed }) => [s.retry, pressed && s.pressed]}>
        <Text style={s.retryText}>RETRY</Text>
      </Pressable>
    </View>
  );
}

// ---- 25b -----------------------------------------------------------------
export function NoConnection({ title, onRetry, onBookings }: {
  title?: string; onRetry: () => void; onBookings?: () => void;
}) {
  return (
    <View style={s.wrap}>
      <View style={s.circle}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.textTertiary} />
      </View>
      <View>
        <Display size={21} style={s.title}>No connection</Display>
        <Text style={s.body}>
          Sterncut needs a connection to {title ?? 'find salons near you'}. Your bookings and
          coupons still work offline.
        </Text>
      </View>
      <Pressable onPress={onRetry} style={({ pressed }) => [s.tryBtn, pressed && s.pressed]}>
        <Text style={s.tryText}>TRY AGAIN</Text>
      </Pressable>
      {!!onBookings && <Text style={s.link} onPress={onBookings}>Open my bookings</Text>}

      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary}
          style={s.noteIcon} />
        <Text style={s.noteText}>
          Already in a queue? Your ticket stays valid — the shop sees it on their side.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.75 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.ink,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 15,
  },
  bannerTitle: { fontSize: 12, fontWeight: '700', color: '#fff' },
  bannerSub: { fontSize: font.tiny, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  retry: {
    height: 30, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center', paddingHorizontal: 12,
  },
  retryText: { fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.55, color: '#fff' },

  wrap: { alignItems: 'center', gap: 16, paddingTop: 118, paddingHorizontal: 20 },
  circle: {
    width: 96, height: 96, borderRadius: radius.pill, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: '#C9C5BB', alignItems: 'center', justifyContent: 'center',
  },
  title: { textAlign: 'center' },
  body: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 9, lineHeight: 20,
    maxWidth: 262, textAlign: 'center',
  },
  tryBtn: {
    height: 52, borderRadius: radius.pill, backgroundColor: colors.ink,
    justifyContent: 'center', paddingHorizontal: 32,
  },
  tryText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.96, color: '#fff' },
  link: { fontSize: font.small, fontWeight: '600', color: colors.accent },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, marginTop: 30, ...shadow,
  },
  noteIcon: { marginTop: 1 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },
});
