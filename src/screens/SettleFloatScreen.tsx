import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ico, Screen, Serif, T, TAB_INSET, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D, serif } from '../theme';

// 9e / 9f of "Barber App.dc.html" — the float, hand to hand.
//
// The rail was already there (0042 + 0044): `salon_float_cents()` knows what is in
// the drawer and `float_settlements` records a collection. What it could not do
// was let the two people standing in the shop **agree that it happened** — the
// admin console simply asserted a collection and the barber found out later.
//
// One short-lived code fixes that, and it is the only mechanism on these two
// screens: he reads four digits out, she types them in, and neither side can
// record a handover alone. That is also why 9e says "don't hand anything over
// without it" — the code is the receipt, not the app.

const dh = (c: number) => Math.round(c / 100).toLocaleString('en-US').replace(/,/g, ' ');
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

type Float = {
  salon: string | null; float_cents: number; owed_cents: number; net_cents: number;
  cap_cents: number; code: string | null; topups: number; held_days: number | null;
};

// ---------------------------------------------------------------------------
// 9e — Settle up · the barber's side
// ---------------------------------------------------------------------------
export default function SettleFloatScreen({ onBack }: { onBack?: () => void }) {
  const [f, setF] = useState<Float | null>(null);
  const [how, setHow] = useState<'collect' | 'bank'>('collect');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_float');
    if (error) return Alert.alert('Could not load your float', error.message);
    const j = data as Float;
    setF(j);
    setCode(j.code);
  }, []);
  useEffect(() => { load(); }, [load]);

  // minted on arrival so the number is on screen before she is, and stable while
  // it is fresh — reopening this must not change the digits under her pen
  useEffect(() => {
    if (!f?.salon || f.float_cents <= 0 || code) return;
    supabase.rpc('float_handover_code').then(({ data, error }) => {
      if (!error) setCode(data as string);
    });
  }, [f, code]);

  // there is nothing to undo — no cash moved and the code expires on its own.
  // A server call here would only pretend something happened.
  function notToday() {
    Alert.alert('Kept for next time',
      'Your cash stays where it is. Open this again when someone comes.');
    onBack?.();
  }

  if (!f) return <Screen bottom={TAB_INSET}><TopBar title="Settle up" onBack={onBack} /></Screen>;
  if (!f.salon) {
    return (
      <Screen bottom={TAB_INSET}>
        <TopBar title="Settle up" onBack={onBack} />
        <T size={13} c={D.sub}>Only a shop owner holds a float.</T>
      </Screen>
    );
  }

  const late = f.held_days != null && f.held_days > 14;
  const nothing = f.float_cents <= 0;

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="Settle up" onBack={onBack} />

      <View style={[s.handOver, late && s.handOverLate]}>
        <T w="b" size={10} c={D.sub} ls={1.5}>HAND OVER</T>
        <T style={s.huge}>{dh(f.float_cents)} DH</T>
        {f.held_days != null && (
          <View style={[s.heldRow, late && s.heldRowLate]}>
            <Ico name="clock" size={13} color={late ? D.amber : D.sub} />
            <T size={11.5} c={late ? D.amber : D.sub}>
              Held {f.held_days} day{f.held_days === 1 ? '' : 's'}
              {late ? ' · the cap is 14' : ''}
            </T>
          </View>
        )}
      </View>

      <View style={s.card}>
        <T w="b" size={10} c={D.sub} ls={1.4}>WHAT MAKES IT UP</T>
        <View style={s.line}>
          <T size={12.5} c={D.sub} style={s.grow}>
            {f.topups} top-up{f.topups === 1 ? '' : 's'}
          </T>
          <T w="b" size={12.5} style={s.num}>{dh(f.float_cents)} DH</T>
        </View>
        <View style={s.line}>
          <T size={12.5} c={D.sub} style={s.grow}>Commission</T>
          <T w="b" size={12.5} c={D.green}>0 DH</T>
        </View>
        {f.owed_cents > 0 && (
          <View style={s.line}>
            <T size={12.5} c={D.sub} style={s.grow}>We owe you for finished cuts</T>
            <T w="b" size={12.5} c={D.green} style={s.num}>−{dh(f.owed_cents)} DH</T>
          </View>
        )}
        <View style={s.rule} />
        <View style={s.line}>
          <T w="b" size={12.5} style={s.grow}>You hand over</T>
          <T w="eb" size={18} style={s.num}>{dh(f.float_cents)} DH</T>
        </View>
        <T size={11} c={D.muted} style={s.fine}>
          It isn't your money — customers paid you cash and we credited their wallets
          on the spot.
        </T>
      </View>

      <T w="b" size={11} c={D.sub} ls={1.65} style={s.mt2}>HOW</T>
      <Pressable onPress={() => setHow('collect')}
        style={[s.howRow, how === 'collect' && s.howRowOn]}>
        <View style={[s.radio, how === 'collect' && s.radioOn]}>
          {how === 'collect' && <Ico name="check" size={11} color="#fff" />}
        </View>
        <View style={s.grow}>
          <T w={how === 'collect' ? 'b' : 'sb'} size={13}>Someone collects it</T>
          <T size={11} c={D.sub} style={s.mt2}>Show them the code below</T>
        </View>
      </Pressable>
      <Pressable onPress={() => setHow('bank')} style={[s.howRow, how === 'bank' && s.howRowOn]}>
        <View style={[s.radio, how === 'bank' && s.radioOn]}>
          {how === 'bank' && <Ico name="check" size={11} color="#fff" />}
        </View>
        <View style={s.grow}>
          <T w={how === 'bank' ? 'b' : 'sb'} size={13}>Pay it in at the bank</T>
          <T size={11} c={D.sub} style={s.mt2}>Slip photo needed · clears next day</T>
        </View>
      </Pressable>

      {how === 'collect' ? (
        <View style={s.codeCard}>
          <T w="b" size={10} c={D.sub} ls={1.5}>SHOW THEM THIS CODE</T>
          <T style={s.code}>{nothing ? '— — — —' : (code ?? '····').split('').join(' ')}</T>
          <T size={11} c={D.muted} style={s.codeNote}>
            They type it in to confirm they have the cash. Don't hand anything over
            without it.
          </T>
        </View>
      ) : (
        <View style={s.note}>
          <Ico name="info" size={15} color={D.sub} />
          <T size={12} c={D.sub} style={s.noteText}>
            Paying in at the bank isn't wired up yet — for now, hand it to whoever
            collects in your area and use the code.
          </T>
        </View>
      )}

      {!nothing && (
        <Pressable disabled={busy} onPress={notToday} style={[s.ghost, busy && s.dim55]}>
          <T w="b" size={12} ls={0.6}>NOBODY'S COMING TODAY</T>
        </Pressable>
      )}
      {nothing && (
        <View style={s.note}>
          <Ico name="check" size={15} color={D.green} />
          <T size={12} c={D.sub} style={s.noteText}>
            Nothing to hand over. Cash top-ups you take will show up here.
          </T>
        </View>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// 9f — Collecting · the round, on the collector's phone
// ---------------------------------------------------------------------------
// Ops-only, because the person doing the round is ops. The stop is ordered by how
// long the money has been sitting, not by distance: the oldest drawer is the one
// closest to breaking its cap.
type Stop = {
  id: string; name: string; address: string | null; owner: string;
  float_cents: number; float_cap_cents: number; ready: boolean;
  topups: number; held_days: number | null;
};
type Round = { carrying_cents: number; done_today: number; stops: Stop[] };

export function CollectionRoundScreen({ onBack }: { onBack?: () => void }) {
  const [round, setRound] = useState<Round | null>(null);
  const [at, setAt] = useState(0);
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('agent_round');
    if (error) { setDenied(true); return; }
    setRound(data as Round);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function confirm(stop: Stop) {
    setBusy(true);
    const { error } = await supabase.rpc('agent_collect_float', {
      p_salon: stop.id, p_code: digits, p_declared_cents: stop.float_cents,
    });
    setBusy(false);
    if (error) return Alert.alert('Not collected', error.message);
    setDigits('');
    setAt(0);
    load();
  }

  if (denied) {
    return (
      <Screen bottom={TAB_INSET}>
        <TopBar title="Collection round" onBack={onBack} />
        <T size={13} c={D.sub}>Collections are ops only.</T>
      </Screen>
    );
  }
  if (!round) {
    return <Screen bottom={TAB_INSET}><TopBar title="Collection round" onBack={onBack} /></Screen>;
  }

  const stop = round.stops[at];
  const remaining = round.stops.reduce((a, b) => a + b.float_cents, 0);

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="Collection round" onBack={onBack} />

      <View style={s.roundHead}>
        <View style={s.grow}>
          <T w="b" size={10} c={D.sub} ls={1.4}>CARRYING</T>
          <T style={s.big}>{dh(round.carrying_cents)} DH</T>
        </View>
        <View style={s.right}>
          <T w="b" size={10} c={D.sub} ls={1.4}>STILL TO GET</T>
          <T w="b" size={17} c={D.amber} style={[s.num, s.mt6]}>{dh(remaining)} DH</T>
        </View>
      </View>

      {!stop && (
        <View style={s.empty}>
          <View style={s.emptyCircle}><Ico name="check" size={28} color={D.green} /></View>
          <Serif size={20} style={s.center}>Round done</Serif>
          <T size={13} c={D.sub} style={s.emptyBody}>
            {round.done_today} shop{round.done_today === 1 ? '' : 's'} collected today.
            Nothing else is holding cash.
          </T>
        </View>
      )}

      {!!stop && (
        <View style={s.stopCard}>
          <View style={s.row11}>
            <View style={s.stopAvatar}>
              <T w="b" size={11} c={D.accent}>{initials(stop.name)}</T>
            </View>
            <View style={s.grow}>
              <T w="b" size={14}>{stop.name}</T>
              <T size={11} c={D.sub} style={s.mt2}>
                {stop.owner}{stop.address ? ` · ${stop.address}` : ''}
              </T>
            </View>
            {stop.held_days != null && stop.held_days > 14 && (
              <View style={s.overdueChip}>
                <T w="b" size={10} c="#0D0D0F" ls={0.6}>OVERDUE</T>
              </View>
            )}
          </View>

          <View style={s.countRow}>
            <View style={s.grow}>
              <T w="b" size={10} c={D.sub} ls={1.2}>COUNT OUT</T>
              <T style={s.big}>{dh(stop.float_cents)} DH</T>
            </View>
            <T size={11} c={D.muted}>
              {stop.topups} top-up{stop.topups === 1 ? '' : 's'}
            </T>
          </View>

          <View style={s.codeBlock}>
            <T w="b" size={10} c={D.sub} ls={1.4}>THEIR CODE</T>
            <Pressable style={s.boxes} onPress={() => setDigits('')}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={[s.box, digits.length === i && s.boxOn]}>
                  {digits[i]
                    ? <T w="b" size={24} style={s.num}>{digits[i]}</T>
                    : digits.length === i ? <View style={s.caret} /> : null}
                </View>
              ))}
            </Pressable>
            <View style={s.pad}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0'].map((k) => (
                <Pressable key={k} style={s.key}
                  onPress={() => setDigits((d) => (k === '⌫' ? d.slice(0, -1)
                    : d.length < 4 ? d + k : d))}>
                  <T w="b" size={18}>{k}</T>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable disabled={digits.length < 4 || busy} onPress={() => confirm(stop)}
            style={[s.confirm, (digits.length < 4 || busy) && s.dim45]}>
            <T w="b" size={12.5} c="#fff" ls={0.6}>
              {busy ? 'CONFIRMING…' : `CONFIRM ${dh(stop.float_cents)} DH RECEIVED`}
            </T>
          </Pressable>
          <T size={11} c={D.muted} style={s.confirmNote}>
            Confirming moves their float to 0 and closes the task. It can't be undone
            in the shop.
          </T>
          {!stop.ready && (
            <T size={11} c={D.amber} style={s.center}>
              They haven't opened Settle up yet — ask them to, so a code exists.
            </T>
          )}
        </View>
      )}

      {round.stops.length > 1 && (
        <>
          <T w="b" size={11} c={D.sub} ls={1.65} style={s.mt2}>NEXT STOPS</T>
          {round.stops.map((x, i) => i === at ? null : (
            <Pressable key={x.id} onPress={() => { setAt(i); setDigits(''); }} style={s.nextRow}>
              <View style={s.nextAvatar}><T w="b" size={10} c={D.sub}>{initials(x.name)}</T></View>
              <View style={s.grow}>
                <T w="sb" size={12.5}>{x.name}</T>
                <T size={10.5} c={D.sub} style={s.mt2}>
                  {dh(x.float_cents)} DH{x.held_days != null ? ` · ${x.held_days} days held` : ''}
                </T>
              </View>
              <Ico name="chevron-right" size={15} color={D.muted} />
            </Pressable>
          ))}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  mt2: { marginTop: 2 },
  mt6: { marginTop: 6 },
  center: { textAlign: 'center' },
  num: { fontVariant: ['tabular-nums'] },
  dim55: { opacity: 0.55 },
  dim45: { opacity: 0.45 },
  row11: { flexDirection: 'row', alignItems: 'center', gap: 11 },

  // 9e
  handOver: {
    backgroundColor: D.card, borderWidth: 1, borderColor: D.border,
    borderRadius: 22, padding: 18, gap: 12,
  },
  handOverLate: { backgroundColor: '#1D1416', borderColor: '#332124' },
  huge: {
    fontFamily: serif, fontWeight: '700', fontSize: 40, lineHeight: 42, color: D.text,
    fontVariant: ['tabular-nums'],
  },
  heldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: D.border, paddingTop: 12,
  },
  heldRowLate: { borderTopColor: '#332124' },
  card: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 11 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  rule: { height: 1, backgroundColor: D.border },
  fine: { lineHeight: 17 },
  howRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 14,
    borderWidth: 2, borderColor: 'transparent',
  },
  howRowOn: { borderColor: D.accent },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: D.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { backgroundColor: D.accent, borderColor: D.accent },
  codeCard: {
    backgroundColor: '#101010', borderWidth: 1, borderColor: D.border, borderRadius: 20,
    padding: 17, gap: 12, alignItems: 'center',
  },
  code: {
    fontFamily: serif, fontWeight: '700', fontSize: 38, lineHeight: 40, color: D.text,
    letterSpacing: 4, fontVariant: ['tabular-nums'],
  },
  codeNote: { textAlign: 'center', lineHeight: 17 },
  ghost: {
    height: 52, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
  },
  noteText: { flex: 1, lineHeight: 18 },

  // 9f
  roundHead: {
    flexDirection: 'row', alignItems: 'flex-end', backgroundColor: D.card,
    borderRadius: 20, padding: 16,
  },
  big: {
    fontFamily: serif, fontWeight: '700', fontSize: 30, lineHeight: 32, color: D.text,
    marginTop: 5, fontVariant: ['tabular-nums'],
  },
  stopCard: {
    backgroundColor: D.card, borderRadius: 22, padding: 18, gap: 14,
    borderWidth: 2, borderColor: D.accent,
  },
  stopAvatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: D.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  overdueChip: { backgroundColor: D.amber, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  countRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    borderTopWidth: 1, borderTopColor: D.border, paddingTop: 14,
  },
  codeBlock: { gap: 9 },
  boxes: { flexDirection: 'row', gap: 9 },
  box: {
    flex: 1, height: 56, borderRadius: 12, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent',
  },
  boxOn: { backgroundColor: D.card, borderColor: D.accent },
  caret: { width: 2, height: 24, backgroundColor: D.accent },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  key: {
    width: '31.5%', height: 44, borderRadius: 12, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  confirm: {
    height: 52, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmNote: { textAlign: 'center', lineHeight: 17 },
  nextRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 13,
  },
  nextAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  empty: { alignItems: 'center', gap: 14, paddingTop: 40, paddingHorizontal: 20 },
  emptyCircle: {
    width: 74, height: 74, borderRadius: 37, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyBody: { textAlign: 'center', lineHeight: 20 },
});
