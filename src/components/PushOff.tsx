import { Ionicons } from '@expo/vector-icons';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { countWord } from '../lib/inboxRules';
import { colors, radius, shadow } from '../theme';

// NTF-10 of "Customer - Notifications.dc.html" — what replaces 14b's header when
// the phone denies push. With push off every switch below it is decoration, and
// nothing on the old screen said so. This says what already failed to arrive,
// where each of those things still lives, and the one button that fixes it.
//
// "Missed" is only what the server meant to send and could not have reached this
// phone (missedWhilePushOff). Nothing from before push was first seen off is
// claimed, so the count can be low — it is never invented.

export type MissedRow = {
  id: string; kind: string; title: string; body: string | null;
  booking_id: string | null; created_at: string;
};

const PHONE = Platform.OS === 'ios' ? 'iPhone' : 'phone';

// the design's three weights: a lost turn, an answer that expired, money that landed
function dotOf(kind: string) {
  if (kind === 'queue_next') return colors.accent;
  if (kind === 'booking_answer' || kind === 'reschedule' || kind === 'offer' || kind === 'reminder') return colors.star;
  return colors.textTertiary;
}

function whenOf(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toTimeString().slice(0, 5)}`;
}

export default function PushOff({ missed, onOpenBooking, onOpenWallet }: {
  missed: MissedRow[] | null;
  onOpenBooking?: (bookingId: string) => void;
  onOpenWallet?: () => void;
}) {
  const n = missed?.length ?? 0;
  const shown = (missed ?? []).slice(0, 5);

  return (
    <>
      <View style={s.card}>
        <View style={s.head}>
          <View style={s.icon}>
            <Ionicons name="notifications-off-outline" size={17} color={colors.accent} />
          </View>
          <View style={s.grow}>
            <Text style={s.title}>Push is off for Sterncut</Text>
            <Text style={s.sub}>Blocked in {PHONE} settings, not here</Text>
          </View>
        </View>
        <Text style={s.body}>
          {missed === null
            ? 'Checking what could not reach you…'
            : n === 0
              ? 'Nothing has failed to reach you yet — but while push is off, nothing will. We do not send SMS, so the app is the only way we can reach you.'
              : `${countWord(n)} thing${n === 1 ? '' : 's'} could not reach you in the last two weeks. We do not send SMS, so the app is the only way we can reach you.`}
        </Text>
        <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button"
          style={({ pressed }) => [s.btn, pressed && s.pressed]}>
          <Text style={s.btnText}>OPEN {PHONE.toUpperCase()} SETTINGS</Text>
        </Pressable>
      </View>

      {n > 0 && (
        <>
          <Text style={s.section}>WHAT YOU MISSED</Text>
          <View style={s.list}>
            {shown.map((m, i) => {
              const link = m.kind === 'wallet' && onOpenWallet
                ? { label: 'it is still there', go: onOpenWallet }
                : m.booking_id && onOpenBooking
                  ? { label: 'it is in your bookings', go: () => onOpenBooking(m.booking_id!) }
                  : null;
              return (
                <View key={m.id} style={[s.row, i < shown.length - 1 && s.rowLine]}>
                  <View style={[s.dot, { backgroundColor: dotOf(m.kind) }]} />
                  <View style={s.grow}>
                    <Text style={s.rowTitle}>{m.title}</Text>
                    <Text style={s.rowBody}>
                      {whenOf(m.created_at)}.{m.body ? ` ${m.body}` : ''}
                      {link && (
                        <>
                          {' — '}
                          <Text style={s.link} onPress={link.go} accessibilityRole="link">{link.label}</Text>
                        </>
                      )}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={s.foot}>
            {n === 1 ? 'It' : `All ${countWord(n).toLowerCase()}`} waited in your inbox the whole time. Nothing is
            deleted for being unread.
          </Text>
        </>
      )}
    </>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },

  card: { backgroundColor: colors.ink, borderRadius: 22, paddingVertical: 17, paddingHorizontal: 18, gap: 11 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: 'rgba(232,68,46,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 13.5, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  body: { fontSize: 11.5, lineHeight: 17, color: 'rgba(255,255,255,0.72)' },
  btn: { height: 46, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5, color: '#111' },

  section: { fontSize: 11, letterSpacing: 1.65, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },
  list: { backgroundColor: colors.bg, borderRadius: 22, paddingHorizontal: 18, ...shadow },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 14 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: '#EFECE4' },
  dot: { width: 8, height: 8, borderRadius: 999, marginTop: 5 },
  rowTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  rowBody: { fontSize: 11.5, lineHeight: 16.5, color: colors.textSecondary, marginTop: 3 },
  link: { color: colors.accent, fontWeight: '600' },
  foot: { fontSize: 11, lineHeight: 16.5, color: colors.textSecondary, paddingHorizontal: 4, marginTop: -4 },
});
