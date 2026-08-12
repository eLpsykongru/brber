import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Btn, Card, Eyebrow, Ico, Sheet, SheetHead, Stat, T, Toggle } from './dark';
import { supabase } from '../lib/supabase';
import { dark as d, radius } from '../theme';

// Barber turn 11a/11b of "Barber App.dc.html" — the shop pause.
//
// `salons.accepting_bookings` has existed since 0025 and the booking path never
// read it, so the header power button was a light switch wired to nothing. 0064
// gives it teeth (a BEFORE INSERT trigger on bookings) and an end date; this is
// the half that tells the owner what he is about to do to two other people's
// day before he does it.
//
// Note on labels: `11a`/`11b` here mean BARBER turn 11. Customer turn 11 is the
// reschedule picker in MyBookingScreen — same ids, different app.

type Preview = {
  salon: string; name: string; open: boolean;
  barbers: number; booked_today: number;
  working_today: { id: string; name: string }[];
  waiting: number;
};

export type ShopStatus = {
  salon: string | null; name?: string; open?: boolean;
  closed_at?: string | null; closed_until?: string | null;
  barbers?: number; booked_cents?: number; left_today?: number;
  topups_on?: boolean; waiting?: number; waiting_names?: string[];
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

/** "until tomorrow" / "until 4 Aug" / "until you reopen" — the banner's tail. */
export function untilLabel(closed_until?: string | null) {
  if (!closed_until) return 'until you reopen';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(`${closed_until}T00:00:00`);
  const days = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (days <= 0) return 'until tomorrow';
  const back = new Date(end.getTime() + 86400000);
  return `until ${back.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

// ---- 11a · pause the shop, and what it covers ------------------------------

export function ShopPauseSheet({ visible, onClose, onClosed }: {
  visible: boolean; onClose: () => void; onClosed: () => void;
}) {
  const [p, setP] = useState<Preview | null>(null);
  const [scope, setScope] = useState<'today' | 'open' | 'until'>('today');
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setP(null); setScope('today'); setTell(true);
    supabase.rpc('shop_pause_preview').then(({ data, error }) => {
      if (error) { Alert.alert('Could not load', error.message); onClose(); return; }
      setP(data as Preview);
    });
  }, [visible, onClose]);

  async function close() {
    if (busy) return;
    if (scope === 'until') {
      // ponytail: no date picker for the third option — "pick dates" needs a
      // calendar this sheet doesn't have, and the two periods that matter are
      // here. Wire SlotPicker's month grid in if an owner asks for a range.
      Alert.alert('Pick dates', 'Not built yet — use "Rest of today" or "Until I reopen".');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('close_shop', {
      p_scope: scope, p_until: null, p_tell_waitlist: tell,
    });
    setBusy(false);
    if (error) { Alert.alert('Could not close the shop', error.message); return; }
    onClosed();
    onClose();
  }

  const working = p?.working_today ?? [];

  return (
    <Sheet visible={visible} onClose={onClose} deep>
      <SheetHead title={`Close ${p?.name ?? 'the shop'}`} onClose={onClose} />
      <T size={11} c={d.sub} style={s.headSub}>This closes the whole shop, not just you</T>

      <Eyebrow>FOR HOW LONG</Eyebrow>
      <View style={s.periodRow}>
        {([['today', 'Rest of today'], ['open', 'Until I reopen'], ['until', 'Pick dates']] as const)
          .map(([k, label]) => (
            <Pressable key={k} onPress={() => setScope(k)} accessibilityLabel={label}
              accessibilityState={{ selected: scope === k }}
              style={[s.period, scope === k && s.periodOn]}>
              <T w={scope === k ? 'b' : 'sb'} size={12.5} c={scope === k ? '#fff' : d.sub}>{label}</T>
            </Pressable>
          ))}
      </View>

      {p === null ? <ActivityIndicator style={s.spin} /> : (
        <>
          {/* the whole reason the sheet exists: the switch says what it does */}
          <Card>
            <Eyebrow>WHAT CLOSING DOES</Eyebrow>
            <View style={s.effects}>
              <Effect no>No new bookings for <T w="b" size={12.5}>all {p.barbers} {p.barbers === 1 ? 'barber' : 'barbers'}</T></Effect>
              <Effect no>The walk-in QR stops working</Effect>
              <Effect>Today's {p.booked_today} {p.booked_today === 1 ? 'booking' : 'bookings'} still stand</Effect>
              <Effect>You can still take cash top-ups</Effect>
            </View>
          </Card>

          {working.length > 0 && (
            <View style={s.warn}>
              <View style={s.warnChip}><Ico name="alert-triangle" size={15} color={d.amber} /></View>
              <View style={s.grow}>
                <T w="b" size={12.5} c={d.amber}>
                  {working.map((w) => w.name.split(' ')[0]).join(', ')} {working.length === 1 ? 'is' : 'are'} working today
                </T>
                <T size={11} c={d.sub} style={s.warnSub}>
                  {working.length === 1 ? "He'll" : "They'll"} be told the shop is closed
                </T>
              </View>
            </View>
          )}

          {p.waiting > 0 && (
            <View style={s.tellRow}>
              <View style={s.grow}>
                <T w="b" size={12.5}>Tell the {p.waiting} {p.waiting === 1 ? 'person' : 'people'} on the waiting list</T>
                <T size={11} c={d.sub} style={s.warnSub}>
                  Otherwise {p.waiting === 1 ? 'he waits' : 'they wait'} for a slot that won't come
                </T>
              </View>
              <Toggle on={tell} onPress={() => setTell(!tell)} />
            </View>
          )}

          <Btn title={busy ? 'CLOSING…' : scope === 'today'
            ? 'CLOSE FOR THE REST OF TODAY' : 'CLOSE UNTIL I REOPEN'}
            bg={d.red} fg={d.bg} height={54} onPress={close} />
          <T size={11} c="#6B6B72" style={s.foot}>Only you can reopen it — your barbers can't.</T>
        </>
      )}
    </Sheet>
  );
}

function Effect({ children, no }: { children: React.ReactNode; no?: boolean }) {
  return (
    <View style={s.effect}>
      <View style={[s.effectDot, { backgroundColor: no ? 'rgba(248,113,113,0.18)' : d.greenSoft }]}>
        <Ico name={no ? 'x' : 'check'} size={10} color={no ? d.red : d.green} />
      </View>
      <T size={12.5} c={d.textDim} style={s.effectText}>{children}</T>
    </View>
  );
}

// ---- 11b · shop closed, you're still here ----------------------------------
// The banner rides the dashboard. It leads with what did NOT stop, because the
// owner's first fear on seeing "closed" is that he just cancelled his own day.

export function ShopClosedBanner({ st, onReopened }: {
  st: ShopStatus; onReopened: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!st.salon || st.open !== false) return null;

  async function reopen() {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('reopen_shop');
    setBusy(false);
    if (error) { Alert.alert('Could not reopen', error.message); return; }
    onReopened();
  }

  const told = st.waiting_names ?? [];
  return (
    <View style={s.banner}>
      <View style={s.bannerTop}>
        <View style={s.bannerChip}><Ico name="power" size={16} color={d.red} /></View>
        <View style={s.grow}>
          <T w="b" size={13} c={d.red}>Shop closed {untilLabel(st.closed_until)}</T>
          <T size={11} c={d.sub} style={s.warnSub}>
            {st.closed_at ? `You closed it at ${clock(st.closed_at)} · ` : ''}
            all {st.barbers} {st.barbers === 1 ? 'barber' : 'barbers'}
          </T>
        </View>
        <Pressable onPress={reopen} disabled={busy} accessibilityLabel="Reopen the shop"
          style={({ pressed }) => [s.reopen, pressed && s.pressed]}>
          <T w="eb" size={11} c={d.bg} ls={0.44}>{busy ? '…' : 'REOPEN'}</T>
        </Pressable>
      </View>
      {told.length > 0 && (
        <T size={12} c={d.textDim} style={s.bannerNote}>
          {told.map((n) => n.split(' ')[0]).join(', ')} {told.length === 1 ? 'was' : 'were'} told.
          {told.length === 1 ? ' He asked' : ' They asked'} to be pinged when you reopen.
        </T>
      )}
    </View>
  );
}

/**
 * The three chips under 11b's earnings line, and the footnote nobody asks for
 * until they've made the mistake once. The money above them is the dashboard's
 * own BOOKED TODAY block — 11b only relabels it, it doesn't draw a second one.
 */
export function ShopClosedTiles({ st }: { st: ShopStatus }) {
  if (!st.salon || st.open !== false) return null;
  return (
    <>
      <View style={s.tiles}>
        <Stat label="LEFT TODAY" value={String(st.left_today ?? 0)} />
        <Stat label="WALK-IN QR" value="Off" valueColor={d.red} />
        <Stat label="TOP-UPS" value="On" valueColor={d.green} />
      </View>
      <View style={s.hint}>
        <Ico name="info" size={14} color={d.sub} />
        <T size={12} c={d.sub} style={s.hintText}>
          Closing the shop is different from clocking yourself out. To stop only your own
          bookings, use your own switch.
        </T>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  spin: { marginVertical: 24 },
  headSub: { marginTop: -8 },

  periodRow: { flexDirection: 'row', gap: 8 },
  period: {
    flex: 1, height: 44, borderRadius: 13, backgroundColor: d.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  periodOn: { backgroundColor: d.accent },

  effects: { gap: 12, marginTop: 2 },
  effect: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  effectDot: {
    width: 19, height: 19, borderRadius: radius.pill, marginTop: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  effectText: { flex: 1, lineHeight: 19 },

  warn: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: d.amberSoft12, borderWidth: 1, borderColor: d.amberLine,
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16,
  },
  warnChip: {
    width: 32, height: 32, borderRadius: radius.pill, backgroundColor: d.amberSoft16,
    alignItems: 'center', justifyContent: 'center',
  },
  warnSub: { marginTop: 2 },

  tellRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: d.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16,
  },
  foot: { textAlign: 'center', lineHeight: 17 },

  banner: {
    backgroundColor: 'rgba(248,113,113,0.08)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.30)',
    borderRadius: 20, padding: 16, gap: 13,
  },
  bannerTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  bannerChip: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: 'rgba(248,113,113,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  reopen: {
    height: 30, borderRadius: radius.pill, backgroundColor: d.red,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12,
  },
  bannerNote: {
    lineHeight: 18, borderTopWidth: 1, borderTopColor: 'rgba(248,113,113,0.20)', paddingTop: 13,
  },

  tiles: { flexDirection: 'row', gap: 10 },

  hint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: d.card, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  hintText: { flex: 1, lineHeight: 18 },
});
