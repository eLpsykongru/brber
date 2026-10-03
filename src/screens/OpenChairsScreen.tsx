import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Btn, Card, Eyebrow, GhostBtn, Note, Screen, T, TAB_INSET, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import { loc, tr, trn } from '../lib/i18n';
import { perRent } from '../lib/rent';

// RVW-10 — the empty chairs other shops have listed (0142), as a barber looking for
// one sees them, nearest his shop first. Listing showed the owner's phone with it;
// asking (0144) tells the owner in the app, and only the owner taking him on moves him.
type OpenChair = {
  chair_id: string; label: string; rent_cents: number | null; rent_period: 'week' | 'month';
  note: string | null; listed_at: string;
  salon_name: string; address: string | null; district: string | null;
  owner_name: string; owner_phone: string | null;
  rating: number | null; reviews_count: number; barbers: number;
  km: number | null; ask_id: string | null; asked_at: string | null;
};

export default function OpenChairsScreen({ onBack }: { onBack: () => void }) {
  const [chairs, setChairs] = useState<OpenChair[] | null>(null);
  const load = useCallback(() => {
    supabase.rpc('open_chairs').then(({ data, error }) => {
      if (error) Alert.alert(tr('Could not load chairs'), error.message);
      setChairs((data as OpenChair[] | null) ?? []);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title={tr('Chairs for rent')} onBack={onBack} />
      {chairs === null && <ActivityIndicator color={D.accent} style={s.spin} />}
      {chairs?.length === 0 && (
        <Note>{tr('No shop on Sterncut is looking for a barber right now. When an owner lists an empty chair, it shows here.')}</Note>
      )}
      {chairs?.map((c) => <ChairCard key={c.chair_id} c={c} onChanged={load} />)}
    </Screen>
  );
}

function ChairCard({ c, onChanged }: { c: OpenChair; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function run(fn: 'ask_for_chair' | 'withdraw_chair_ask', args: object) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return Alert.alert(tr('Could not send'), error.message);
    onChanged();
  }
  const first = c.owner_name.split(' ')[0];
  const digits = (c.owner_phone ?? '').replace(/\D/g, '');
  const intl = digits.startsWith('0') ? `212${digits.slice(1)}` : digits;   // 06… → 2126…
  const hello = tr('Hello {name}, I saw {chair} at {shop} on Sterncut. Is it still free?',
    { name: first, chair: c.label, shop: c.salon_name });
  return (
    <Card style={s.card}>
      <View style={s.head}>
        <View style={s.grow}>
          <T w="b" size={15}>{c.salon_name}</T>
          <T size={12} c={D.sub} style={s.mt}>
            {[c.km != null ? tr('{km} km away', { km: Number(c.km).toFixed(1) }) : null, c.district, c.address].filter(Boolean).join(' · ')}
          </T>
        </View>
        {c.reviews_count > 0 && (
          <T w="b" size={13}>{`★ ${Number(c.rating).toFixed(1)}`}<T size={11} c={D.sub}>{` (${c.reviews_count})`}</T></T>
        )}
      </View>
      <View style={s.mt}>
        <Eyebrow ls={1.2}>{c.label.toUpperCase()}</Eyebrow>
        <T w="b" size={20} style={s.mt}>
          {c.rent_cents != null ? perRent(c.rent_cents, c.rent_period) : tr('Rent: ask the owner')}
        </T>
      </View>
      {!!c.note && <T size={13} style={s.note}>{c.note}</T>}
      <T size={11} c={D.sub}>
        {trn(c.barbers, '{n} barber in the shop', '{n} barbers in the shop')}
        {' · '}
        {tr('Listed {date}', { date: new Date(c.listed_at).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }) })}
      </T>
      {intl ? (
        <View style={s.actions}>
          <Btn title={tr('Call')} icon="phone" height={44} style={s.grow}
            onPress={() => Linking.openURL(`tel:+${intl}`)} />
          <GhostBtn title={tr('WhatsApp')} height={44} style={s.grow}
            onPress={() => Linking.openURL(`https://wa.me/${intl}?text=${encodeURIComponent(hello)}`)} />
        </View>
      ) : (
        <T size={12} c={D.sub}>{tr('The owner has no phone on Sterncut yet.')}</T>
      )}
      {c.ask_id ? (
        <View style={s.asked}>
          <T size={12} c={D.sub} style={s.grow}>
            {tr('You asked {date}. {name} answers in the app.', { date: new Date(c.asked_at!).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }), name: first })}
          </T>
          <Pressable disabled={busy} hitSlop={8} accessibilityRole="button"
            onPress={() => run('withdraw_chair_ask', { p_ask: c.ask_id })}>
            <T w="b" size={12} c={D.accent}>{tr('Withdraw')}</T>
          </Pressable>
        </View>
      ) : (
        <GhostBtn title={tr('Ask for this chair')} height={44}
          onPress={busy ? undefined : () => Alert.alert(tr('Ask {name} for {chair}?', { name: first, chair: c.label }),
            tr('He sees your name, rating and phone. If he takes you on, you move to {shop} — your clients and bookings come with you.', { shop: c.salon_name }),
            [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Ask'), onPress: () => run('ask_for_chair', { p_chair: c.chair_id }) }])} />
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  spin: { marginTop: 40 },
  card: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  grow: { flex: 1 },
  mt: { marginTop: 3 },
  note: { lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  asked: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
