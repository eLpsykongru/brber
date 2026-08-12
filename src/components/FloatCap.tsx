import { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Btn, Card, Eyebrow, Ico, Sheet, T } from './dark';
import { supabase } from '../lib/supabase';
import { dark as d, inter, radius } from '../theme';

// Barber turn 11c/11d of "Barber App.dc.html" — the float cap, finally on screen.
//
// 0044 made `salons.float_cap_cents` real and enforced it inside
// `agent_cash_topup`. Nothing ever showed it. The first time a barber met the
// cap was a red error with a customer's 300 DH already in his hand — the exact
// shape of failure barber turn 10 spent six panels arguing against.
//
// 11c is the warning that arrives while he can still act on it. 11d is what
// happens if he doesn't, and its whole job is the second sentence: nothing was
// recorded, so give the money back.

export type FloatStatus = {
  salon: string | null;
  float_cents?: number; net_cents?: number; cap_cents?: number; room_cents?: number;
  pct?: number; typical_cents?: number; more_customers?: number;
  requested_at?: string | null; last_collected?: string | null;
};

type Room = { id: string; name: string; address: string; agent: string; room_cents: number; metres: number | null };

const dh = (cents: number) => `${Math.round(cents / 100).toLocaleString('en-US')} DH`;
const far = (m: number | null) => (m == null ? '' : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const mask = (p: string) => (p.trim().length > 6 ? `${p.trim().slice(0, -6)}••• ${p.trim().slice(-3)}` : p.trim());

export function useFloatStatus(reloadKey: unknown) {
  const [st, setSt] = useState<FloatStatus | null>(null);
  useEffect(() => {
    supabase.rpc('agent_float_status').then(({ data }) => setSt((data as FloatStatus) ?? null));
  }, [reloadKey]);
  return [st, setSt] as const;
}

// ---- 11c · close to the cap -------------------------------------------------
// Only shown from 70% up. A meter that is always there is furniture; one that
// appears when the room starts running out is a warning.

export function FloatCapMeter({ st, onAsk }: { st: FloatStatus | null; onAsk: () => void }) {
  const [asked, setAsked] = useState(false);
  if (!st?.salon || (st.pct ?? 0) < 70) return null;

  const full = (st.pct ?? 0) >= 100;
  const pending = asked || !!st.requested_at;

  return (
    <>
      <View style={s.capRow}>
        <Eyebrow c={full ? d.red : d.amber} ls={0.6}>
          {full ? 'CAP REACHED' : `${st.pct}% OF CAP`}
        </Eyebrow>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${st.pct ?? 0}%`, backgroundColor: full ? d.red : d.amber }]} />
      </View>
      <View style={s.capMeta}>
        <T size={11} c={d.sub}>
          {full ? 'No more top-ups until it is collected' : `Room for ${dh(st.room_cents ?? 0)} more`}
        </T>
        <T w="b" size={11} c={d.sub}>Cap {dh(st.cap_cents ?? 0)}</T>
      </View>
      <T size={12} c={d.textDim} style={s.capNote}>
        {full
          ? 'You are holding the most we let a shop carry. Ops has to collect before you can take cash again.'
          : `Once you hit the cap you can't take top-ups until ops collects. That's about ${st.more_customers} more ${st.more_customers === 1 ? 'customer' : 'customers'}.`}
      </T>
      <Btn title={pending ? 'OPS HAS BEEN ASKED' : 'ASK THEM TO COME TODAY'}
        icon={pending ? 'check' : 'phone'} bg={pending ? d.card2 : d.accent}
        fg={pending ? d.sub : '#fff'} height={50}
        onPress={() => { if (!pending) { setAsked(true); onAsk(); } }} />
    </>
  );
}

// ---- 11d · cap hit, cash in hand -------------------------------------------

// The design names the customer ("Give Rachid his 300 DH back"). We can't: the
// cap check in `agent_cash_topup` runs *before* the phone lookup, so at refusal
// time the server has never resolved a name. The masked phone he just typed is
// the honest identifier, and it is the one on the screen in front of him.
export function CapHitSheet({ attempt, st, onClose, onGaveBack, opsPhone }: {
  attempt: { phone: string; cents: number } | null;
  st: FloatStatus | null;
  onClose: () => void;
  onGaveBack: () => void;
  opsPhone: string;
}) {
  const [rooms, setRooms] = useState<Room[] | null>(null);

  useEffect(() => {
    if (!attempt) { setRooms(null); return; }
    supabase.rpc('agents_with_room', { p_cents: attempt.cents })
      .then(({ data }) => setRooms((data as Room[]) ?? []));
    // 11d's "Nadia has been told automatically". It has to happen out here: the
    // cap refusal is an exception inside agent_cash_topup, so anything that
    // function wrote would roll back with it.
    supabase.rpc('request_float_collection');
  }, [attempt]);

  if (!attempt) return null;
  const near = rooms?.[0];

  return (
    <Sheet visible onClose={onClose} deep>
      <View style={s.hero}>
        <View style={s.heroChip}><Ico name="lock" size={25} color={d.amber} /></View>
        <T w="b" size={19} style={s.heroTitle}>Can't take this one</T>
        <T size={12.5} c={d.sub} style={s.heroSub}>
          You're holding {dh(st?.net_cents ?? 0)} — the most we let a shop carry.{' '}
          <T w="b" size={12.5}>Give the {dh(attempt.cents)} back.</T>
        </T>
      </View>

      <Card>
        <View style={s.who}>
          <View style={s.grow}>
            <T w="b" size={13}>{mask(attempt.phone)}</T>
            <T size={11} c={d.sub} style={s.gap2}>Not credited</T>
          </View>
          <T w="eb" size={15} style={s.tnum}>{dh(attempt.cents)}</T>
        </View>
        <View style={s.assure}>
          <Ico name="shield" size={13} color={d.green} />
          <T size={11.5} c={d.sub} style={s.grow}>Nothing was recorded. Their balance is unchanged.</T>
        </View>
      </Card>

      <Eyebrow>WHAT THEY CAN DO INSTEAD</Eyebrow>
      {near && (
        <Card ring={d.accent}>
          <View style={s.alt}>
            <View style={s.altChip}><Ico name="map-pin" size={15} color={d.accent} /></View>
            <View style={s.grow}>
              <T w="b" size={12.5}>Top up at {near.name}</T>
              <T size={11} c={d.sub} style={s.gap2}>
                {[far(near.metres), `${near.agent.split(' ')[0]} has room for ${dh(near.room_cents)}`]
                  .filter(Boolean).join(' · ')}
              </T>
            </View>
          </View>
        </Card>
      )}
      <Card>
        <View style={s.alt}>
          <View style={s.altChipDim}><Ico name="calendar" size={15} color={d.sub} /></View>
          <View style={s.grow}>
            <T w="sb" size={12.5}>Just pay you at the shop</T>
            <T size={11} c={d.sub} style={s.gap2}>They book with no deposit and pay cash</T>
          </View>
        </View>
      </Card>

      <View style={s.told}>
        <View style={s.toldChip}><Ico name="clock" size={14} color={d.amber} /></View>
        <View style={s.grow}>
          <T w="b" size={12} c={d.amber}>Ops has been told automatically</T>
          <T size={11} c={d.sub} style={s.gap2}>They'll come sooner than their next round</T>
        </View>
      </View>

      <Btn title={`I GAVE THE ${dh(attempt.cents)} BACK`} height={52} ls={0.72}
        onPress={() => { onGaveBack(); onClose(); }} />
      <T w="sb" size={12} c={d.sub} style={s.call}
        onPress={() => Linking.openURL(`tel:${opsPhone}`)}>Call ops now</T>
    </Sheet>
  );
}

/** The cap error `agent_cash_topup` raises, told apart from every other failure. */
export function isCapError(message: string) {
  return /limit is|Settle up first/i.test(message);
}

export function askCollection() {
  supabase.rpc('request_float_collection').then(({ error }) => {
    if (error) Alert.alert('Could not send that', error.message);
  });
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  tnum: { fontVariant: ['tabular-nums'] },
  gap2: { marginTop: 2 },

  capRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  fill: { height: '100%' },
  capMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  capNote: {
    lineHeight: 18, borderTopWidth: 1, borderTopColor: '#332124', paddingTop: 14,
  },

  hero: { alignItems: 'center', paddingTop: 2 },
  heroChip: {
    width: 56, height: 56, borderRadius: radius.pill, backgroundColor: d.amberSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { marginTop: 12 },
  heroSub: { marginTop: 7, textAlign: 'center', lineHeight: 19 },

  who: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  assure: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11,
    borderTopWidth: 1, borderTopColor: d.border, paddingTop: 11,
  },

  alt: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  altChip: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: d.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  altChipDim: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: d.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  told: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: d.amberSoft12, borderWidth: 1, borderColor: d.amberLine,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  toldChip: {
    width: 30, height: 30, borderRadius: radius.pill, backgroundColor: d.amberSoft16,
    alignItems: 'center', justifyContent: 'center',
  },

  call: { textAlign: 'center', fontFamily: inter.sb },
});
