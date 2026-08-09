import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Display } from './ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, shadowLg } from '../theme';

// 8e of "Barber App.dc.html", customer end — a slot Youssef just lost has been
// offered to you and one other person. The whole design of it is in one line:
// "Nothing is held until you tap take." No hold, no queue position, no penalty
// for ignoring it — so the countdown is the only pressure, and it's honest.

type Offer = {
  id: string; starts_at: string; expires_at: string;
  service: string; price_cents: number; duration_min: number;
  barber_id: string; barber: string; salon: string | null; sent_to: number;
};

const dh = (c: number) => (c / 100).toFixed(0);
const MIN_PCT = 40; // mirrors fill_booking's floor; the server re-checks

function useCountdown(iso: string | undefined) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const tick = () => setLeft(Math.max(0, new Date(iso).getTime() - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [iso]);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return { left, label: `${m}:${String(s).padStart(2, '0')}` };
}

export default function SlotOfferSheet({ myId, onTaken }: {
  myId: string; onTaken: (bookingId: string) => void;
}) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [walletCents, setWalletCents] = useState(0);
  const [busy, setBusy] = useState(false);
  const { left, label } = useCountdown(offer?.expires_at);

  const load = useCallback(async () => {
    const [{ data }, w] = await Promise.all([
      supabase.rpc('my_slot_offers'),
      supabase.from('wallet_transactions').select('amount_cents'),
    ]);
    setWalletCents((w.data ?? []).reduce((a: number, r: any) => a + r.amount_cents, 0));
    setOffer(((data as Offer[]) ?? [])[0] ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);
  // an offer that expires while you're staring at it should close itself
  useEffect(() => { if (offer && left === 0) setOffer(null); }, [offer, left]);

  if (!offer) return null;

  const deposit = Math.ceil((offer.price_cents * MIN_PCT) / 100);
  const canDeposit = walletCents >= deposit;
  const at = new Date(offer.starts_at).toTimeString().slice(0, 5);

  async function take() {
    setBusy(true);
    const { data, error } = await supabase.rpc('claim_slot_offer',
      { p_offer: offer!.id, p_deposit_cents: canDeposit ? deposit : 0 });
    setBusy(false);
    if (error) { setOffer(null); return Alert.alert('That slot is gone', error.message); }
    setOffer(null);
    onTaken(data as string);
  }

  async function decline() {
    const id = offer!.id;
    setOffer(null);
    await supabase.rpc('decline_slot_offer', { p_offer: id });
    load();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={decline}>
      <View style={s.scrim}>
        <View style={s.sheet}>
          <View style={s.grabber} />

          <View style={s.center}>
            <View style={s.icon}>
              <Ionicons name="flash-outline" size={26} color={colors.accent} />
            </View>
            <Display size={23} style={s.title}>A slot opened</Display>
            <Text style={s.sub}>
              {offer.barber.split(' ')[0]} has {at} free today — you're one of {offer.sent_to}
              {' '}{offer.sent_to === 1 ? 'person' : 'people'} being asked.
            </Text>
          </View>

          <View style={s.hero}>
            <View style={s.heroTop}>
              <View>
                <Text style={s.heroEyebrow}>TODAY</Text>
                <Text style={s.heroTime}>{at}</Text>
              </View>
              <View style={s.right}>
                <Text style={s.heroEyebrow}>{offer.service.toUpperCase()}</Text>
                <Text style={s.heroPrice}>{dh(offer.price_cents)} DH</Text>
              </View>
            </View>
            <View style={s.heroFoot}>
              <View style={s.heroAvatar}>
                <Text style={s.heroAvatarText}>
                  {offer.barber.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
                </Text>
              </View>
              <Text style={s.heroWho} numberOfLines={1}>
                {offer.barber.split(' ')[0]}{offer.salon ? ` · ${offer.salon}` : ''} · {offer.duration_min} min
              </Text>
            </View>
          </View>

          <View style={s.raceCard}>
            <View style={s.raceIcon}>
              <Ionicons name="people-outline" size={15} color={colors.accent} />
            </View>
            <Text style={s.raceText}>
              Sent to {offer.sent_to} {offer.sent_to === 1 ? 'person' : 'people'} — first to take it gets it.
            </Text>
            <Text style={s.raceClock}>{label}</Text>
          </View>

          <View style={s.ctas}>
            <Pressable onPress={take} disabled={busy}
              style={({ pressed }) => [s.takeBtn, (pressed || busy) && s.pressed]}>
              {busy ? <ActivityIndicator color="#fff" /> : (
                <Text style={s.takeText}>
                  TAKE {at}{canDeposit ? ` · ${dh(deposit)} DH DEPOSIT` : ''}
                </Text>
              )}
            </Pressable>
            <Pressable onPress={decline} style={({ pressed }) => [s.noBtn, pressed && s.pressed]}>
              <Text style={s.noText}>NO THANKS</Text>
            </Pressable>
          </View>

          <Text style={s.foot}>
            {canDeposit
              ? 'Nothing is held until you tap take'
              : 'Not enough in your wallet for a deposit — you\'ll pay at the shop'}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  right: { alignItems: 'flex-end' },
  pressed: { opacity: 0.85 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 22, paddingBottom: 30, gap: 13, ...shadowLg,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  center: { alignItems: 'center', paddingTop: 2 },
  icon: {
    width: 58, height: 58, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { marginTop: 12, textAlign: 'center' },
  sub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 7,
    lineHeight: 20, textAlign: 'center',
  },

  hero: { backgroundColor: colors.ink, borderRadius: 22, padding: 18, gap: 13 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  heroEyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  heroTime: {
    fontFamily: serif, fontSize: 34, lineHeight: 36, color: '#fff', marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  heroPrice: {
    fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 6, fontVariant: ['tabular-nums'],
  },
  heroFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 13,
  },
  heroAvatar: {
    width: 32, height: 32, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroAvatarText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  heroWho: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.7)' },

  raceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.bg,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 13, ...shadow,
  },
  raceIcon: {
    width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  raceText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: '#5C5C58' },
  raceClock: {
    fontSize: 12, fontWeight: '800', color: colors.accent, fontVariant: ['tabular-nums'],
  },

  ctas: { gap: 10, marginTop: 2 },
  takeBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  takeText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.04, color: '#fff' },
  noBtn: {
    height: 52, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  noText: { fontSize: font.small, fontWeight: '700', letterSpacing: 0.78, color: colors.text },
  foot: { textAlign: 'center', fontSize: font.tiny, color: colors.textTertiary },
});
