import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Eyebrow, Ico, Screen, T, TopBar } from '../components/dark';
import { useAndroidBack } from '../lib/back';
import { agoLabel, ordinal } from '../lib/inboxRules';
import { ReviewFilter, ReviewRow, disputeOf, filterReviews, reviewSummary } from '../lib/profileRules';
import { supabase } from '../lib/supabase';
import { dark as D, serif } from '../theme';
import { PublicReplyScreen, Restored, ReviewRestoredScreen } from './BarberSupportScreens';

// G2 of "Notification Routing.dc.html" — BRV-08 and BRV-09 of "Barber - Reviews".
//
// A barber had a screen for disputing one review and one for replying to one,
// but no list of their own, so "Amine left you 5 stars" had nowhere to open.
// BRV-08 is the list with the breakdown behind the number they are judged on;
// BRV-09 is one review, with the two things they may do to it.
//
// Two of the mock's lines are not here. The 4.9 "is the last twelve months" —
// nothing in the app counts that way, and a second number that disagrees with the
// public page is worse than none. And reviews carry no tags (0008 never stored
// any). Reporting also cannot promise "yes or no, in writing": ops keeping a review
// sends nothing (0042), so the screen only promises what does happen.

type Row = ReviewRow & {
  booking_id: string; comment: string | null; created_at: string; replied_at: string | null;
  customer_id: string;
  customer: { full_name: string | null; avatar_url: string | null } | null;
  booking: {
    starts_at: string; price_cents: number; completed_at: string | null;
    services: { name: string } | null;
  } | null;
};

const COLS = 'id, booking_id, rating, comment, created_at, reply, replied_at, state, flagged_at, moderated_at,'
  + ' customer_id, customer:profiles!customer_id(full_name, avatar_url),'
  + ' booking:bookings(starts_at, price_cents, completed_at, services(name))';

const who = (r: Row) => r.customer?.full_name ?? 'A client';
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const visitWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.toTimeString().slice(0, 5)}`;
};
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n)));

export default function BarberReviewsScreen({ barberId, onBack, openBookingId }: {
  barberId: string; onBack: () => void;
  /** a review notification names a booking; open straight onto its review */
  openBookingId?: string;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [restored, setRestored] = useState<Restored[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [visitN, setVisitN] = useState<number | null>(null);
  const [replying, setReplying] = useState<Row | null>(null);
  const [showing, setShowing] = useState<Restored | null>(null);
  // arrived from the inbox straight onto one review: the list was never on the
  // way in, so back from that review leaves the screen
  const direct = useRef(!!openBookingId);
  const pendingOpen = useRef(openBookingId ?? null);

  const load = useCallback(async () => {
    const [rv, rs, nt] = await Promise.all([
      supabase.from('reviews').select(COLS).eq('barber_id', barberId)
        .order('created_at', { ascending: false }).limit(300),
      supabase.rpc('my_restored_reviews'),
      supabase.from('notifications').select('booking_id')
        .eq('user_id', barberId).eq('kind', 'review').is('read_at', null),
    ]);
    if (rv.error) { Alert.alert('Could not load your reviews', rv.error.message); return; }
    const list = (rv.data ?? []) as unknown as Row[];
    setRows(list);
    setRestored((rs.data ?? []) as Restored[]);
    setFresh(new Set(((nt.data ?? []) as { booking_id: string | null }[])
      .map((n) => n.booking_id).filter((x): x is string => !!x)));

    if (pendingOpen.current) {
      const hit = list.find((r) => r.booking_id === pendingOpen.current);
      pendingOpen.current = null;
      if (hit) setOpenId(hit.id);
      else {
        direct.current = false;
        Alert.alert('Not on your page', 'That review is no longer on your page.');
      }
    }
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  const open = rows?.find((r) => r.id === openId) ?? null;

  // opening one reads it: the NEW mark and the inbox dot both go, and the visit
  // count is worked out against that booking rather than today
  useEffect(() => {
    if (!open) return;
    setVisitN(null);
    supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', barberId).eq('kind', 'review').eq('booking_id', open.booking_id).is('read_at', null)
      .then(() => setFresh((cur) => {
        if (!cur.has(open.booking_id)) return cur;
        const next = new Set(cur);
        next.delete(open.booking_id);
        return next;
      }));
    if (open.booking) {
      const completed = !!open.booking.completed_at;
      supabase.from('bookings').select('id', { count: 'exact', head: true })
        .eq('barber_id', barberId).eq('customer_id', open.customer_id)
        .not('completed_at', 'is', null).lte('starts_at', open.booking.starts_at)
        .then(({ count }) => setVisitN(count == null ? null : count + (completed ? 0 : 1)));
    }
  }, [openId, barberId]);

  function closeDetail() {
    if (direct.current) { onBack(); return; }
    setOpenId(null);
  }

  // the parent owns leaving the screen; this level owns what is stacked inside it
  useAndroidBack(
    replying ? () => setReplying(null)
      : showing ? () => setShowing(null)
        : openId && !direct.current ? () => setOpenId(null)
          : null,
  );

  function report(r: Row) {
    Alert.alert('Report this review?',
      'Sterncut reads it against the review rules, and it stays on your page while they do. '
      + 'If it breaks them it comes down and you are told. If it does not, it stays up.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('review_flag', { p_review: r.id });
            if (error) { Alert.alert('Could not report it', error.message); return; }
            load();
          },
        },
      ]);
  }

  if (replying) {
    return (
      <PublicReplyScreen
        review={{
          id: replying.id, rating: replying.rating, comment: replying.comment,
          created_at: replying.created_at, customer: who(replying),
        }}
        onClose={() => setReplying(null)}
        onPosted={() => { setReplying(null); load(); }} />
    );
  }
  if (showing) {
    return (
      <ReviewRestoredScreen item={showing}
        onDone={() => { setShowing(null); load(); }}
        onReply={() => {
          const r = rows?.find((x) => x.id === showing.id) ?? null;
          setShowing(null);
          setReplying(r);
        }}
        onActionDone={load} />
    );
  }

  const restoredIds = new Set(restored.map((x) => x.id));
  const sum = rows ? reviewSummary(rows, restoredIds) : null;
  const avgText = sum?.average != null ? sum.average.toFixed(1) : null;
  const now = Date.now();

  // ---- BRV-09 · one review, opened --------------------------------------------
  if (open) {
    const dispute = disputeOf(open, restoredIds);
    const item = restored.find((x) => x.id === open.id) ?? null;
    return (
      <Screen gap={12}>
        <TopBar title="One review" onBack={closeDetail} />

        <View style={s.card}>
          <View style={s.row12}>
            <Face url={open.customer?.avatar_url ?? null} name={who(open)} />
            <View style={s.grow}>
              <T w="b" size={14}>{who(open)}</T>
              <T size={11} c={D.sub} style={s.mt2}>
                {visitN != null ? `${ordinal(visitN)} visit · ` : ''}reviewed {agoLabel(now - Date.parse(open.created_at))}
              </T>
            </View>
          </View>
          <T size={20} c={D.amber} ls={2}>
            {stars(open.rating)}<T size={20} c={D.muted} ls={2}>{stars(5 - open.rating)}</T>
          </T>
          <T size={14} style={s.lh22}>{open.comment || 'A rating with no words.'}</T>
        </View>

        <View style={s.facts}>
          {open.booking && <Fact label="The visit" value={visitWhen(open.booking.starts_at)} />}
          {open.booking && (
            <Fact label="The service"
              value={`${open.booking.services?.name ?? 'Service'} · ${Math.round(open.booking.price_cents / 100)} DH`} />
          )}
          <Fact last label={`Counts towards your ${avgText ?? 'rating'}`}
            value={open.state === 'held' ? 'Yes · while Sterncut reads it' : `Yes · since ${shortDay(open.created_at)}`}
            tint={open.state === 'held' ? D.amber : D.green} />
        </View>

        {!!open.reply && (
          <View style={s.replyCard}>
            <Eyebrow c={D.faint} ls={1.4}>YOUR PUBLIC REPLY</Eyebrow>
            <T size={12.5} c={D.textDim} style={s.lh19}>{open.reply}</T>
            {!!open.replied_at && <T size={10.5} c={D.faint}>{shortDay(open.replied_at)}</T>}
          </View>
        )}

        <View style={s.actions}>
          {!open.reply && (
            <Pressable onPress={() => setReplying(open)} accessibilityRole="button"
              style={({ pressed }) => [s.whiteBtn, pressed && s.pressed]}>
              <T w="eb" size={12.5} c="#111" ls={0.5}>REPLY IN PUBLIC</T>
            </Pressable>
          )}
          {dispute === null && (
            <Pressable onPress={() => report(open)} accessibilityRole="button"
              style={({ pressed }) => [s.outlineBtn, pressed && s.pressed]}>
              <T w="b" size={12.5} c={D.textDim}>Report it to Sterncut</T>
            </Pressable>
          )}
          {dispute === 'restored' && item && (
            <Pressable onPress={() => setShowing(item)} accessibilityRole="button"
              style={({ pressed }) => [s.outlineBtn, pressed && s.pressed]}>
              <T w="b" size={12.5} c={D.textDim}>See how the dispute went</T>
            </Pressable>
          )}
        </View>

        <View style={s.note}>
          <Ico name="info" size={14} color={D.sub} />
          <T size={11.5} c={D.sub} style={[s.grow, s.lh17]}>
            {dispute === 'with_sterncut'
              ? `With Sterncut since ${shortDay(open.flagged_at ?? open.created_at)}. It stays on your page and counts while they read it. If it comes down, you are told.`
              : dispute === 'kept'
                ? `Sterncut read it on ${shortDay(open.moderated_at!)} and left it up. It counts like any other review.`
                : dispute === 'restored'
                  ? 'It was taken down, appealed, and put back. It counts like any other review.'
                  : 'You cannot delete a review or hide one. Reporting sends it to Sterncut: if it breaks the review rules it comes down and you are told, and if not, it stays up.'}
          </T>
        </View>

        {!open.reply && (
          <T size={11} c={D.faint} style={s.foot}>
            One public reply per review. It shows under the review on your page.
          </T>
        )}
      </Screen>
    );
  }

  // ---- BRV-08 · all of them -----------------------------------------------------
  const shown = rows ? filterReviews(rows, filter, restoredIds) : [];
  return (
    <Screen gap={11}>
      <TopBar title="Your reviews" onBack={onBack} />

      {rows === null && <ActivityIndicator color={D.accent} accessibilityLabel="Loading your reviews" />}

      {sum && (
        <>
          <View style={s.summary}>
            <View style={s.summaryLeft}>
              <T style={s.big}>{avgText ?? '–'}</T>
              <T size={12} c={D.amber} ls={1}>
                {stars(Math.round(sum.average ?? 0))}
                <T size={12} c={D.muted} ls={1}>{stars(5 - Math.round(sum.average ?? 0))}</T>
              </T>
              <T size={10.5} c={D.sub} style={s.mt2}>{sum.count} review{sum.count === 1 ? '' : 's'}</T>
            </View>
            <View style={s.bars}>
              {sum.histogram.map((n, i) => {
                const star = 5 - i;
                const color = star >= 4 ? D.green : star === 3 ? D.amber : D.red;
                const pct = sum.count ? Math.round((n / sum.count) * 100) : 0;
                return (
                  <View key={star} style={s.barRow}>
                    <T w="b" size={10.5} c={D.sub} style={s.barStar}>{star}</T>
                    <View style={s.track}>
                      <View style={[s.fill, { width: `${pct}%`, backgroundColor: color }]} />
                    </View>
                    <T size={10.5} c={D.sub} style={s.barCount}>{n}</T>
                  </View>
                );
              })}
            </View>
          </View>

          {sum.count > 0 && (
            <T size={10.5} c={D.faint} style={s.rule}>
              The {avgText} is every review on your page. Only a review Sterncut takes down stops counting.
            </T>
          )}

          <View style={s.chips}>
            {([
              ['all', `All ${sum.count}`],
              ['unanswered', `Unanswered ${sum.unanswered}`],
              ['low', `3★ and under ${sum.low}`],
              ['disputed', `Disputed ${sum.disputed}`],
            ] as const).map(([k, label]) => {
              const on = filter === k;
              return (
                <Pressable key={k} onPress={() => setFilter(k)} accessibilityRole="button"
                  accessibilityState={{ selected: on }} style={[s.chip, on ? s.chipOn : s.chipOff]}>
                  <T w={on ? 'b' : 'sb'} size={11.5} c={on ? '#111' : D.sub}>{label}</T>
                </Pressable>
              );
            })}
          </View>

          {shown.length === 0 && (
            <T size={13} c={D.sub} style={s.empty}>
              {sum.count === 0
                ? 'No reviews yet. Every review a client leaves lands here, whether or not you reply.'
                : 'Nothing under this filter.'}
            </T>
          )}

          {shown.map((r) => {
            const dispute = disputeOf(r, restoredIds);
            const lost = dispute === 'kept' || dispute === 'restored';
            const isNew = fresh.has(r.booking_id) && !dispute;
            return (
              <Pressable key={r.id} onPress={() => setOpenId(r.id)} accessibilityRole="button"
                accessibilityLabel={`${who(r)}, ${r.rating} stars`}
                style={({ pressed }) => [lost ? s.rowLost : s.row, isNew && s.rowNew, pressed && s.pressed]}>
                <View style={s.rowHead}>
                  <T w="b" size={13} c={lost ? D.sub : D.text} style={s.grow}>{who(r)}</T>
                  {isNew ? <T w="b" size={10.5} c={D.accent} ls={0.8}>NEW</T>
                    : dispute === 'with_sterncut' ? <Pill label="WITH STERNCUT" color={D.amber} bg={D.amberSoft} />
                      : lost ? <Pill label="DISPUTE LOST" color={D.red} bg="rgba(248,113,113,0.14)" />
                        : r.reply ? <T w="sb" size={10.5} c={D.faint}>Replied</T> : null}
                </View>
                <View style={s.rowMeta}>
                  <T size={11.5} c={D.amber} ls={0.7}>{stars(r.rating)}</T>
                  <T size={11} c={D.sub} style={s.grow} numberOfLines={1}>
                    {agoLabel(now - Date.parse(r.created_at))} · {lost ? 'counted' : r.booking?.services?.name ?? 'Service'}
                  </T>
                </View>
                {lost ? (
                  <T size={12} c={D.sub} style={s.lh17}>
                    {dispute === 'restored'
                      ? 'Back on your page after the appeal — open it to see how it went'
                      : 'Sterncut read it and left it up'}
                  </T>
                ) : r.comment ? (
                  <T size={12.5} c={D.textDim} style={s.lh19} numberOfLines={3}>{r.comment}</T>
                ) : null}
              </Pressable>
            );
          })}
        </>
      )}
    </Screen>
  );
}

function Face({ url, name }: { url: string | null; name: string }) {
  if (url) return <Image source={{ uri: url }} style={s.face} />;
  return <Avatar size={42} initials={initials(name)} />;
}

function Pill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <T w="b" size={10} c={color} ls={0.8}>{label}</T>
    </View>
  );
}

function Fact({ label, value, tint, last }: { label: string; value: string; tint?: string; last?: boolean }) {
  return (
    <View style={[s.fact, !last && s.factLine]}>
      <T size={11.5} c={D.sub} style={s.grow}>{label}</T>
      <T w="sb" size={11.5} c={tint ?? D.textDim}>{value}</T>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  lh17: { lineHeight: 17 },
  lh19: { lineHeight: 19 },
  lh22: { lineHeight: 22 },
  pressed: { opacity: 0.75 },
  row12: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  face: { width: 42, height: 42, borderRadius: 999 },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: D.card,
    borderRadius: 20, paddingVertical: 15, paddingHorizontal: 16,
  },
  summaryLeft: { width: 86, alignItems: 'center', gap: 2 },
  big: { fontFamily: serif, fontSize: 38, lineHeight: 42, color: D.text, fontVariant: ['tabular-nums'] },
  bars: { flex: 1, gap: 5 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barStar: { width: 14 },
  track: { flex: 1, height: 6, borderRadius: 999, backgroundColor: D.border, overflow: 'hidden' },
  fill: { height: '100%' },
  barCount: { width: 26, textAlign: 'right', fontVariant: ['tabular-nums'] },
  rule: { lineHeight: 15, paddingHorizontal: 4 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: '#fff' },
  chipOff: { borderWidth: 1, borderColor: D.muted },
  empty: { paddingVertical: 20, lineHeight: 19 },

  row: { backgroundColor: D.card, borderRadius: 18, paddingVertical: 13, paddingHorizontal: 15, gap: 7 },
  rowLost: {
    backgroundColor: D.recessed, borderWidth: 1, borderColor: D.seam, borderRadius: 18,
    paddingVertical: 13, paddingHorizontal: 15, gap: 7,
  },
  rowNew: { borderLeftWidth: 3, borderLeftColor: D.accent },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { borderRadius: 7, paddingVertical: 4, paddingHorizontal: 8 },

  card: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 12 },
  facts: {
    backgroundColor: D.recessed, borderWidth: 1, borderColor: D.seam, borderRadius: 18,
    paddingHorizontal: 15, paddingVertical: 6,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  factLine: { borderBottomWidth: 1, borderBottomColor: D.seam },
  replyCard: { backgroundColor: D.card, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, gap: 7 },

  actions: { gap: 8, marginTop: 2 },
  whiteBtn: { height: 48, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  outlineBtn: {
    height: 44, borderRadius: 16, backgroundColor: D.card, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: D.recessed,
    borderWidth: 1, borderColor: D.seam, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  foot: { lineHeight: 16, paddingHorizontal: 4 },
});
