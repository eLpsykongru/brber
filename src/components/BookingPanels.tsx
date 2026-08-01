import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import {
  Avatar, Btn, Eyebrow, GhostBtn, Ico, IconName, Note, Sheet, SheetHead, Stars, T,
} from './dark';

// 1d (the booking in the chair) and 3d (a request from a flagged client).
// Both read client_reliability, which is barber-private (0030).

export type PanelBooking = {
  id: string; customerId: string; name: string; initials: string;
  service: string; durationMin: number; whenLabel: string; timeLabel: string;
  priceCents: number; checkedInAt: string | null; startedAt: string | null;
  phone: string | null; isWalkIn: boolean;
};

type Reliability = {
  visits: number; no_shows: number; avg_rating: number | null;
  flagged: boolean | null; reason: string | null;
  require_full_payment: boolean; blocked: boolean; last_no_show_days: number | null;
};

const dh = (cents: number) => `${Math.round(cents / 100)} DH`;
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

function useReliability(customerId: string | undefined, isWalkIn: boolean | undefined, on: boolean) {
  const [rel, setRel] = useState<Reliability | null>(null);
  useEffect(() => {
    if (!on || !customerId || isWalkIn) return setRel(null);
    supabase.rpc('client_reliability', { p_customer: customerId })
      .then(({ data }) => setRel((data?.[0] as Reliability) ?? null));
  }, [on, customerId, isWalkIn]);
  return rel;
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.detailRow}>
      <T size={13} c={D.sub}>{label}</T>
      <T w="b" size={13} c={color ?? D.text}>{value}</T>
    </View>
  );
}

function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.tile, !onPress && s.off, pressed && s.pressed]}>
      <Ico name={icon} size={18} />
      <T w="sb" size={11} c={D.sub}>{label}</T>
    </Pressable>
  );
}

// ---- 1d · booking panel, in the chair -------------------------------------
export default function BookingPanelSheet({
  visible, booking, onClose, onDone, onChat, onHistory, onReschedule, onNoShow,
}: {
  visible: boolean; booking: PanelBooking | null; onClose: () => void;
  onDone: () => void; onChat?: () => void; onHistory?: () => void;
  onReschedule?: () => void; onNoShow?: () => void;
}) {
  const rel = useReliability(booking?.customerId, booking?.isWalkIn, visible);
  if (!booking) return null;
  const b = booking;
  const stars = rel && rel.avg_rating != null ? Math.round(Number(rel.avg_rating)) : null;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={s.head}>
        {b.isWalkIn ? <Avatar size={56} icon="user" /> : <Avatar size={56} warm initials={b.initials} />}
        <View style={s.grow}>
          <T w="b" size={17}>{b.name}</T>
          <T size={12} c={D.sub} style={{ marginTop: 3 }}>
            {b.isWalkIn ? 'Walk-in · no account'
              : rel ? `${rel.visits} visit${rel.visits === 1 ? '' : 's'} · ${rel.no_shows ? `${rel.no_shows} no-show${rel.no_shows > 1 ? 's' : ''}` : 'no no-shows'}`
                : ' '}
          </T>
          {stars != null && <View style={{ marginTop: 3 }}><Stars n={stars} size={11} /></View>}
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"
          style={({ pressed }) => [s.close, pressed && s.pressed]}>
          <Ico name="x" size={16} />
        </Pressable>
      </View>

      <View style={s.detail}>
        <Row label="Service" value={`${b.service} · ${b.durationMin} min`} />
        <Row label="Slot" value={`${b.whenLabel} · ${b.timeLabel}`} />
        {b.checkedInAt && (
          <Row label="Checked in" color={D.green}
            value={`${hhmm(b.checkedInAt)}${b.startedAt ? ` · in chair ${hhmm(b.startedAt)}` : ''}`} />
        )}
        <View style={s.rule} />
        <View style={s.detailRowBase}>
          <T w="b" size={13}>Collect in cash</T>
          <T w="eb" size={20} c={D.accent} style={s.tnum}>{dh(b.priceCents)}</T>
        </View>
      </View>

      <View style={s.tiles}>
        <Tile icon="message-circle" label="Chat" onPress={b.isWalkIn ? undefined : onChat} />
        <Tile icon="phone" label="Call"
          onPress={b.phone ? () => Linking.openURL(`tel:${b.phone}`) : undefined} />
        <Tile icon="clock" label="History" onPress={onHistory} />
        {/* ponytail: coupons need the promotions table — BACKLOG "Flash discounts" */}
        <Tile icon="tag" label="Coupon"
          onPress={() => Alert.alert('Coupons', 'Coming soon — see BACKLOG.md')} />
      </View>

      <Btn title={`MARK DONE · COLLECT ${dh(b.priceCents)}`} height={54} icon="check"
        bg={D.green} fg={D.bg} onPress={onDone} />
      <View style={s.footRow}>
        <GhostBtn title="RESCHEDULE" height={48} style={s.grow} onPress={onReschedule} />
        <GhostBtn title="NO-SHOW" height={48} style={s.grow} color={D.red} border={D.redLine}
          onPress={onNoShow} />
      </View>
    </Sheet>
  );
}

// ---- 3d · booking request, with the shop's flag on it ---------------------
export function BookingRequestSheet({
  visible, booking, onClose, onAccept, onDecline, onClearFlag,
}: {
  visible: boolean; booking: PanelBooking | null; onClose: () => void;
  onAccept: () => void; onDecline: () => void; onClearFlag: () => void;
}) {
  const rel = useReliability(booking?.customerId, booking?.isWalkIn, visible);
  if (!booking) return null;
  const b = booking;
  const stars = rel && rel.avg_rating != null ? Math.round(Number(rel.avg_rating)) : null;
  const flagged = !!rel?.flagged;

  return (
    <Sheet visible={visible} onClose={onClose} deep>
      <SheetHead title="Booking request" onClose={onClose} left />

      <View style={s.reqHead}>
        <Avatar size={52} initials={b.initials} />
        <View style={s.grow}>
          <T w="b" size={16}>{b.name}</T>
          <View style={s.reqMeta}>
            {stars != null && <Stars n={stars} size={11} />}
            <T size={11} c={D.sub}>
              {rel ? `${rel.visits} visit${rel.visits === 1 ? '' : 's'}${rel.no_shows ? ` · ${rel.no_shows} no-show${rel.no_shows > 1 ? 's' : ''}` : ''}` : 'New client'}
            </T>
          </View>
        </View>
      </View>

      {flagged && (
        <View style={s.flagCard}>
          <View style={s.flagTitle}>
            <Ico name="alert-triangle" size={15} color={D.amber} />
            <T w="b" size={11} c={D.amber} ls={1.4}>FLAGGED BY YOUR SHOP</T>
          </View>
          <T size={13} c={D.textDim} style={s.flagBody}>
            {rel?.reason ?? 'Reliability flag on this client.'}
            {rel?.no_shows ? ` ${rel.no_shows} missed booking${rel.no_shows > 1 ? 's' : ''}` : ''}
            {rel?.last_no_show_days != null ? `, last one ${rel.last_no_show_days} days ago.` : '.'}
          </T>
          {rel?.require_full_payment && (
            <View style={s.flagFoot}>
              <View style={s.flagDot}><Ico name="lock" size={10} color={D.amber} /></View>
              {/* ponytail: the wallet is credit-only (0022), so we state the terms, not a
                  settled payment — the debit rail is the open BACKLOG Phase-2 item. */}
              <T w="sb" size={12} c={D.amber}>
                You asked for {dh(b.priceCents)} up front · due at the shop
              </T>
            </View>
          )}
        </View>
      )}

      <View style={s.detail}>
        <Row label="Service" value={`${b.service} · ${b.durationMin} min`} />
        <Row label="Slot" value={`${b.whenLabel} · ${b.timeLabel}`} />
        <Row label="Price" value={dh(b.priceCents)} />
      </View>

      <Note bg={D.card2} radius={14}>
        Declining frees the slot straight away and tells {b.name.split(' ')[0]} in chat.
      </Note>

      <View style={s.footRow}>
        <GhostBtn title="DECLINE" height={54} style={s.grow} onPress={onDecline} />
        <Btn title="ACCEPT" height={54} icon="check" bg={D.green} fg={D.bg}
          style={s.growWide} onPress={onAccept} />
      </View>
      {flagged && (
        <Pressable onPress={onClearFlag} accessibilityRole="button"
          style={({ pressed }) => pressed && s.pressed}>
          <T w="sb" size={12} c={D.sub} style={s.center}>Clear his flag</T>
        </Pressable>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  growWide: { flex: 1.4 },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 },
  center: { textAlign: 'center' },
  tnum: { fontVariant: ['tabular-nums'] },

  head: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  close: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  detail: { backgroundColor: D.card, borderRadius: 18, padding: 16, gap: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailRowBase: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rule: { height: 1, backgroundColor: D.border },

  tiles: { flexDirection: 'row', gap: 9 },
  tile: {
    flex: 1, alignItems: 'center', gap: 7, backgroundColor: D.card,
    borderRadius: 16, paddingVertical: 13,
  },
  footRow: { flexDirection: 'row', gap: 10 },

  reqHead: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  reqMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  flagCard: {
    backgroundColor: 'rgba(232,161,0,0.10)', borderWidth: 1, borderColor: 'rgba(232,161,0,0.32)',
    borderRadius: 18, padding: 15, paddingHorizontal: 16, gap: 11,
  },
  flagTitle: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  flagBody: { lineHeight: 20 },
  flagFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(232,161,0,0.2)', paddingTop: 11,
  },
  flagDot: {
    width: 18, height: 18, borderRadius: 999, backgroundColor: D.amberSoft16,
    alignItems: 'center', justifyContent: 'center',
  },
});
