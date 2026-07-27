import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, shadowLg, sp } from '../theme';

// One row of barber_day_queue(): today's confirmed bookings, names pre-trimmed server-side.
export type DayQueueRow = {
  booking_id: string;
  label: string;
  service_name: string | null;
  duration_min: number | null;
  starts_at: string;
  stage: 'waiting' | 'in_chair' | 'done';
};

export function minutesUntil(iso: string) {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}

// ponytail: 20s polling, no Realtime — customers can't RLS-see other people's
// booking rows, so change events for them never arrive; poll is the honest rail.
export const QUEUE_POLL_MS = 20_000;

// Live queue — customer view (design 1b), a live view over the barber's confirmed
// day. Appears once the barber confirms your booking; no separate join step.
export default function QueueScreen({ barberId, myBookingId, barberLine, onBack, onBookings }: {
  barberId: string; myBookingId: string; barberLine: string;
  onBack: () => void; onBookings?: () => void;
}) {
  const [rows, setRows] = useState<DayQueueRow[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('barber_day_queue', { p_barber: barberId });
    if (error) { Alert.alert('Could not load the queue', error.message); return onBack(); }
    setRows((data as DayQueueRow[]) ?? []);
  }, [barberId, onBack]);

  useEffect(() => {
    load();
    const t = setInterval(load, QUEUE_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const mine = rows?.find((r) => r.booking_id === myBookingId) ?? null;
  // served or cancelled while away → drop back to Home (effect, not mid-render)
  useEffect(() => { if (rows !== null && !mine) onBack(); }, [rows, mine, onBack]);
  if (rows === null || !mine) return <View style={s.screen} />;

  const active = rows.filter((r) => r.stage !== 'done');
  const ticketNo = rows.findIndex((r) => r.booking_id === myBookingId) + 1;
  const ahead = active.filter((r) => r.booking_id !== myBookingId
    && new Date(r.starts_at).getTime() < new Date(mine.starts_at).getTime());
  const etaMin = minutesUntil(mine.starts_at);
  const inChairNow = mine.stage === 'in_chair';
  const myTime = new Date(mine.starts_at).toTimeString().slice(0, 5);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Live queue" onBack={onBack} />

        {/* your ticket (dark card) */}
        <View style={s.ticketCard}>
          <Text style={s.ticketLabel}>YOUR TICKET</Text>
          <Text style={s.ticketNo}>Nº {String(ticketNo).padStart(2, '0')}</Text>
          <Text style={s.ticketSub}>{barberLine}</Text>
          <View style={s.ticketStats}>
            <View style={s.ticketStat}>
              <Text style={s.ticketStatValue}>{inChairNow ? 'Now' : ahead.length}</Text>
              <Text style={s.ticketStatLabel}>{inChairNow ? 'IN CHAIR' : 'AHEAD'}</Text>
            </View>
            <View style={s.ticketDivider} />
            <View style={s.ticketStat}>
              <Text style={s.ticketStatValue}>
                ~{etaMin}<Text style={s.ticketStatUnit}> min</Text>
              </Text>
              <Text style={s.ticketStatLabel}>EST. WAIT</Text>
            </View>
            <View style={s.ticketDivider} />
            <View style={s.ticketStat}>
              <Text style={s.ticketStatValue}>{myTime}</Text>
              <Text style={s.ticketStatLabel}>YOUR SLOT</Text>
            </View>
          </View>
        </View>

        <Text style={s.sectionLabel}>WHO'S UP</Text>
        <View style={s.rows}>
          {active.map((r) => {
            const isMe = r.booking_id === myBookingId;
            const chair = r.stage === 'in_chair';
            const no = rows.findIndex((x) => x.booking_id === r.booking_id) + 1;
            return (
              <View key={r.booking_id} style={[s.row, isMe && s.rowMine]}>
                <View style={[s.rowNum, chair && s.rowNumChair, isMe && s.rowNumMine]}>
                  <Text style={[s.rowNumText, chair && s.rowNumTextChair, isMe && s.rowNumTextMine]}>
                    {String(no).padStart(2, '0')}
                  </Text>
                </View>
                <View style={s.grow}>
                  <Text style={s.rowName}>{r.label}</Text>
                  <Text style={s.rowMeta}>
                    {isMe && !chair
                      ? "We'll notify you when you're next"
                      : `${chair ? 'In the chair' : 'Waiting'}${r.service_name ? ` · ${r.service_name}` : ''}`}
                  </Text>
                </View>
                {chair
                  ? <View style={s.nowBadge}><Text style={s.nowBadgeText}>NOW</Text></View>
                  : <Text style={[s.rowEta, isMe && s.rowEtaMine]}>~{minutesUntil(r.starts_at)} min</Text>}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* bottom bar */}
      <View style={s.bottomBar}>
        <View style={s.grow}>
          <Text style={s.bottomBig}>{inChairNow ? "You're up!" : `~${etaMin} min`}</Text>
          <Text style={s.bottomSub}>{inChairNow ? 'take a seat' : 'estimated wait'}</Text>
        </View>
        {onBookings && !inChairNow && (
          <Pressable onPress={onBookings} style={({ pressed }) => [s.ctaBtn, pressed && s.pressed]}>
            <Text style={s.ctaText}>My booking</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: sp(14), paddingHorizontal: sp(5), paddingBottom: 130, gap: sp(4) },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },

  ticketCard: {
    backgroundColor: colors.ink, borderRadius: radius.xl, padding: sp(5.5),
    alignItems: 'center', gap: sp(1.5),
  },
  ticketLabel: { fontSize: 10, letterSpacing: 1.8, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  ticketNo: { fontFamily: serif, fontSize: 52, lineHeight: 56, color: colors.onAccent },
  ticketSub: { fontSize: font.small, color: 'rgba(255,255,255,0.6)' },
  ticketStats: {
    flexDirection: 'row', justifyContent: 'center', gap: sp(5.5), width: '100%',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: sp(3.5), marginTop: sp(3),
  },
  ticketStat: { alignItems: 'center', gap: 2 },
  ticketStatValue: { fontSize: 17, fontWeight: '700', color: colors.onAccent, fontVariant: ['tabular-nums'] },
  ticketStatUnit: { fontSize: 12, fontWeight: '400', color: 'rgba(255,255,255,0.5)' },
  ticketStatLabel: { fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.5)' },
  ticketDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.1)' },

  sectionLabel: {
    fontSize: font.tiny, letterSpacing: 1.8, fontWeight: '700',
    color: colors.textSecondary, textTransform: 'uppercase',
  },
  rows: { gap: sp(2.5) },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: colors.bg, borderRadius: radius.lg, padding: sp(4), ...shadow,
  },
  rowMine: { borderWidth: 2, borderColor: colors.accent },
  rowNum: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  rowNumChair: { backgroundColor: colors.accentSoft },
  rowNumMine: { backgroundColor: colors.ink },
  rowNumText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  rowNumTextChair: { color: colors.accent },
  rowNumTextMine: { color: colors.onAccent },
  rowName: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  nowBadge: {
    backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 10,
  },
  nowBadgeText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.onAccent },
  rowEta: { fontSize: 12, color: colors.textSecondary },
  rowEtaMine: { fontWeight: '700', color: colors.accent },

  bottomBar: {
    position: 'absolute', left: sp(5), right: sp(5), bottom: sp(6.5),
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: colors.bg, borderRadius: radius.pill,
    padding: sp(2), paddingLeft: sp(5.5), ...shadowLg,
  },
  bottomBig: { fontSize: 16, fontWeight: '800', color: colors.text },
  bottomSub: { fontSize: font.tiny, color: colors.textSecondary },
  ctaBtn: {
    height: 52, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp(6.5),
  },
  ctaText: {
    color: colors.onAccent, fontSize: font.small, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase',
  },
});
