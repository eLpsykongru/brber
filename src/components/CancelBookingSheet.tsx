import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import { Btn, Eyebrow, GhostBtn, Ico, RadioRow, Sheet, T, Toggle } from './dark';
import { en, tr } from '../lib/i18n';

// 1r — the barber cancelling. Reason is required (cancel_booking carries it into
// the chat, our only notification surface until push lands).
// kept in English: cancel_booking writes the reason into the chat
const REASONS = [
  en('Client requested'),
  en('Client no-show'),
  en("I'm unavailable"),
  en('Double booked'),
  en('Emergency'),
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
    if (!reason) return Alert.alert(tr('Pick a reason'), tr('The client is told why, so pick one.'));
    setBusy(true);
    const { error } = await supabase.rpc('cancel_booking', { p_booking: t.id, p_reason: reason });
    if (error) { setBusy(false); return Alert.alert(tr('Could not cancel'), error.message); }
    // the "offer" is a chat message, not a proposal — see BACKLOG bet #4
    if (offer && t.nextFreeLabel && !t.isWalkIn) {
      await supabase.from('messages').insert({
        booking_id: t.id,
        body: tr('Sorry about that — I have {slot} free if it works for you.', { slot: t.nextFreeLabel }),
      });
    }
    setBusy(false);
    onCancelled();
  }

  return (
    <Sheet visible={visible} onClose={onClose} deep>
      <View style={s.head}>
        <View style={s.warnCircle}><Ico name="alert-triangle" size={25} color={D.accent} /></View>
        <T w="b" size={19} style={s.title}>{tr('Cancel {firstName}\'s {time}?', { firstName, time: t.time })}</T>
        <T size={13} c={D.sub} style={s.sub}>
          {t.isWalkIn
            ? tr('The slot opens back up straight away.')
            : tr('{firstName} gets the reason in chat and the slot opens back up.', { firstName })}
        </T>
      </View>
      <Eyebrow ls={1.4}>{tr('REASON')}</Eyebrow>
      <View style={{ gap: 8 }}>
        {REASONS.map((r) => (
          <RadioRow key={r} label={tr(r)} on={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      {!!t.nextFreeLabel && !t.isWalkIn && (
        <View style={s.offerRow}>
          <T size={12} c={D.sub} style={s.offerText}>
            {tr('Offer him your next free slot — {nextFreeLabel}', { nextFreeLabel: t.nextFreeLabel })}
          </T>
          <Toggle on={offer} onPress={() => setOffer(!offer)} />
        </View>
      )}
      <Btn title={tr('CANCEL THE BOOKING')} height={52} onPress={confirm}
        style={busy ? { opacity: 0.6 } : undefined} />
      <GhostBtn title={tr('KEEP THE BOOKING')} height={50} onPress={onClose} />
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
