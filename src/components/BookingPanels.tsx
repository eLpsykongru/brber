import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import {
  canTakeOff, ChairRow, collectCents, ladderOf, verbOf, Verb,
} from '../lib/line';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import {
  Avatar, Btn, Eyebrow, GhostBtn, Ico, IconName, Note, Sheet, SheetHead, Stars, T,
} from './dark';

// BTD-21 (one row of the chair, on its rungs) and 3d (a request from a flagged client).
// Both read client_reliability, which is barber-private (0030).

export type PanelBooking = {
  id: string; customerId: string; name: string; initials: string;
  service: string; durationMin: number; whenLabel: string; timeLabel: string;
  priceCents: number;
  /** BTD-03 — already held from the wallet. `collect` is price minus this, and
   *  it is the number he says out loud; the full price would charge it twice. */
  depositCents?: number;
  checkedInAt: string | null; startedAt: string | null;
  phone: string | null; isWalkIn: boolean;
  notes?: string | null;   // 39d — what the customer wrote when booking
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

// ---- BTD-21 · one row, opened — the four rungs ----------------------------
// Replaces 1d/BTD-03, which printed "in chair 11:02" as a fact nothing ever set. The
// rung between here and done is a button now, and the button is read off where the row
// sits (line.ts verbOf), never off who the customer is. A walk-in opens the same sheet
// with CALL HIM on top and no deposit line.

export type RowSheet = {
  row: ChairRow & { created_at: string };
  /** Nº in today's book; 0 for a booking on another day */
  no: number;
  /** who SEAT HIM frees to be called */
  frees: number | null;
  /** a web name that never tapped his text: CALL HIM asks first (BTD-17) */
  unconfirmed: boolean;
  /** why "Another day" cannot be offered; null when it can */
  anotherDayOff: string | null;
};

const VERB_SUB = (v: Verb, sheet: RowSheet, isWalkIn: boolean): string => {
  switch (v) {
    case 'CALL HIM':
      return sheet.unconfirmed ? "He never tapped his text · you'll be asked first"
        : isWalkIn ? 'Shout the name · the chair holds eight minutes'
          : "Tells him in chat he's next · the chair holds eight minutes";
    case "HE'S HERE": return 'He walked in · seat him when the chair is free';
    case 'SEAT HIM':
      return sheet.frees ? `Starts the clock · frees Nº ${String(sheet.frees).padStart(2, '0')} to be called` : 'Starts the clock';
    case 'DONE': return 'Can be put back until the next man sits down';
  }
};

function whenOf(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? hhmm(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function BookingPanelSheet({
  visible, booking, sheet, barberId, onClose, onPrimary, onChat, onService, onHistory, onAnotherDay, onTakeOff,
}: {
  visible: boolean; booking: PanelBooking | null; sheet: RowSheet | null; barberId: string;
  onClose: () => void;
  /** CALL HIM, HE'S HERE, SEAT HIM or DONE — whichever the row's rung carries */
  onPrimary: () => void;
  onChat?: () => void; onHistory?: () => void; onAnotherDay?: () => void; onTakeOff?: () => void;
  /** the tick-off-what-you-did checklist (34f): a changed service is priced at the till, so it only opens in the chair */
  onService?: () => void;
}) {
  const rel = useReliability(booking?.customerId, booking?.isWalkIn, visible);
  if (!booking || !sheet) return null;
  const b = booking;
  const r = sheet.row;
  const verb = verbOf(r, barberId);
  const steps = ladderOf(r, barberId);
  const cash = dh(collectCents(r));
  const takeOff = canTakeOff(r, barberId, Date.now());
  const ahead = verb === 'CALL HIM' || verb === "HE'S HERE" || verb === 'SEAT HIM';

  return (
    <Sheet visible={visible} onClose={onClose} gap={14} deep>
      <View style={s.head}>
        {b.isWalkIn
          ? <View style={s.ticketBig}><T w="b" size={14} c={D.sub}>{sheet.no ? String(sheet.no).padStart(2, '0') : '—'}</T></View>
          : <Avatar size={50} warm initials={b.initials} />}
        <View style={s.grow}>
          <T w="b" size={16}>{b.name}</T>
          <T size={11.5} c={D.sub} style={{ marginTop: 3 }}>
            {b.service} · {b.durationMin} min · {b.isWalkIn ? 'no account'
              : rel ? `${rel.visits} visit${rel.visits === 1 ? '' : 's'}` : ' '}
          </T>
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"
          style={({ pressed }) => [s.close, pressed && s.pressed]}>
          <Ico name="x" size={15} />
        </Pressable>
      </View>

      <View style={s.ladder} accessibilityLabel={`Where he is: ${steps.find((x) => x.state === 'next')?.label ?? 'done'}`}>
        {steps.map((step, i) => (
          <View key={step.label} style={[s.rungRow, i > 0 && s.rungSeam, step.state === 'later' && s.dim]}>
            {step.state === 'past' ? (
              <View style={s.rungPast}><Ico name="check" size={12} color={D.bg} /></View>
            ) : step.state === 'next' ? (
              <View style={s.rungNext}><View style={s.rungNextDot} /></View>
            ) : (
              <View style={s.rungLater} />
            )}
            <T w={step.state === 'next' ? 'eb' : 'sb'} size={step.state === 'next' ? 13.5 : 13}
              c={step.state === 'next' ? D.text : D.sub} style={s.grow}>{step.label}</T>
            {step.state === 'next'
              ? <T w="b" size={11} c={D.accent} ls={0.66}>NEXT STEP</T>
              : step.at && step.state === 'past'
                ? <T size={11.5} c={D.faint} style={s.tnum}>{whenOf(step.at)}</T>
                : null}
          </View>
        ))}
      </View>

      {/* 39d — he reads this in the chair, which is why it sits over the buttons */}
      {b.notes ? (
        <View style={s.asked}>
          <View style={s.askedHead}>
            <Ico name="message-square" size={13} color={D.amber} />
            <T w="b" size={9.5} c={D.amber} ls={1.3}>HE ASKED FOR</T>
          </View>
          <T size={13} style={{ lineHeight: 19.5 }}>“{b.notes}”</T>
        </View>
      ) : null}

      <View style={s.tiles}>
        {!b.isWalkIn && <Tile icon="message-circle" label="Chat" onPress={onChat} />}
        {b.phone && <Tile icon="phone" label="Call" onPress={() => Linking.openURL(`tel:${b.phone}`)} />}
        {verb === 'DONE' && onService && <Tile icon="scissors" label="Service" onPress={onService} />}
        <Tile icon="clock" label="History" onPress={onHistory} />
      </View>
      {b.isWalkIn && (
        <T size={11} c={D.faint} style={s.fact}>
          No chat with a guest — there's no account to message.{b.phone ? ' Use the phone.' : ''}
        </T>
      )}

      {verb && (
        <Pressable onPress={onPrimary} accessibilityRole="button"
          accessibilityLabel={verb === 'DONE' ? `Done, collect ${cash}` : verb}
          style={({ pressed }) => [s.primary, verb === 'DONE' && { backgroundColor: D.green }, pressed && s.pressed]}>
          <View style={s.primaryTitle}>
            {verb === 'DONE' && <Ico name="check" size={15} color={D.bg} />}
            <T w="eb" size={13} c={verb === 'DONE' ? D.bg : '#fff'} ls={0.65}>
              {verb === 'DONE' ? `DONE · COLLECT ${cash}` : verb}
            </T>
          </View>
          <T size={10.5} c={verb === 'DONE' ? 'rgba(13,13,15,0.7)' : 'rgba(255,255,255,0.75)'}>
            {VERB_SUB(verb, sheet, b.isWalkIn)}
          </T>
        </Pressable>
      )}

      {ahead && (
        <View style={s.footRow}>
          <Pressable onPress={sheet.anotherDayOff ? undefined : onAnotherDay} disabled={!!sheet.anotherDayOff}
            accessibilityRole="button" accessibilityLabel="Another day"
            style={({ pressed }) => [s.second, !!sheet.anotherDayOff && s.off, pressed && s.pressed]}>
            <T w="b" size={12} c={D.textDim}>Another day</T>
          </Pressable>
          {takeOff && (
            <Pressable onPress={onTakeOff} accessibilityRole="button"
              style={({ pressed }) => [s.second, { borderColor: D.redLine }, pressed && s.pressed]}>
              <T w="b" size={12} c={D.red}>{b.isWalkIn ? 'Take him off' : 'No-show'}</T>
            </Pressable>
          )}
        </View>
      )}
      {ahead && sheet.anotherDayOff && (
        <T size={11} c={D.faint} style={s.fact}>Another day · {sheet.anotherDayOff}</T>
      )}
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
        {/* 39d — he reads this in the chair, which is why it sits with the service */}
        {b.notes ? <Row label="They said" value={b.notes} /> : null}
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
  dim: { opacity: 0.45 },
  fact: { textAlign: 'center', lineHeight: 16.5, paddingHorizontal: 6 },

  // BTD-21
  ticketBig: {
    width: 50, height: 50, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  ladder: { backgroundColor: D.card, borderRadius: 18, paddingVertical: 4, paddingHorizontal: 16 },
  rungRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  rungSeam: { borderTopWidth: 1, borderTopColor: D.seam },
  rungPast: {
    width: 22, height: 22, borderRadius: 999, backgroundColor: D.green,
    alignItems: 'center', justifyContent: 'center',
  },
  rungNext: {
    width: 22, height: 22, borderRadius: 999, borderWidth: 2, borderColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  rungNextDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: D.accent },
  rungLater: { width: 22, height: 22, borderRadius: 999, borderWidth: 2, borderColor: D.muted },
  asked: {
    backgroundColor: D.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 9,
    borderWidth: 2, borderColor: D.amber,
  },
  askedHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primary: {
    height: 54, borderRadius: 16, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  primaryTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  second: {
    flex: 1, height: 44, borderRadius: 14, backgroundColor: D.card, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },

  detail: { backgroundColor: D.card, borderRadius: 18, padding: 16, gap: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailRowBase: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rule: { height: 1, backgroundColor: D.border },

  tiles: { flexDirection: 'row', gap: 9 },
  tile: {
    flex: 1, alignItems: 'center', gap: 6, backgroundColor: D.card,
    borderRadius: 14, paddingVertical: 11,
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
