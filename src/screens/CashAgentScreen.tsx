import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Btn, Card, Eyebrow, GhostBtn, Ico, Screen, Serif, T, TAB_INSET, TopBar } from '../components/dark';
import { dh } from '../lib/billing';
import { loc, tr, trn } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// "Owner - Barbers.dc.html" turn T4 — OBR-07 who holds the cash, OBR-08 the change
// refused while the drawer isn't empty, over 0127.
//
// This is the highest-trust switch in the owner's app and it is deliberately not a
// toggle: the man losing it is standing there with the shop's cash. So the screen
// only ever asks the database (`set_cash_agent`), and the database answers either
// "done" — the drawer was empty and nobody was owed — or "blocked", with what is
// attached to him. OBR-09, the successor counting it in, is on HIS phone, in
// AccountScreen: nothing here can confirm cash on another man's behalf.

type State = {
  salon: string | null;
  agent: { id: string; name: string; is_me: boolean; since: string | null };
  drawer_cents: number;
  clear: boolean;
  dues: { barber: string; name: string; cents: number; is_agent: boolean }[];
  candidates: { id: string; name: string; chair: string | null; role: string; is_owner: boolean; cuts: boolean }[];
  transfer: {
    id: string; ref: string; state: 'pending' | 'mismatch'; to: string; to_name: string; from_name: string;
    started_cents: number; declared_cents: number | null; counted_cents: number | null; at: string;
  } | null;
  gaps: { id: string; barber: string; name: string; cents: number; at: string; owes_cents: number }[];
};

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString(loc('en-GB'), { day: 'numeric', month: 'short' });

export default function CashAgentScreen({ onBack }: { onBack?: () => void }) {
  const [s, setS] = useState<State | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('cash_agent_state');
    if (error) return Alert.alert(tr('Could not load this'), error.message);
    setS(data as State);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!s) return <Screen bottom={TAB_INSET}><TopBar title={tr('Who holds the cash')} onBack={onBack} plain /></Screen>;
  if (!s.salon) {
    return (
      <Screen bottom={TAB_INSET}>
        <TopBar title={tr('Who holds the cash')} onBack={onBack} plain />
        <T size={12.5} c={D.sub}>{tr('Only the shop’s owner appoints its cash agent.')}</T>
      </Screen>
    );
  }

  // OBR-07 → the database decides: the role moves, or it says what is attached
  async function give(id: string, name: string) {
    setBusy(true);
    const { data, error } = await supabase.rpc('set_cash_agent', { p_barber: id });
    setBusy(false);
    if (error) return Alert.alert(tr('Could not hand it over'), error.message);
    const r = data as { state: string };
    if (r.state === 'blocked') return setBlocked({ id, name });
    load();
  }

  async function count(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc('start_drawer_transfer', { p_barber: id });
    setBusy(false);
    if (error) return Alert.alert(tr('Could not start the handover'), error.message);
    setBlocked(null);
    load();
  }

  async function stop() {
    const { error } = await supabase.rpc('cancel_drawer_transfer');
    if (error) return Alert.alert(tr('Could not stop it'), error.message);
    load();
  }

  if (blocked) {
    return <BlockedView s={s} to={blocked} busy={busy} onBack={() => setBlocked(null)} onCount={() => count(blocked.id)} />;
  }

  const owed = s.dues.filter((d) => d.cents > 0);
  return (
    <Screen bottom={TAB_INSET} gap={12}>
      <TopBar title={tr('Who holds the cash')} onBack={onBack} plain />
      <T size={12.5} c={D.sub} style={st.lh}>
        {tr("One man keeps the shop's cash and pays the others what they're owed. Everyone can see who it is.")}
      </T>

      <Eyebrow ls={1.4}>{tr('RIGHT NOW')}</Eyebrow>
      <Card style={st.agent}>
        <View style={st.row}>
          <View style={[st.avatar, st.avatarWarm]}><T w="b" size={12} c={D.accent}>{initials(s.agent.name)}</T></View>
          <View style={st.grow}>
            <T w="b" size={13.5}>{s.agent.is_me ? tr('{name} — you', { name: s.agent.name }) : s.agent.name}</T>
            <T size={11} c={D.sub} style={st.mt2}>
              {owed.length
                ? trn(owed.length, 'Holding {amount} · owes {owed} to one chair', 'Holding {amount} · owes {owed} to {n} chairs',
                  { amount: dh(s.drawer_cents), owed: dh(owed.reduce((n, d) => n + d.cents, 0)) })
                : tr('Holding {amount} · owes nothing to the chairs', { amount: dh(s.drawer_cents) })}
            </T>
          </View>
        </View>
        {!!s.agent.since && (
          <T size={10.5} c={D.faint}>{tr('Since {date}', { date: dayMonth(s.agent.since) })}</T>
        )}
      </Card>

      {s.transfer && (
        <View style={s.transfer.state === 'mismatch' ? st.red : st.amber}>
          <Ico name={s.transfer.state === 'mismatch' ? 'alert-triangle' : 'package'} size={15}
            color={s.transfer.state === 'mismatch' ? D.red : D.amber} />
          <View style={st.grow}>
            <T w="b" size={12.5}>
              {s.transfer.state === 'mismatch' ? tr('The two counts did not match')
                : tr('{name} is counting it in', { name: s.transfer.to_name.split(' ')[0] })}
            </T>
            <T size={11.5} c={D.sub} style={[st.lh, st.mt2]}>
              {s.transfer.state === 'mismatch'
                ? tr('{from} handed over {declared} by our books; {to} counted {counted}. Sterncut is ringing them both. Until it is settled {from} still holds the drawer and still pays the chairs, and nothing about your bookings or your page changes.',
                  { from: s.transfer.from_name.split(' ')[0], to: s.transfer.to_name.split(' ')[0],
                    declared: dh(s.transfer.declared_cents ?? 0), counted: dh(s.transfer.counted_cents ?? 0) })
                : tr('He confirms {amount} on his own phone. Until he does, {from} still holds it and still pays the chairs.',
                  { amount: dh(s.transfer.started_cents), from: s.transfer.from_name.split(' ')[0] })}
            </T>
            {s.transfer.state === 'pending' && (
              <Pressable onPress={stop} hitSlop={8} style={st.mt8}>
                <T w="sb" size={11.5} c={D.amber}>{tr('Stop the handover')}</T>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {s.gaps.map((g) => (
        <View key={g.id} style={st.amber}>
          <Ico name="alert-circle" size={15} color={D.amber} />
          <T size={11.5} c={D.sub} style={[st.grow, st.lh]}>
            {tr('The handover on {date} came up {amount} short. It stays on {name} until he puts it back in the drawer.',
              { date: dayMonth(g.at), amount: dh(g.cents), name: g.name })}
          </T>
        </View>
      ))}

      {!s.transfer && (
        <>
          <Eyebrow ls={1.4}>{tr('GIVE IT TO SOMEONE ELSE')}</Eyebrow>
          {!s.candidates.length && <T size={11.5} c={D.faint}>{tr('Nobody else has been taken on yet.')}</T>}
          {s.candidates.map((c) => (
            <Card key={c.id} style={st.line} onPress={busy ? undefined : () => give(c.id, c.name)}>
              <View style={st.avatar}><T w="b" size={10} c={D.sub}>{initials(c.name)}</T></View>
              <View style={st.grow}>
                <T w="b" size={12.5}>{c.name}</T>
                <T size={10.5} c={D.sub} style={st.mt2}>
                  {[c.is_owner ? tr('You, the owner') : c.chair,
                    c.cuts ? null : tr("doesn't cut")].filter(Boolean).join(' · ') || tr('On the team')}
                </T>
              </View>
              <Ico name="chevron-right" size={15} color={D.muted} />
            </Card>
          ))}
        </>
      )}

      <Card style={st.sum}>
        <Eyebrow ls={1.4}>{tr('WHAT HE CAN SEE')}</Eyebrow>
        <View style={st.row}>
          <Ico name="check" size={14} color={D.green} />
          <T size={11.5} style={[st.grow, st.lh]}>{tr('What each man is owed today — the figure, nothing behind it')}</T>
        </View>
        <View style={st.row}>
          <Ico name="x" size={14} color={D.red} />
          <T size={11.5} c={D.sub} style={[st.grow, st.lh]}>{tr('Their clients, their prices, what they take home')}</T>
        </View>
        <T size={11} c={D.faint} style={[st.lh, st.whyLine]}>
          {tr("He can't change what he owes a man, and he can't pay without that man's code.")}
        </T>
      </Card>
    </Screen>
  );
}

// ---- OBR-08 · there is cash attached to the man losing the role ----------------------
function BlockedView({ s, to, busy, onBack, onCount }: {
  s: State; to: { id: string; name: string }; busy: boolean; onBack: () => void; onCount: () => void;
}) {
  const owed = s.dues.filter((d) => d.cents > 0 && !d.is_agent);
  const owedTotal = owed.reduce((n, d) => n + d.cents, 0);
  return (
    <Screen bottom={TAB_INSET} gap={12}>
      <TopBar title={tr('Hand it to {name}', { name: to.name.split(' ')[0] })} onBack={onBack} plain />
      <View style={st.hero}>
        <Eyebrow c={D.amber} ls={1.5}>{tr("NOT YET — THE DRAWER ISN'T EMPTY")}</Eyebrow>
        <T size={12.5} style={st.lh}>
          {/* the subject is not interpolated: "vous" and a name do not take the same verb */}
          {s.agent.is_me
            ? (owedTotal > 0
              ? tr("You are holding {amount} of Sterncut's money and you owe {owed} to the chairs. If the role moves now, that cash stays pointed at you with no way to clear it.",
                { amount: dh(s.drawer_cents), owed: dh(owedTotal) })
              : tr("You are holding {amount} of Sterncut's money. If the role moves now, that cash stays pointed at you with no way to clear it.",
                { amount: dh(s.drawer_cents) }))
            : (owedTotal > 0
              ? tr("{name} is holding {amount} of Sterncut's money and owes {owed} to the chairs. If the role moves now, that cash stays pointed at him with no way to clear it.",
                { name: s.agent.name, amount: dh(s.drawer_cents), owed: dh(owedTotal) })
              : tr("{name} is holding {amount} of Sterncut's money. If the role moves now, that cash stays pointed at him with no way to clear it.",
                { name: s.agent.name, amount: dh(s.drawer_cents) }))}
        </T>
      </View>

      <Eyebrow ls={1.4}>{tr("WHAT'S ATTACHED")}</Eyebrow>
      <Card style={st.sum}>
        <View style={st.row}>
          <T size={12.5} c={D.sub} style={st.grow}>{tr('In the drawer')}</T>
          <Serif size={20} ls={0}>{dh(s.drawer_cents)}</Serif>
        </View>
        {s.dues.map((d) => (
          <View key={d.barber} style={st.row}>
            <T size={12.5} c={D.sub} style={st.grow}>
              {d.cents >= 0 ? tr('Owed to {name}', { name: d.name }) : tr('{name} owes the drawer', { name: d.name })}
            </T>
            <T w="b" size={13} c={d.cents >= 0 ? D.green : D.amber} style={st.num}>{dh(d.cents)}</T>
          </View>
        ))}
      </Card>

      <Eyebrow ls={1.4}>{tr('TWO WAYS TO CLEAR IT')}</Eyebrow>
      <Card style={st.way}>
        <T w="b" size={12.5}>{tr('Settle with the collection agent first')}</T>
        <T size={11.5} c={D.sub} style={st.lh}>
          {tr('Pay the chairs, hand the rest over on the next collection, and {name} starts at zero. Cleanest: no cash passes between two barbers.',
            { name: to.name.split(' ')[0] })}
        </T>
      </Card>
      <Card style={st.way}>
        <T w="b" size={12.5}>{tr('Count it into his hands')}</T>
        <T size={11.5} c={D.sub} style={st.lh}>
          {owedTotal > 0
            ? tr('He confirms the amount on his own phone. What the chairs are owed moves to him too — including his own.')
            : tr('He confirms the amount on his own phone, and takes the drawer as it stands.')}
        </T>
      </Card>

      <Btn title={tr('COUNT {amount} INTO HIS HANDS', { amount: dh(s.drawer_cents) })}
        onPress={busy ? undefined : onCount} bg={busy ? D.card2 : D.accent} />
      <GhostBtn title={tr('Wait and settle up first')} onPress={onBack} />
      <T size={10.5} c={D.faint} style={st.foot}>
        {tr("Nobody's pay is delayed by this. Until it is done, the man holding the drawer is the one who pays them.")}
      </T>
    </Screen>
  );
}

const st = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mt2: { marginTop: 2 },
  mt8: { marginTop: 8 },
  lh: { lineHeight: 17 },
  num: { fontVariant: ['tabular-nums'] },
  foot: { textAlign: 'center', lineHeight: 16 },
  agent: { padding: 15, gap: 9, borderRadius: 20 },
  avatar: { width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center' },
  avatarWarm: { backgroundColor: 'rgba(232,68,46,0.16)' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 16 },
  sum: { padding: 16, gap: 10, borderRadius: 20 },
  way: { padding: 14, gap: 6, borderRadius: 18 },
  whyLine: { borderTopWidth: 1, borderTopColor: D.border, paddingTop: 11 },
  hero: { backgroundColor: '#1D1A14', borderWidth: 1, borderColor: '#3A3120', borderRadius: 22, padding: 18, gap: 10 },
  amber: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(232,161,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(232,161,0,0.22)', borderRadius: 16, padding: 12 },
  red: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(248,113,113,0.08)',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.22)', borderRadius: 16, padding: 12 },
});
