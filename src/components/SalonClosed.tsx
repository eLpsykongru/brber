import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, inter, radius } from '../theme';

// 39a of "Customer App 3.dc.html" — the customer end of barber 11a.
//
// Until 0064 the owner's power button wrote `salons.accepting_bookings` and no
// booking path read it, so a "closed" shop went on taking requests. Now the
// trigger refuses them, and this is the half that says so *before* someone
// picks a time — the distinction the turn is named for: the SHOP is shut, the
// barbers are not.

export type Closure = {
  closed: boolean;
  name?: string;
  until?: string | null;
  back_on?: string | null;
  open_min?: number | null;
  my_booking?: boolean;
};

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function useClosure(salonId: string | null) {
  const [c, setC] = useState<Closure | null>(null);
  useEffect(() => {
    if (!salonId) { setC(null); return; }
    supabase.rpc('salon_closure', { p_salon: salonId })
      .then(({ data }) => setC((data as Closure) ?? { closed: false }));
  }, [salonId]);
  return c;
}

/** The hero pill. Shown over the photo so it is the first thing read. */
export function ClosedBadge({ c }: { c: Closure | null }) {
  if (!c?.closed) return null;
  return (
    <View style={s.badge}>
      <View style={s.badgeDot} />
      <Text style={s.badgeText}>
        {c.until ? 'CLOSED TODAY' : 'CLOSED'}
      </Text>
    </View>
  );
}

export function ClosedCard({ c, salonId, onBookLater }: {
  c: Closure | null; salonId: string; onBookLater?: (day: string) => void;
}) {
  const [told, setTold] = useState(false);
  if (!c?.closed) return null;

  const back = c.back_on ? new Date(`${c.back_on}T00:00:00`) : null;
  const tomorrow = back != null
    && back.toDateString() === new Date(Date.now() + 86400000).toDateString();
  const backLabel = back
    ? (tomorrow ? 'tomorrow' : back.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }))
    : null;
  const at = c.open_min != null ? hhmm(c.open_min) : null;

  // "TELL ME IF THEY REOPEN" is a waitlist ask for the day it comes back —
  // `reopen_shop` (0064) already pings every live ask, so no new rail is needed.
  async function tellMe() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const day = c!.back_on ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const { error } = await supabase.from('waitlist_requests')
      .insert({ customer_id: u.user.id, salon_id: salonId, day });
    // the partial unique index means "already asked" is a success, not a failure
    if (error && !/duplicate key/i.test(error.message)) {
      Alert.alert('Could not do that', error.message);
      return;
    }
    setTold(true);
  }

  return (
    <>
      <View style={s.card}>
        <View style={s.cardTop}>
          <View style={s.cardChip}>
            <Ionicons name="power" size={16} color={colors.accent} />
          </View>
          <View style={s.grow}>
            <Text style={s.cardTitle}>
              {c.until ? 'The shop is shut for today' : 'The shop is shut'}
            </Text>
            <Text style={s.cardSub}>
              {backLabel
                ? `Opens again ${backLabel}${at ? ` at ${at}` : ''}`
                : 'No reopening date yet'}
            </Text>
          </View>
        </View>
        <Text style={s.cardBody}>
          You can't book or take a ticket here today.
          {c.my_booking ? ' Your booking still stands.' : ' If you already have a booking, it still stands.'}
        </Text>
      </View>

      <View style={s.actions}>
        {c.back_on && (
          <Pressable onPress={() => onBookLater?.(c.back_on!)}
            accessibilityLabel={`Book ${backLabel}`}
            style={({ pressed }) => [s.primary, pressed && s.pressed]}>
            <Text style={s.primaryText}>
              BOOK {backLabel?.toUpperCase()}{at ? ` · ${at}` : ''}
            </Text>
          </Pressable>
        )}
        <Pressable onPress={tellMe} disabled={told}
          accessibilityLabel="Tell me if they reopen"
          style={({ pressed }) => [s.secondary, pressed && s.pressed, told && s.done]}>
          <Ionicons name={told ? 'checkmark' : 'time-outline'} size={15}
            color={told ? colors.success : '#5c5c58'} />
          <Text style={[s.secondaryText, told && s.doneText]}>
            {told ? "WE'LL TELL YOU" : 'TELL ME IF THEY REOPEN'}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.75 },

  badge: {
    position: 'absolute', bottom: 12, left: 20, flexDirection: 'row', alignItems: 'center',
    gap: 6, backgroundColor: 'rgba(13,13,15,0.82)', borderRadius: radius.pill,
    paddingVertical: 6, paddingHorizontal: 12,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F87171' },
  badgeText: { fontFamily: inter.b, fontSize: 10.5, letterSpacing: 1.05, color: '#FFFFFF' },

  card: {
    backgroundColor: colors.bg, borderRadius: 20, padding: 15, paddingHorizontal: 16, gap: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardChip: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(248,113,113,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontFamily: inter.b, fontSize: 13.5, color: colors.text },
  cardSub: { fontFamily: inter.r, fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  cardBody: {
    fontFamily: inter.r, fontSize: 12, lineHeight: 18, color: '#5c5c58',
    borderTopWidth: 1, borderTopColor: '#EFECE4', paddingTop: 12,
  },

  actions: { gap: 10 },
  primary: {
    height: 52, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { fontFamily: inter.b, fontSize: 13, color: '#FFFFFF', letterSpacing: 0.78 },
  secondary: {
    height: 50, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  secondaryText: { fontFamily: inter.b, fontSize: 12.5, color: '#5c5c58', letterSpacing: 0.5 },
  done: { borderColor: 'rgba(30,142,79,0.4)' },
  doneText: { color: colors.success },
});
