import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Eyebrow, GhostBtn, Ico, Screen, Serif, T, TopBar } from '../components/dark';
import { ShopPauseSheet } from '../components/ShopPause';
import { useAndroidBack } from '../lib/back';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import BarberQueueScreen from './BarberQueueScreen';
import { tr, trRich } from '../lib/i18n';

// OSH-19 — all chairs, the live lines (ADDENDUM-app-first, owner turn T9). OSH-03
// answers "what does the day look like"; this answers the question an owner asks
// standing in his own shop: who is drowning right now. So it is four numbers, worst
// wait first — the ordering is the insight.
//
// A diagnosis, not a control panel. Another barber's line opens read-only: calling,
// dropping and moving a man are that barber's calls, at his chair. His own chair
// opens his own board. The one shop-wide lever stays OSH-09's pause.

type LineEntry = {
  no: number; label: string; in_chair: boolean; called: boolean; dropped: boolean;
  unconfirmed: boolean; wait_min: number | null;
};
type Chair = {
  barber_id: string; name: string; me: boolean; working: boolean;
  paused: boolean; paused_at: string | null; in_chair: string | null;
  waiting: number; unconfirmed: number; wait_min: number | null; line: LineEntry[];
};

const POLL_MS = 20_000;
const first = (n: string) => n.split(' ')[0];
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const pad = (n: number) => String(n).padStart(2, '0');

/** Worst wait first; a paused chair after the ones taking people, a chair off today last. */
function worstFirst(a: Chair, b: Chair) {
  const rank = (c: Chair) => (!c.working ? 2 : c.paused ? 1 : 0);
  return rank(a) - rank(b) || (b.wait_min ?? -1) - (a.wait_min ?? -1) || b.waiting - a.waiting;
}

export default function LinesScreen({ onBack }: { onBack: () => void }) {
  const [chairs, setChairs] = useState<Chair[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);

  const load = useCallback(async (quiet = false) => {
    const { data, error } = await supabase.rpc('shop_lines_today');
    if (error) {
      if (!quiet) Alert.alert(tr('Could not load the lines'), error.message);
      return;
    }
    setChairs((data as Chair[]) ?? []);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useAndroidBack(openId ? () => { setOpenId(null); load(); } : null);

  const opened = openId ? chairs?.find((c) => c.barber_id === openId) ?? null : null;
  if (opened?.me) {
    return <BarberQueueScreen barberId={opened.barber_id} onBack={() => { setOpenId(null); load(); }} />;
  }
  if (opened) return <ChairLine chair={opened} onBack={() => setOpenId(null)} />;

  const list = [...(chairs ?? [])].sort(worstFirst);
  const taking = list.filter((c) => c.working && !c.paused);
  const total = list.reduce((n, c) => n + c.waiting, 0);
  const unconfirmed = list.reduce((n, c) => n + c.unconfirmed, 0);
  const worst = taking.find((c) => (c.wait_min ?? 0) > 0) ?? null;
  const quickest = [...taking].sort((a, b) => (a.wait_min ?? 0) - (b.wait_min ?? 0))[0] ?? null;

  return (
    <Screen gap={12}>
      <TopBar title={tr('The lines')} onBack={onBack} />

      <View style={s.summary}>
        <View>
          <T w="b" size={9.5} c={D.sub} ls={1.1}>{tr('WAITING IN THE SHOP')}</T>
          <Serif size={36} ls={0} style={s.tnum}>{String(total)}</Serif>
        </View>
        <View style={s.rule} />
        <View style={[s.grow, { gap: 5 }]}>
          <T size={11.5} c={D.sub} style={{ lineHeight: 16.5 }}>
            {worst
              ? <>{trRich("Longest wait is <b>~{wait} min</b> at {name}'s chair.", {
                b: (text, key) => <T key={key} w="b" size={11.5}>{text}</T>,
              }, { wait: worst.wait_min, name: first(worst.name) })}{quickest && quickest.barber_id !== worst.barber_id ? ` ${tr('{name} is quickest at ~{wait_min} min.', { name: first(quickest.name), wait_min: quickest.wait_min ?? 0 })}` : ''}</>
              : taking.length ? tr('Nobody is waiting long right now.') : tr('No chair is taking walk-ins right now.')}
          </T>
          {unconfirmed > 0 && (
            <T size={11} c={D.amber}>{unconfirmed === 1 ? tr('1 name never confirmed') : tr('{unconfirmed} names never confirmed', { unconfirmed })}</T>
          )}
        </View>
      </View>

      <Eyebrow ls={1.5}>{tr('WORST WAIT FIRST')}</Eyebrow>
      {chairs === null && <ActivityIndicator color={D.accent} accessibilityLabel={tr('Loading the lines')} />}
      <View style={{ gap: 8 }}>
        {list.map((c, i) => {
          const isWorst = i === 0 && c === worst;
          const isQuick = c === quickest && !isWorst && taking.length > 1;
          const sub = !c.working ? tr('Not working today')
            : c.paused ? (c.paused_at ? tr('Line paused {at} · still cutting bookings', { at: hhmm(c.paused_at) }) : tr('Line paused · still cutting bookings'))
              : c.in_chair ? tr('{name} in the chair', { name: c.in_chair }) : tr('Chair empty · free now');
          return (
            <Pressable key={c.barber_id} onPress={() => setOpenId(c.barber_id)} accessibilityRole="button"
              accessibilityLabel={c.paused ? tr('{name}, {waiting} waiting, paused', { name: first(c.name), waiting: c.waiting }) : tr('{name}, {waiting} waiting', { name: first(c.name), waiting: c.waiting })}
              style={({ pressed }) => [s.chair, isWorst && s.chairWorst, (c.paused || !c.working) && s.chairQuiet, pressed && s.pressed]}>
              <Avatar size={40} warm={c.me} initials={initials(c.name)} />
              <View style={s.grow}>
                <T w="b" size={13.5} c={c.paused || !c.working ? D.sub : D.text}>{first(c.name)}{c.me ? tr(' · you') : ''}</T>
                <T size={11} c={!c.in_chair && c.working && !c.paused ? D.green : D.sub} style={{ marginTop: 2 }}>
                  {sub}
                  {c.unconfirmed > 0 ? <T size={11} c={D.amber}>{' '}{tr('· {unconfirmed} unconfirmed', { unconfirmed: c.unconfirmed })}</T> : null}
                </T>
              </View>
              {c.paused ? (
                <View style={s.pausedChip}><T w="b" size={10} c={D.sub} ls={0.6}>{tr('PAUSED')}</T></View>
              ) : c.working ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Serif size={19} ls={0} c={isWorst ? D.red : isQuick ? D.green : D.text} style={s.tnum}>{String(c.waiting)}</Serif>
                  <T size={10} c={D.sub} style={{ marginTop: 3 }}>{tr('~{wait_min} min', { wait_min: c.wait_min ?? 0 })}</T>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={s.can}>
        <T w="b" size={10} c={D.sub} ls={1.4}>{tr('WHAT YOU CAN DO FROM HERE')}</T>
        <Can yes text={tr('Open a chair and see that barber\'s line')} />
        <Can yes text={tr('Pause the whole shop')} />
        <Can text={tr('Move a man from one barber\'s line to another — that is the barber\'s call, at his chair')} />
        <T size={10.5} c={D.faint} style={s.canFoot}>
          {tr('Counts exclude whoever is in the chair, the same as each barber\'s own board.')}
        </T>
      </View>
      <GhostBtn title={tr('PAUSE THE WHOLE SHOP')} color={D.textDim} onPress={() => setPauseOpen(true)} />

      <ShopPauseSheet visible={pauseOpen} onClose={() => setPauseOpen(false)}
        onClosed={() => { setPauseOpen(false); load(); }} />
    </Screen>
  );
}

function Can({ yes, text }: { yes?: boolean; text: string }) {
  return (
    <View style={s.canRow}>
      <View style={[s.canTick, { backgroundColor: yes ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.07)' }]}>
        <Ico name={yes ? 'check' : 'x'} size={10} color={yes ? D.green : D.faint} />
      </View>
      <T size={12} c={yes ? D.textDim : D.faint} style={s.grow}>{text}</T>
    </View>
  );
}

// Another barber's line, as his board shows it — and nothing to press on it.
function ChairLine({ chair, onBack }: { chair: Chair; onBack: () => void }) {
  const state = (l: LineEntry) => l.in_chair ? tr('In the chair')
    : l.unconfirmed ? tr("Put on from the web · hasn't tapped")
      : l.called ? tr('Called · not in the chair yet')
        : l.dropped ? tr("Didn't come · at the end")
          : tr('~{wait_min} min', { wait_min: l.wait_min ?? 0 });
  return (
    <Screen gap={12}>
      <TopBar title={tr('{name}\'s line', { name: first(chair.name) })} onBack={onBack} />
      <View style={s.summary}>
        <View>
          <T w="b" size={9.5} c={D.sub} ls={1.1}>{tr('WAITING')}</T>
          <Serif size={36} ls={0} style={s.tnum}>{String(chair.waiting)}</Serif>
        </View>
        <View style={s.rule} />
        <T size={11.5} c={D.sub} style={[s.grow, { lineHeight: 16.5 }]}>
          {chair.paused ? tr('His line is paused — he is still cutting his bookings.')
            : chair.in_chair ? tr('{in_chair} in the chair.', { in_chair: chair.in_chair }) : tr('His chair is empty.')}
        </T>
      </View>
      {chair.line.length === 0 && <T size={13} c={D.sub}>{tr('Nobody in his line.')}</T>}
      <View style={{ gap: 8 }}>
        {chair.line.map((l) => (
          <View key={l.no} style={[s.chair, l.in_chair && s.inChair, l.unconfirmed && s.unconfirmedRow]}>
            <View style={[s.ticket, l.in_chair && { backgroundColor: D.greenSoft }, l.unconfirmed && { backgroundColor: D.amberSoft12 }]}>
              <T w="b" size={12} c={l.in_chair ? D.green : l.unconfirmed ? D.amber : D.sub}>{pad(l.no)}</T>
            </View>
            <View style={s.grow}>
              <T w="b" size={13.5} c={l.unconfirmed || l.dropped ? D.sub : D.text}>{l.label}</T>
              <T size={11} c={l.unconfirmed ? D.amber : D.sub} style={{ marginTop: 2 }}>{state(l)}</T>
            </View>
          </View>
        ))}
      </View>
      <View style={s.readOnly}>
        <Ico name="info" size={14} color={D.sub} />
        <T size={11.5} c={D.sub} style={[s.grow, { lineHeight: 17 }]}>
          {tr('Only {name} calls from this line — it is his chair and his judgement. This is what his board shows him.', { name: first(chair.name) })}
        </T>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  tnum: { fontVariant: ['tabular-nums'] },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: D.card,
    borderRadius: 22, padding: 17,
  },
  rule: { width: 1, alignSelf: 'stretch', backgroundColor: D.border },
  chair: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingVertical: 13, paddingHorizontal: 14,
  },
  chairWorst: { borderWidth: 2, borderColor: 'rgba(248,113,113,0.4)' },
  chairQuiet: { backgroundColor: D.recessed, borderWidth: 1, borderStyle: 'dashed', borderColor: '#2E2E34' },
  pausedChip: { backgroundColor: D.card2, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8 },
  can: { backgroundColor: D.card, borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16, gap: 11 },
  canRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  canTick: { width: 19, height: 19, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  canFoot: { borderTopWidth: 1, borderTopColor: D.border, paddingTop: 10, lineHeight: 15 },
  ticket: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  inChair: { borderWidth: 2, borderColor: D.green },
  unconfirmedRow: {
    backgroundColor: D.recessed, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(232,161,0,0.45)',
  },
  readOnly: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.recessed,
    borderWidth: 1, borderColor: D.seam, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 15,
  },
});
