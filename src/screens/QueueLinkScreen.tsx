import { Ionicons } from '@expo/vector-icons';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Display, PillButton } from '../components/ui';
import type { QueueLink } from '../lib/queueLink';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, TOP_INSET } from '../theme';

// A shop's queue link opened the app — ADDENDUM-app-first (turn Q3). The web page
// is for anonymous eyes; places are held here.
//
//   QL-19  signed in: the poster's QR opens with nobody pre-picked ("Anyone free"),
//          a barber's text (?b=) with his chair chosen and the picker folded away.
//   QL-21  the same screen on the first open after an install, the shop carried
//          through Google Play's install referrer (lib/queueLink.ts).
//   QL-22  signed out: the link is kept through the sign-in.
//
// Everything reads 0110's public_queue — the page's own read — so the app and the
// page cannot quote a different wait. Nothing is held until HOLD MY PLACE, so no
// screen here says a number is "still yours" or "waiting for you": it says the
// number you would get, read again every 20 s.

type Service = { id: string; name: string; price_cents: number; wait_min: number | null };
type Chair = {
  code: string; name: string; initials: string; waiting: number; next_no: number; state: string;
  services: Service[];
};
type Queue = {
  found: boolean; code: string; name: string; address: string | null; close_min: number | null;
  open: boolean; shut: boolean; chosen: string | null; chairs: Chair[];
};
type Pick = { chair: string; service: string | null };   // chair: a code, or '*' for anyone

const POLL_MS = 20_000;   // QueueScreen's rail
const pad = (n: number) => String(n).padStart(2, '0');
const first = (name: string) => name.split(' ')[0];
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const fitting = (c: Chair) => c.services.filter((v) => v.wait_min != null);
const waitOf = (c: Chair) => fitting(c)[0]?.wait_min ?? null;
const taking = (c: Chair) => c.state === 'taking' && waitOf(c) != null;

/** The chair and service a pick lands on: a chosen chair keeps its service; "anyone" is whoever starts soonest. */
function resolve(q: Queue, pick: Pick): { chair: Chair; service: Service } | null {
  const open = q.chairs.filter(taking);
  if (pick.chair !== '*') {
    const chair = open.find((c) => c.code === pick.chair);
    const list = chair ? fitting(chair) : [];
    const service = list.find((v) => v.name === pick.service) ?? list[0];
    if (chair && service) return { chair, service };
  }
  let best: { chair: Chair; service: Service } | null = null;
  for (const chair of open) {
    for (const service of fitting(chair)) {
      if (pick.service && service.name !== pick.service) continue;
      if (!best || service.wait_min! < best.service.wait_min!) best = { chair, service };
    }
  }
  return best ?? (pick.service ? resolve(q, { chair: '*', service: null }) : null);
}

/** The service chips: one chair's menu, or each service once, priced by whoever starts it soonest. */
function menu(q: Queue, pick: Pick): Service[] {
  const open = q.chairs.filter(taking);
  const mine = pick.chair === '*' ? null : open.find((c) => c.code === pick.chair);
  const seen = new Map<string, Service>();
  for (const chair of mine ? [mine] : open) {
    for (const v of fitting(chair)) {
      const had = seen.get(v.name);
      if (!had || v.wait_min! < had.wait_min!) seen.set(v.name, v);
    }
  }
  return [...seen.values()];
}

function useQueue(link: QueueLink) {
  const [q, setQ] = useState<Queue | null | undefined>(undefined);
  const load = useCallback(async () => {
    // 0110's page read, callable with no session
    const { data, error } = await supabase.rpc('public_queue', { p_shop: link.shop, p_barber: link.barber ?? null });
    if (error) return;   // keep what is on screen; the next poll tries again
    setQ((data as Queue | null)?.found ? (data as Queue) : null);
  }, [link.url]);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  return q;
}

function Brand({ onDismiss, children }: { onDismiss: () => void; children?: ReactNode }) {
  return (
    <View style={s.top}>
      <View style={s.logo}><Ionicons name="cut-outline" size={14} color="#fff" /></View>
      {children ?? <Text style={s.wordmark}>STERNCUT</Text>}
      <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
        <Ionicons name="close" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

// ---- QL-19 · QL-21 · signed in: one screen, two ways in --------------------------------
export function QueueLinkOpen({ link, onJoined, onBrowser, onDismiss }: {
  link: QueueLink;
  onJoined: (bookingId: string) => void;
  /** "Just looking at the line": the read-only page */
  onBrowser: () => void;
  onDismiss: () => void;
}) {
  const q = useQueue(link);
  const [pick, setPick] = useState<Pick | null>(null);
  const [folded, setFolded] = useState(true);
  const [busy, setBusy] = useState(false);

  // the first read decides the starting pick: his chair from ?b=, if it can take anyone
  useEffect(() => {
    if (!q || pick) return;
    const his = q.chairs.find((c) => c.code === q.chosen);
    setPick({ chair: his && taking(his) ? his.code : '*', service: null });
  }, [q]);

  const r = q && pick ? resolve(q, pick) : null;

  async function hold() {
    if (!q || !r || busy) return;
    setBusy(true);
    try {
      // join_queue works in uuids; the page's read speaks codes (0110)
      const { data: ids, error: e1 } = await supabase.rpc('resolve_shop_code', { p_shop: q.code, p_barber: r.chair.code });
      const barber = (ids as { barber: string | null } | null)?.barber;
      if (e1 || !barber) throw new Error(e1?.message ?? 'That chair is no longer in this shop.');
      const { data, error } = await supabase.rpc('join_queue', { p_barber: barber, p_service: r.service.id });
      if (error) throw new Error(error.message);
      onJoined(data as string);
    } catch (e: any) {
      Alert.alert('Could not hold a place', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const header = link.fresh ? 'Welcome — from the link you tapped' : 'Opened straight in the app';
  if (q === undefined) {
    return (
      <View style={s.screen}>
        <Brand onDismiss={onDismiss}><Text style={s.headerNote}>{header}</Text></Brand>
        <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />
      </View>
    );
  }

  const count = q ? q.chairs.reduce((n, c) => n + c.waiting, 0) : 0;
  const his = q && pick && pick.chair !== '*' ? q.chairs.find((c) => c.code === pick.chair) ?? null : null;
  const fromLink = !!q?.chosen && his?.code === q.chosen;
  const open = q ? q.chairs.filter((c) => c.state !== 'off' && c.state !== 'no_services') : [];
  const soonest = q ? Math.min(...q.chairs.filter(taking).map((c) => waitOf(c)!)) : 0;

  return (
    <View style={s.screen}>
      <Brand onDismiss={onDismiss}>
        <Text style={s.headerNote}>{header}</Text>
        {!!q && r && <View style={s.live}><View style={s.liveDot} /><Text style={s.liveText}>LIVE</Text></View>}
      </Brand>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View>
          <Display size={26}>{q?.name ?? 'This shop'}</Display>
          {!!q && (
            <Text style={s.meta}>
              {[`${count} in the line`, q.close_min != null ? `open until ${hhmm(q.close_min)}` : null]
                .filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>

        {!q && <Text style={s.lede}>That link is not a shop we know.</Text>}

        {!!q && !r && (
          <View style={s.inkCard}>
            <Text style={s.inkText}>
              {q.shut ? 'No line right now — the shop is closed for today.' : 'No walk-ins right now — nobody here is taking a new place.'}
            </Text>
          </View>
        )}

        {!!q && r && pick && (
          <>
            <View style={s.inkCard}>
              <View style={s.inkNow}>
                <Text style={s.inkLabel}>{pick.chair === '*' ? 'FIRST FREE' : 'WAIT NOW'}</Text>
                <Text style={s.inkBig}>~{r.service.wait_min} min</Text>
              </View>
              <View style={s.vr} />
              <Text style={s.inkText}>
                {pick.chair === '*'
                  ? `${first(r.chair.name)} is free soonest · you'd be Nº ${pad(r.chair.next_no)}`
                  : `${r.chair.waiting} ahead with ${first(r.chair.name)} · you'd be Nº ${pad(r.chair.next_no)}`}
              </Text>
            </View>

            <Text style={s.eyebrow}>WHO'S CUTTING</Text>
            {fromLink && folded ? (
              // a barber's text: his chair is chosen and the picker folds away
              <Pressable onPress={() => setFolded(false)} accessibilityRole="button"
                style={({ pressed }) => [s.picked, pressed && s.pressed]}>
                <View style={[s.av, s.avOn]}><Text style={[s.avText, s.avTextOn]}>{his!.initials}</Text></View>
                <View style={s.grow}>
                  <Text style={s.pickedName}>{first(his!.name)}</Text>
                  <Text style={s.pickedSub}>Picked from the link · tap to change</Text>
                </View>
              </Pressable>
            ) : (
              <View style={{ gap: 8 }}>
                <Pressable onPress={() => setPick({ ...pick, chair: '*' })} accessibilityRole="button"
                  accessibilityState={{ selected: pick.chair === '*' }}
                  style={({ pressed }) => [s.anyone, pick.chair === '*' && s.anyoneOn, pressed && s.pressed]}>
                  <View style={[s.anyIco, pick.chair === '*' && s.anyIcoOn]}>
                    <Ionicons name="people-outline" size={17} color={pick.chair === '*' ? '#fff' : colors.textSecondary} />
                  </View>
                  <View style={s.grow}>
                    <Text style={[s.anyTitle, pick.chair === '*' && s.onInk]}>Anyone free</Text>
                    <Text style={[s.anySub, pick.chair === '*' && s.onInkDim]}>Fastest · whoever opens up first</Text>
                  </View>
                  <Text style={[s.anyWait, pick.chair === '*' && s.onInk]}>~{soonest} min</Text>
                </Pressable>
                <View style={s.chairs}>
                  {open.map((c) => {
                    const on = pick.chair === c.code;
                    const can = taking(c);
                    return (
                      <Pressable key={c.code} disabled={!can} onPress={() => setPick({ ...pick, chair: c.code })}
                        accessibilityRole="button" accessibilityState={{ selected: on, disabled: !can }}
                        style={({ pressed }) => [s.chair, on && s.chairOn, !can && s.dim, pressed && s.pressed]}>
                        <View style={[s.av, on && s.avOn]}><Text style={[s.avText, on && s.avTextOn]}>{c.initials}</Text></View>
                        <Text style={s.chairName}>{first(c.name)}</Text>
                        <Text style={[s.chairWait, can && waitOf(c) === soonest && s.soon]}>
                          {can ? `~${waitOf(c)} min` : 'Not taking'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <Text style={s.eyebrow}>SERVICE</Text>
            <View style={s.chips}>
              {menu(q, pick).map((v) => {
                const on = v.name === r.service.name;
                return (
                  <Pressable key={v.name} onPress={() => setPick({ ...pick, service: v.name })} accessibilityRole="button"
                    accessibilityState={{ selected: on }} style={[s.chip, on && s.chipOn]}>
                    <Text style={[s.chipText, on && s.onInk]}>{v.name} · {Math.round(v.price_cents / 100)} DH</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <View style={s.foot}>
        {!!r && (
          <Pressable onPress={hold} disabled={busy} accessibilityRole="button"
            style={({ pressed }) => [s.hot, pressed && s.hotPressed, busy && s.dim]}>
            {busy ? <ActivityIndicator color="#fff" />
              : <Text style={s.hotText}>HOLD MY PLACE · ~{r.service.wait_min} MIN</Text>}
          </Pressable>
        )}
        {!!q && (
          <Text style={s.textLink} onPress={onBrowser} accessibilityRole="link">Just looking at the line</Text>
        )}
      </View>
    </View>
  );
}

// ---- QL-22 · installed, signed out · the sign-in keeps the link ------------------------
// The design signs in with a texted code; the app signs in with email, Google or
// Apple, so there is no number to type here — SIGN IN opens the app's own sign-in.
export default function QueueLinkScreen({ link, onSignIn, onBrowser, onDismiss }: {
  link: QueueLink; onSignIn: () => void; onBrowser: () => void; onDismiss: () => void;
}) {
  const q = useQueue(link);
  const open = q ? q.chairs.filter(taking) : [];
  const chair = open.find((c) => c.code === q?.chosen)
    ?? [...open].sort((a, b) => waitOf(a)! - waitOf(b)!)[0] ?? null;

  return (
    <View style={s.screen}>
      <Brand onDismiss={onDismiss} />
      <View style={s.body}>
        {!!q && (
          <View style={s.inkCard}>
            {chair && (
              <View>
                <Text style={s.inkLabel}>YOU'D BE</Text>
                <Text style={s.inkNo}>Nº {pad(chair.next_no)}</Text>
              </View>
            )}
            {chair && <View style={s.vr} />}
            <Text style={s.inkText}>
              {chair
                ? `${q.name} with ${first(chair.name)} · ~${waitOf(chair)} min — sign in to hold a place`
                : `${q.name} · no walk-ins right now`}
            </Text>
          </View>
        )}

        <View>
          <Display size={26}>Hold a place</Display>
          <Text style={s.lede}>Sign in and this shop opens with its chairs and its waits.</Text>
        </View>

        <View style={s.note}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} style={{ marginTop: 2 }} />
          <Text style={s.noteText}>
            The link is kept through sign-in — close the app now and it still opens on this shop today.
          </Text>
        </View>
      </View>

      <View style={s.foot}>
        <PillButton title="SIGN IN" onPress={onSignIn} />
        <Text style={s.textLink} onPress={onBrowser} accessibilityRole="link">See the line without signing in</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#EBE8E1', paddingTop: TOP_INSET - 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingBottom: 14 },
  logo: {
    width: 26, height: 26, borderRadius: 8, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  wordmark: { flex: 1, fontFamily: serif, fontSize: 14, letterSpacing: 2, color: colors.text },
  headerNote: { flex: 1, fontSize: 12, color: colors.textSecondary },
  live: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(232,68,46,0.1)',
    borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 10,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  liveText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.1, color: colors.accent },
  body: { paddingHorizontal: 20, gap: 12, paddingBottom: 12 },
  meta: { fontSize: 12, color: colors.textSecondary, marginTop: 5 },
  lede: { fontSize: font.small, lineHeight: 20, color: '#5C5C58', marginTop: 8 },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  dim: { opacity: 0.55 },
  onInk: { color: '#fff' },
  onInkDim: { color: 'rgba(255,255,255,0.55)' },

  inkCard: {
    flexDirection: 'row', alignItems: 'center', gap: 15, backgroundColor: colors.ink,
    borderRadius: 22, padding: 17,
  },
  inkNow: { alignItems: 'center', gap: 2 },
  inkLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  inkBig: { fontFamily: serif, fontSize: 26, color: '#fff' },
  inkNo: { fontFamily: serif, fontSize: 22, color: '#fff', marginTop: 1 },
  inkText: { flex: 1, fontSize: 12.5, lineHeight: 19, color: 'rgba(255,255,255,0.65)' },
  vr: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.12)' },

  eyebrow: { fontSize: 10.5, letterSpacing: 1.6, fontWeight: '700', color: colors.textSecondary },
  anyone: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14, ...shadow,
  },
  anyoneOn: { backgroundColor: colors.ink },
  anyIco: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  anyIcoOn: { backgroundColor: 'rgba(255,255,255,0.14)' },
  anyTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  anySub: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  anyWait: { fontFamily: serif, fontSize: 15, color: colors.text },
  chairs: { flexDirection: 'row', gap: 8 },
  chair: {
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.md, padding: 11,
    alignItems: 'center', gap: 4, ...shadow,
  },
  chairOn: { borderWidth: 2, borderColor: colors.ink, padding: 9 },
  av: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  avOn: { backgroundColor: colors.accentSoft },
  avText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  avTextOn: { color: colors.accent },
  chairName: { fontSize: 12, fontWeight: '700', color: colors.text },
  chairWait: { fontSize: 10, color: colors.textSecondary },
  soon: { color: '#16A34A', fontWeight: '600' },
  picked: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.bg,
    borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 13, ...shadow,
  },
  pickedName: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  pickedSub: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: radius.pill, backgroundColor: colors.bg, paddingVertical: 9, paddingHorizontal: 15 },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontSize: 12, fontWeight: '600', color: '#5C5C58' },

  note: {
    flexDirection: 'row', gap: 9, backgroundColor: colors.bg, borderRadius: radius.md,
    paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },

  foot: { marginTop: 'auto', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 30, gap: 9 },
  hot: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  hotPressed: { backgroundColor: '#C33421' },
  hotText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  textLink: {
    textAlign: 'center', fontSize: 11.5, color: colors.textSecondary,
    textDecorationLine: 'underline', paddingVertical: 6,
  },
});
