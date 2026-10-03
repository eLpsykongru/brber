import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { Card, Eyebrow, Note, Screen, T, TAB_INSET, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import { loc, tr } from '../lib/i18n';
import { paidPeriodName, perRent } from '../lib/rent';

// The barber's side of 0142's rent: his shop, his chair, his terms (my_terms, 0144 —
// the table stopped showing them in 0143) and what the owner has written down.
// Read-only: the owner writes rent down when he is paid in cash.
type Terms = {
  salon_name: string; pay_model: 'rent' | 'commission'; commission_pct: number;
  rent_cents: number; rent_period: 'week' | 'month'; chair_label: string | null;
};
type Paid = { id: string; covers_from: string; covers_to: string; amount_cents: number };

const dh = (c: number) => `${Math.round(c / 100).toLocaleString('en-US').replace(/,/g, ' ')} DH`;

export default function MyChairScreen({ barberId, onBack }: { barberId: string; onBack: () => void }) {
  const [terms, setTerms] = useState<Terms | null | undefined>(undefined);
  const [paid, setPaid] = useState<Paid[]>([]);
  useEffect(() => {
    Promise.all([
      supabase.rpc('my_terms'),
      supabase.from('rent_payments').select('id, covers_from, covers_to, amount_cents')
        .eq('barber_id', barberId).order('covers_to', { ascending: false }).limit(12),
    ]).then(([t, p]) => {
      if (t.error) Alert.alert(tr('Could not load your chair'), t.error.message);
      setTerms(((t.data as Terms[] | null) ?? [])[0] ?? null);
      setPaid((p.data as Paid[] | null) ?? []);
    });
  }, [barberId]);

  const upTo = paid[0]?.covers_to;
  const day = (iso: string) => new Date(iso).toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title={tr('Your chair')} onBack={onBack} />
      {terms === undefined && <ActivityIndicator color={D.accent} style={s.spin} />}
      {terms === null && <Note>{tr('You are not in a shop on Sterncut right now.')}</Note>}
      {terms && (
        <>
          <Card style={s.card}>
            <Eyebrow ls={1.2}>{(terms.chair_label ?? tr('No chair assigned yet')).toUpperCase()}</Eyebrow>
            <T w="b" size={17}>{terms.salon_name}</T>
            <T w="b" size={20} c={D.accent}>
              {terms.pay_model === 'rent'
                ? perRent(terms.rent_cents, terms.rent_period)
                : tr('Commission · you keep {pct}%', { pct: terms.commission_pct })}
            </T>
          </Card>
          {terms.pay_model === 'rent' && (
            <>
              <T w="b" size={13} c={upTo && Date.parse(upTo) <= Date.now() ? D.red : D.text}>
                {!upTo ? tr('Nothing written down yet.')
                  : Date.parse(upTo) > Date.now() ? tr('Paid up to {date}', { date: day(upTo) })
                    : tr('Due since {date}', { date: day(upTo) })}
              </T>
              {paid.map((r) => (
                <View key={r.id} style={s.row}>
                  <T size={13} style={s.grow}>{paidPeriodName(r.covers_from, r.covers_to)}</T>
                  <T w="b" size={13}>{dh(r.amount_cents)}</T>
                </View>
              ))}
            </>
          )}
          <Note>{tr('Your shop’s owner writes the rent down when you pay him in cash. If something here is wrong, talk to him.')}</Note>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  spin: { marginTop: 40 },
  card: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: D.border },
  grow: { flex: 1 },
});
