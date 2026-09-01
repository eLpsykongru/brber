import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Btn, Card, Eyebrow, GhostBtn, Ico, Note, Screen, Serif, Sheet, T, Toggle, TopBar,
} from '../components/dark';
import { useAndroidBack } from '../lib/back';
import { supabase } from '../lib/supabase';
import { dark as d, inter, serif } from '../theme';

// OSH-11/12/13 — Owner · Shop turn 6, gap G3. One screen, three states: the
// setting, the confirmation, and the shop that asks for nothing. 0076 is the
// model; every figure here comes from `shop_deposit_state()` so what he is
// shown and what `enforce_shop_deposit_floor` will do cannot disagree.
//
// The colour rule from the turn note: a deposit is HELD, not paid, so every
// amount on the shop's side is amber. Green would say the money is his.

type Svc = { name: string; price_cents: number; deposit_cents: number; cash_cents: number };
type State = {
  salon_name: string; pct: number; since: string | null;
  floor_pct: number; ceiling_pct: number;
  services: Svc[]; already_booked: number;
  no_shows: number; no_show_cents: number;
};

const dh = (cents: number) => Math.round(cents / 100);
/** §6.9 — space as the thousands separator, never a comma. */
const money = (cents: number) => dh(cents).toLocaleString('fr-FR').replace(/ | /g, ' ');

function whenSet(iso: string | null) {
  if (!iso) return null;
  const dt = new Date(iso);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

export default function DepositScreen({ onBack }: { onBack: () => void }) {
  const [st, setSt] = useState<State | null>(null);
  const [pct, setPct] = useState<number | null>(null);   // what he's chosen, unsaved
  const [confirm, setConfirm] = useState(false);          // OSH-12
  const [busy, setBusy] = useState(false);

  useAndroidBack(confirm ? () => setConfirm(false) : onBack);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('shop_deposit_state');
    if (error) { Alert.alert('Could not load the deposit', error.message); return; }
    const s = data as State;
    setSt(s);
    setPct((p) => p ?? s.pct);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!st || pct == null) return <Screen><TopBar title="Deposit" onBack={onBack} /></Screen>;

  const on = pct > 0;
  const dirty = pct !== st.pct;
  // the presets the slider snaps to, floor → ceiling in fives, thinned to five
  const steps = [st.floor_pct, 30, 40, 50, st.ceiling_pct]
    .filter((n, i, a) => n >= st.floor_pct && n <= st.ceiling_pct && a.indexOf(n) === i)
    .sort((a, b) => a - b);

  // OSH-11's headline pair, against the shop's own commonest cut
  const sample = st.services[0] ?? null;
  const sampleHeld = sample ? Math.ceil((sample.price_cents * pct) / 100) : 0;

  async function save(next: number) {
    setBusy(true);
    const { error } = await supabase.rpc('set_shop_deposit', { p_pct: next });
    setBusy(false);
    if (error) { Alert.alert('Could not save', error.message); return; }
    setConfirm(false);
    setPct(next);
    await load();
  }

  // ---- OSH-13 · no deposit is a legitimate answer, not an error state ----
  if (!on) {
    return (
      <Screen>
        <TopBar title="Deposit" onBack={onBack} />

        <Card style={s.row}>
          <View style={s.grow}>
            <T w="b" size={13.5}>Ask for a deposit</T>
            <T size={11} c={d.sub} style={s.gap3}>Off — customers book with nothing held</T>
          </View>
          <Toggle on={false} color={d.muted} onPress={() => setPct(st!.floor_pct)} />
        </Card>

        <Card style={s.bigCard}>
          <Eyebrow ls={1.7}>Your shop asks for</Eyebrow>
          <Text style={s.big}>0<Text style={s.bigUnit}>%</Text></Text>
          <T size={12.5} c={d.sub} style={s.lead}>
            Bookings at {st.salon_name} work exactly as they do today: the whole price in cash
            at the shop, nothing held in advance.
          </T>
        </Card>

        <Eyebrow>What that means</Eyebrow>
        <Card style={s.meansRow}>
          <Ico name="clock" size={15} color={d.sub} />
          <T size={12} c={d.textDim} style={s.meansText}>
            A slot costs nothing to break. Someone who doesn't turn up loses nothing.
          </T>
        </Card>
        <Card style={s.meansRow}>
          <Ico name="alert-triangle" size={15} color={d.red} />
          <T size={12} c={d.textDim} style={s.meansText}>
            {st.no_shows > 0
              ? <>Last month, your chairs lost <T w="b" c={d.red} size={12}>{st.no_shows} slot{st.no_shows === 1 ? '' : 's'}</T> to no-shows — {money(st.no_show_cents)} DH of chair time.</>
              : <>No no-shows in the last month. A deposit is what keeps it that way when it changes.</>}
          </T>
        </Card>
        <Card style={s.meansRow}>
          <Ico name="list" size={15} color={d.sub} />
          <T size={12} c={d.textDim} style={s.meansText}>
            Customers keep their wallets. Money already in one can't be spent here until you
            turn deposits on.
          </T>
        </Card>

        <Note bg={d.card2}>
          <View style={s.lockRow}>
            <Ico name="lock" size={14} color={d.faint} />
            <T size={11.5} c={d.sub} style={s.grow}>
              Turn it back on and the lowest Sterncut allows is {st.floor_pct}%.
            </T>
          </View>
        </Note>

        <Btn title={dirty ? 'SAVE · NO DEPOSIT' : 'NO DEPOSIT'} bg={d.card2}
          onPress={() => (dirty ? save(0) : onBack())} />
      </Screen>
    );
  }

  // ---- OSH-11 · set your deposit ----
  return (
    <>
      <Screen>
        <TopBar title="Deposit" onBack={onBack} />

        <Card style={s.row}>
          <View style={s.grow}>
            <T w="b" size={13.5}>Ask for a deposit</T>
            <T size={11} c={d.sub} style={s.gap3}>Held from the customer's wallet at booking</T>
          </View>
          <Toggle on color={d.accent} onPress={() => setPct(0)} />
        </Card>

        <Card style={s.bigCard}>
          <View style={s.headRow}>
            <View>
              <Eyebrow ls={1.7}>Your shop asks for</Eyebrow>
              <Text style={s.big}>{pct}<Text style={s.bigUnit}>%</Text></Text>
            </View>
            {sample && (
              <View style={s.right}>
                {/* amber: held, not earned */}
                <T w="eb" size={18} c={d.amber}>{dh(sampleHeld)} DH</T>
                <T size={10.5} c={d.sub} style={s.gap3}>on a {dh(sample.price_cents)} DH cut</T>
              </View>
            )}
          </View>

          {/* the track: hatched outside the bounds, coral between floor and choice */}
          <View style={s.track}>
            <View style={[s.locked, { left: 0, width: `${st.floor_pct}%` }]} />
            <View style={[s.locked, { left: `${st.ceiling_pct}%`, right: 0 }]} />
            <View style={[s.fill, { left: `${st.floor_pct}%`, width: `${pct - st.floor_pct}%` }]} />
            <View style={[s.notch, { left: `${st.floor_pct}%` }]} />
            <View style={[s.notch, { left: `${st.ceiling_pct}%` }]} />
            <View style={[s.thumb, { left: `${pct}%` }]} />
          </View>
          <View style={s.boundsRow}>
            <View style={s.lockRow}>
              <Ico name="lock" size={11} color={d.faint} />
              <T w="b" size={10.5} c={d.faint}>{st.floor_pct}% Sterncut floor</T>
            </View>
            <T w="b" size={10.5} c={d.faint}>{st.ceiling_pct}% ceiling</T>
          </View>

          {/* ponytail: five taps, not a drag. A real slider is a gesture
              dependency for a control with five legal values. */}
          <View style={s.chips}>
            {steps.map((n) => (
              <Pressable key={n} onPress={() => setPct(n)}
                accessibilityRole="radio" accessibilityState={{ selected: pct === n }}
                style={[s.chip, pct === n && s.chipOn]}>
                <Text style={[s.chipText, pct === n && s.chipTextOn]}>{n}%</Text>
              </Pressable>
            ))}
          </View>

          <T size={11} c={d.faint} style={s.foot}>
            {whenSet(st.since)
              ? `Now ${st.pct}%, set ${whenSet(st.since)}. `
              : `Now ${st.pct}%. `}
            A customer may always choose to pay more — up to the full price — never less.
          </T>
        </Card>

        {st.services.length > 0 && (
          <>
            <Eyebrow>What a customer will be asked</Eyebrow>
            <Card style={s.table}>
              {st.services.slice(0, 4).map((sv, i, a) => {
                const held = Math.ceil((sv.price_cents * pct) / 100);
                return (
                  <View key={sv.name}
                    style={[s.svcRow, i < a.length - 1 && s.svcDivider]}>
                    <T size={12.5} w="sb" style={s.grow} numberOfLines={1}>
                      {sv.name} <T size={12.5} c={d.faint}>{dh(sv.price_cents)} DH</T>
                    </T>
                    <T w="b" size={12.5} c={d.amber}>{dh(held)} DH</T>
                    <T size={11.5} c={d.sub} style={s.cash}>
                      {dh(sv.price_cents - held)} DH cash
                    </T>
                  </View>
                );
              })}
            </Card>
          </>
        )}

        <View style={s.heldNote}>
          <Ico name="lock" size={14} color={d.amber} />
          <T size={11.5} c={d.amber} style={s.heldText}>
            A deposit is <T w="b" size={11.5} c={d.amber}>held</T>, not paid to you. It becomes
            the shop's when the cut is done, or if the customer doesn't turn up. Rounded to the dirham.
          </T>
        </View>

        <Btn title={dirty ? `SAVE · ${pct}% DEPOSIT` : `${pct}% DEPOSIT`}
          onPress={() => (dirty ? setConfirm(true) : onBack())} />
      </Screen>

      {/* ---- OSH-12 · confirm, from today, forward only ---- */}
      <Sheet visible={confirm} onClose={() => setConfirm(false)} deep>
        <Serif size={24} style={s.confirmTitle}>
          {pct > st.pct ? 'Raise' : 'Lower'} the deposit to {pct}%?
        </Serif>

        <Card style={s.beforeAfter}>
          <View style={s.baCol}>
            <Eyebrow ls={1.4} c={d.faint}>Until now</Eyebrow>
            <Text style={s.baNum}>{st.pct}%</Text>
            {sample && (
              <T size={10.5} c={d.faint} style={s.gap3}>
                {dh(Math.ceil((sample.price_cents * st.pct) / 100))} DH on {dh(sample.price_cents)} DH
              </T>
            )}
          </View>
          <Ico name="arrow-right" size={17} color={d.muted} />
          <View style={s.baCol}>
            <Eyebrow ls={1.4} c={d.accent}>From today</Eyebrow>
            <Text style={[s.baNum, s.baNumNew]}>{pct}%</Text>
            {sample && (
              <T size={10.5} c={d.amber} style={s.gap3}>
                {dh(sampleHeld)} DH on {dh(sample.price_cents)} DH
              </T>
            )}
          </View>
        </Card>

        <Card style={s.table}>
          <View style={[s.svcRow, s.svcDivider]}>
            <T size={12.5} c={d.sub} style={s.grow}>Applies to</T>
            <T w="b" size={12.5}>Bookings taken from now</T>
          </View>
          <View style={[s.svcRow, s.svcDivider]}>
            <T size={12.5} c={d.sub} style={s.grow}>Already booked</T>
            <T w="b" size={12.5}>{st.already_booked} keep their {st.pct}%</T>
          </View>
          <View style={s.svcRow}>
            <T size={12.5} c={d.sub} style={s.grow}>Recorded as</T>
            <T w="b" size={12.5}>
              Effective {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })}
            </T>
          </View>
        </Card>

        <View style={s.lockRow}>
          <Ico name="info" size={14} color={d.sub} />
          <T size={11.5} c={d.sub} style={s.grow}>
            Every customer who has already booked pays the deposit he agreed to. Nothing you
            change here reaches bookings already taken.
          </T>
        </View>

        <Btn title={busy ? 'SAVING…' : `SET ${pct}% FROM TODAY`}
          onPress={() => !busy && save(pct)} />
        <GhostBtn title={`KEEP ${st.pct}%`} border="transparent"
          onPress={() => { setPct(st.pct); setConfirm(false); }} />
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  gap3: { marginTop: 3 },
  right: { alignItems: 'flex-end', paddingBottom: 4 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  bigCard: { padding: 18, gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  big: {
    fontFamily: serif, fontSize: 46, lineHeight: 48, color: d.text,
    letterSpacing: 0.5, marginTop: 5,
  },
  bigUnit: { fontSize: 24 },
  lead: { lineHeight: 19, marginTop: 2 },

  // the bounded track — locked regions read as locked, not as broken
  track: { height: 8, borderRadius: 4, backgroundColor: d.card2, marginTop: 8, marginHorizontal: 2 },
  locked: { position: 'absolute', top: 0, bottom: 0, backgroundColor: d.border, opacity: 0.6, borderRadius: 4 },
  fill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: d.accent },
  notch: { position: 'absolute', top: -5, bottom: -5, width: 2, backgroundColor: d.muted },
  thumb: {
    position: 'absolute', top: -9, width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#fff', marginLeft: -13, borderWidth: 4, borderColor: d.card,
  },
  boundsRow: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 2 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  chips: { flexDirection: 'row', gap: 7 },
  chip: {
    flex: 1, height: 44, borderRadius: 14, backgroundColor: d.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  chipOn: { backgroundColor: d.accent },
  chipText: { fontFamily: inter.sb, fontSize: 12.5, color: d.sub },
  chipTextOn: { fontFamily: inter.b, color: '#fff' },
  foot: { lineHeight: 16 },

  table: { paddingHorizontal: 16, paddingVertical: 4 },
  svcRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  svcDivider: { borderBottomWidth: 1, borderBottomColor: d.border },
  cash: { width: 66, textAlign: 'right' },

  heldNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: 'rgba(232,161,0,0.10)', borderWidth: 1,
    borderColor: 'rgba(232,161,0,0.28)', borderRadius: 16, padding: 13,
  },
  heldText: { flex: 1, lineHeight: 17 },

  meansRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 14 },
  meansText: { flex: 1, lineHeight: 17 },

  confirmTitle: { lineHeight: 29 },
  beforeAfter: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: d.card2 },
  baCol: { flex: 1, alignItems: 'center' },
  baNum: { fontFamily: serif, fontSize: 28, lineHeight: 31, color: d.sub, marginTop: 5 },
  baNumNew: { color: d.text },
});
