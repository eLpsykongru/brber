import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import { Btn, Eyebrow, GhostBtn, Ico, RadioRow, Sheet, T, Toggle } from './dark';

// 1r — the barber cancelling. Reason is required (cancel_booking carries it into
// the chat, our only notification surface until push lands).
const REASONS = [
  'Client requested',
  'Client no-show',
  "I'm unavailable",
  'Double booked',
  'Emergency',
];

export type CancelTarget = {
  id: string; name: string; time: string; isWalkIn: boolean;
  nextFreeLabel?: string | null;   // "Fri 11:30" — the slot we offer instead
};

export default function CancelBookingSheet({ visible, target, onClose, onCancelled }: {
  visible: boolean; target: CancelTarget | null; onClose: () => void; onCancelled: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [offer, setOffer] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (visible) { setReason(null); setOffer(true); } }, [visible, target?.id]);

  if (!target) return null;
  const t = target;
  const firstName = t.name.split(' ')[0];

  async function confirm() {
    if (!reason) return Alert.alert('Pick a reason', 'The client is told why, so pick one.');
    setBusy(true);
    const { error } = await supabase.rpc('cancel_booking', { p_booking: t.id, p_reason: reason });
    if (error) { setBusy(false); return Alert.alert('Could not cancel', error.message); }
    // the "offer" is a chat message, not a proposal — see BACKLOG bet #4
    if (offer && t.nextFreeLabel && !t.isWalkIn) {
      await supabase.from('messages').insert({
        booking_id: t.id,
        body: `Sorry about that — I have ${t.nextFreeLabel} free if it works for you.`,
      });
    }
    setBusy(false);
    onCancelled();
  }

  return (
    <Sheet visible={visible} onClose={onClose} deep>
      <View style={s.head}>
        <View style={s.warnCircle}><Ico name="alert-triangle" size={25} color={D.accent} /></View>
        <T w="b" size={19} style={s.title}>Cancel {firstName}'s {t.time}?</T>
        <T size={13} c={D.sub} style={s.sub}>
          {t.isWalkIn
            ? 'The slot opens back up straight away.'
            : `${firstName} gets the reason in chat and the slot opens back up.`}
        </T>
      </View>
      <Eyebrow ls={1.4}>REASON</Eyebrow>
      <View style={{ gap: 8 }}>
        {REASONS.map((r) => (
          <RadioRow key={r} label={r} on={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      {!!t.nextFreeLabel && !t.isWalkIn && (
        <View style={s.offerRow}>
          <T size={12} c={D.sub} style={s.offerText}>
            Offer him your next free slot — {t.nextFreeLabel}
          </T>
          <Toggle on={offer} onPress={() => setOffer(!offer)} />
        </View>
      )}
      <Btn title="CANCEL THE BOOKING" height={52} onPress={confirm}
        style={busy ? { opacity: 0.6 } : undefined} />
      <GhostBtn title="KEEP THE BOOKING" height={50} onPress={onClose} />
    </Sheet>
  );
}

const s = StyleSheet.create({
  head: { alignItems: 'center', paddingTop: 4 },
  warnCircle: {
    width: 58, height: 58, borderRadius: 999, backgroundColor: D.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { marginTop: 12, textAlign: 'center' },
  sub: { marginTop: 7, textAlign: 'center', lineHeight: 20 },
  offerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 16, padding: 13, paddingHorizontal: 15,
  },
  offerText: { flex: 1, lineHeight: 17 },
});
