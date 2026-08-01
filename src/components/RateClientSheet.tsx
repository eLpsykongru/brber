import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { dark as D, inter } from '../theme';
import {
  Avatar, Btn, Eyebrow, GhostBtn, Ico, RadioRow, Serif, Sheet, SheetHead, Stars, T, Toggle,
} from './dark';

// "Barber App.dc.html" turn 3 — 3a rate → 3b what went wrong (≤2 stars) → 3c saved.
// Barber-side stars are about reliability, not the haircut, and never leave the shop.

export type RateTarget = {
  id: string; customerId: string; name: string; initials: string;
  service: string; time: string; priceCents: number;
  isWalkIn: boolean; hasPhone: boolean;
  lateMin?: number | null;
};

export type NextInChair = {
  ticket: string; label: string; service: string; waitingMin: number; priceCents: number;
};

const TAGS = ['On time', 'Knew what he wanted', 'Easy going', 'Tipped', 'Regular'];
const VERDICT = ['', 'Hard to have in', 'Difficult', 'Fine', 'Good client', 'Great client'];
const dh = (cents: number) => `${Math.round(cents / 100)} DH`;
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][n % 100] ?? 'th'}`;

export default function RateClientSheet({
  visible, onClose, onDone, barberId, booking, bookedTodayCents, next, onAskInChat, onAskBySms,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: () => void;
  barberId: string;
  booking: RateTarget | null;
  bookedTodayCents: number;
  next?: NextInChair | null;
  onAskInChat?: () => void;
  onAskBySms?: () => void;
}) {
  const [step, setStep] = useState<'rate' | 'wrong' | 'done'>('rate');
  const [stars, setStars] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [upFront, setUpFront] = useState(true);
  const [visits, setVisits] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // reset per client, and pull the visit count 3a puts next to the service
  useEffect(() => {
    if (!visible || !booking) return;
    setStep('rate'); setStars(5); setTags([]); setNote(''); setReason(null); setUpFront(true);
    if (booking.isWalkIn) return setVisits(null);
    supabase.rpc('client_reliability', { p_customer: booking.customerId })
      .then(({ data }) => setVisits(data?.[0]?.visits ?? null));
  }, [visible, booking?.id]);

  if (!booking) return null;
  const b = booking;
  const firstName = b.name.split(' ')[0];
  const lateReason = b.lateMin ? `Turned up ${b.lateMin} min late` : 'Turned up late';
  const REASONS = [lateReason, "Didn't turn up at all", 'Argued over the price', 'Left without paying', 'Disrespectful'];

  const toggleTag = (t: string) =>
    setTags((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);

  async function save(alsoFlag: boolean, blocked = false) {
    if (b.isWalkIn) { setStep('done'); return; } // no account to attach a rating to
    setSaving(true);
    const { error } = await supabase.from('client_ratings').insert({
      booking_id: b.id, rating: stars, tags: alsoFlag && reason ? [reason] : tags, note: note || null,
    });
    if (error && !error.message.includes('duplicate')) {
      setSaving(false);
      return Alert.alert('Could not save', error.message);
    }
    if (alsoFlag) {
      const { error: fe } = await supabase.from('client_flags').upsert({
        barber_id: barberId, customer_id: b.customerId,
        reason, require_full_payment: upFront, blocked,
      });
      if (fe) { setSaving(false); return Alert.alert('Could not flag', fe.message); }
    }
    setSaving(false);
    setStep('done');
  }

  function onPrimary() {
    if (stars <= 2) return setStep('wrong');
    save(false);
  }

  // ---- 3c · saved, back to the chair
  if (step === 'done') {
    return (
      <Sheet visible={visible} onClose={onDone} deep gap={15}>
        <View style={s.doneHead}>
          <View style={s.doneCircle}><Ico name="check" size={27} color={D.green} /></View>
          <Serif size={23} ls={0.02} style={{ marginTop: 13 }}>Cut logged</Serif>
          <T size={13} c={D.sub} style={s.doneSub}>
            {firstName}'s rated and paid up. Your day is {dh(b.priceCents)} better.
          </T>
        </View>
        <View style={s.summary}>
          <Row label="Service" value={b.service} />
          <Row label="Collected in cash" value={dh(b.priceCents)} />
          {!b.isWalkIn && (
            <View style={s.sumRow}>
              <T size={13} c={D.sub}>You rated him</T>
              <Stars n={stars} size={13} />
            </View>
          )}
          <View style={s.rule} />
          <View style={s.sumRowBase}>
            <T w="b" size={13}>Booked today</T>
            <T w="eb" size={20} c={D.accent} style={s.tnum}>{dh(bookedTodayCents)}</T>
          </View>
        </View>
        {next && (
          <View style={s.nextCard}>
            <View style={s.ticket}><T w="b" size={12} c={D.sub}>{next.ticket}</T></View>
            <View style={{ flex: 1 }}>
              <Eyebrow ls={1.4}>NEXT IN THE CHAIR</Eyebrow>
              <T w="b" size={14} style={{ marginTop: 3 }}>{next.label} · {next.service}</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                Waiting {next.waitingMin} min · {dh(next.priceCents)}
              </T>
            </View>
          </View>
        )}
        <Btn title={next ? 'CALL NEXT CLIENT' : 'BACK TO THE CHAIR'} height={54} onPress={onDone} />
        {!b.isWalkIn && onAskInChat && (
          <Pressable onPress={onAskInChat} accessibilityRole="button"
            style={({ pressed }) => pressed && s.pressed}>
            <T w="sb" size={12} c={D.sub} style={s.center}>Ask {firstName} for a review</T>
          </Pressable>
        )}
      </Sheet>
    );
  }

  // ---- 3b · low rating, what happens next
  if (step === 'wrong') {
    return (
      <Sheet visible={visible} onClose={onClose} deep>
        <SheetHead title="What went wrong?" onBack={() => setStep('rate')} onClose={onClose} />
        <View style={s.clientRow}>
          <Avatar size={48} initials={b.initials} />
          <View style={{ flex: 1 }}>
            <T w="b" size={15}>{b.name}</T>
            <T size={11} c={D.sub} style={{ marginTop: 3 }}>{b.service} · {b.time}</T>
          </View>
          <Stars n={stars} size={12} />
        </View>
        <View style={{ gap: 8 }}>
          {REASONS.map((r) => (
            <RadioRow key={r} label={r} on={reason === r} onPress={() => setReason(r)} />
          ))}
        </View>
        <View style={s.flagCard}>
          <View style={s.flagIcon}><Ico name="alert-triangle" size={16} color={D.amber} /></View>
          <View style={{ flex: 1 }}>
            <T w="b" size={13}>Ask for full payment next time</T>
            <T size={11} c={D.sub} style={{ marginTop: 2 }}>He can only book with 100% up front</T>
          </View>
          <Toggle on={upFront} onPress={() => setUpFront(!upFront)} color={D.accent} />
        </View>
        <View style={s.privateNote}>
          <Ico name="info" size={14} color={D.sub} />
          <T size={12} c={D.sub} style={s.privateNoteText}>
            {firstName} never sees this. It shows to your shop as a flag when he books again.
          </T>
        </View>
        <Btn title="SAVE PRIVATELY" height={54} onPress={() => save(true)} />
        <GhostBtn title="BLOCK FROM BOOKING ME" color={D.red} border={D.redLine} height={50}
          onPress={() => Alert.alert('Block this client?', `${b.name} will not be able to book you again.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Block', style: 'destructive', onPress: () => save(true, true) },
          ])} />
      </Sheet>
    );
  }

  // ---- 3a · rate the client
  return (
    <Sheet visible={visible} onClose={onClose} deep>
      <SheetHead title="Rate the client" onClose={onClose} />
      <View style={s.collected}>
        <Ico name="check" size={15} color={D.green} />
        <T w="sb" size={12} c={D.green} style={{ flex: 1 }}>
          Done · {dh(b.priceCents)} collected in cash
        </T>
      </View>
      <View style={s.clientRow}>
        <Avatar size={48} warm initials={b.initials} />
        <View style={{ flex: 1 }}>
          <T w="b" size={15}>{b.name}</T>
          <T size={11} c={D.sub} style={{ marginTop: 3 }}>
            {visits ? `${ordinal(visits)} visit · ` : ''}{b.service} · {b.time}
          </T>
        </View>
      </View>

      {b.isWalkIn ? (
        <T size={13} c={D.sub} style={s.center}>
          Walk-ins have no account, so there's nothing to rate.
        </T>
      ) : (
        <>
          <T size={13} c={D.sub} style={[s.center, { marginTop: 2 }]}>
            Was {firstName} easy to have in the chair?
          </T>
          <View style={s.starsRow}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Pressable key={i} onPress={() => setStars(i)} hitSlop={4}
                accessibilityRole="button" accessibilityLabel={`${i} star${i > 1 ? 's' : ''}`}
                accessibilityState={{ selected: stars >= i }}>
                <Ico name="star" size={40} color={stars >= i ? D.amber : D.muted} />
              </Pressable>
            ))}
          </View>
          <T w="b" size={13} c={D.amber} style={s.center}>{VERDICT[stars]}</T>
          <View style={s.tagRow}>
            {TAGS.map((t) => {
              const on = tags.includes(t);
              return (
                <Pressable key={t} onPress={() => toggleTag(t)} accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [s.tag, on && s.tagOn, pressed && s.pressed]}>
                  <T w={on ? 'b' : 'sb'} size={12} c={on ? '#fff' : D.sub}>{t}</T>
                </Pressable>
              );
            })}
          </View>
          <View style={{ gap: 8 }}>
            <View style={s.lockRow}>
              <Ico name="lock" size={11} color={D.sub} />
              <Eyebrow ls={1.4}>PRIVATE NOTE · ONLY YOUR SHOP SEES THIS</Eyebrow>
            </View>
            <TextInput value={note} onChangeText={setNote}
              placeholder="Skin fade, no clippers on top" placeholderTextColor={D.sub}
              accessibilityLabel="Private note about this client" style={s.noteInput} />
          </View>
        </>
      )}

      <Btn title={b.isWalkIn ? 'NEXT CLIENT' : 'SAVE & NEXT CLIENT'} height={54}
        onPress={onPrimary} style={saving ? { opacity: 0.6 } : undefined} />
      <Pressable onPress={onDone} accessibilityRole="button" style={({ pressed }) => pressed && s.pressed}>
        <T w="sb" size={12} c={D.sub} style={s.center}>Skip</T>
      </Pressable>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.sumRow}>
      <T size={13} c={D.sub}>{label}</T>
      <T w="b" size={13}>{value}</T>
    </View>
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.7 },
  center: { textAlign: 'center' },
  tnum: { fontVariant: ['tabular-nums'] },

  collected: {
    flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, padding: 13,
    paddingHorizontal: 15, backgroundColor: D.greenSoft10, borderWidth: 1, borderColor: D.greenLine,
  },
  clientRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: D.card,
    borderRadius: 18, padding: 14, paddingHorizontal: 16,
  },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 13 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  tag: { borderRadius: 999, backgroundColor: D.card2, paddingVertical: 9, paddingHorizontal: 15 },
  tagOn: { backgroundColor: '#101010', borderWidth: 1, borderColor: D.accent },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteInput: {
    backgroundColor: D.card2, borderRadius: 16, height: 52, paddingHorizontal: 16,
    fontFamily: inter.r, fontSize: 14, color: D.text,
  },

  flagCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 18, padding: 14, paddingHorizontal: 16,
  },
  flagIcon: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.amberSoft16,
    alignItems: 'center', justifyContent: 'center',
  },
  privateNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.card2,
    borderRadius: 14, padding: 12, paddingHorizontal: 14,
  },
  privateNoteText: { flex: 1, lineHeight: 18 },

  doneHead: { alignItems: 'center', paddingTop: 6 },
  doneCircle: {
    width: 62, height: 62, borderRadius: 999, backgroundColor: D.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  doneSub: { textAlign: 'center', marginTop: 8, lineHeight: 20 },
  summary: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 11 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumRowBase: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rule: { height: 1, backgroundColor: D.border },
  nextCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 20, padding: 14, paddingHorizontal: 16, borderWidth: 2, borderColor: D.accent,
  },
  ticket: {
    width: 44, height: 44, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
});
