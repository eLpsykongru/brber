import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, PanResponder, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { Display, Empty, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { Press, Pushed } from '../components/motion';
import { Filter, SavedBarber, SavedRow, SavedSalon, splitSaved } from '../lib/saved';
import { shouldRemove } from '../lib/swipe';
import { supabase } from '../lib/supabase';
import { colors, inter, radius, sp, TOP_INSET } from '../theme';

// EXPL-24 … EXPL-27 — Saved, promoted from a page nobody could find twice to a
// tab that sorts on one question: can you sit in the chair today.
//
// 39c built the table, the RPC and this screen; 0107 added the three fields
// that let a row say it can't be booked instead of vanishing. What is NOT here
// is as deliberate as what is:
//
//   · no "next free Fri 14:00"     — `barber_next_free_today` scans today only
//   · no "3 slots left today"      — nothing counts that
//   · no "Saturdays only"          — nothing derives a weekday pattern
//   · no time on the BOOK button   — the picker needs a service chosen before a
//                                    time means anything, so "BOOK 11:00" would
//                                    land somewhere that cannot honour it
//   · no TELL ME IF IT REOPENS     — nothing sets `salons.status` back to
//                                    'live', so there is no event to send on
//
// "Nobody is told you saved them" is an RLS policy, not a reassuring sentence:
// only the saver can read the row, including the barber it names.

type Wishlist = { barbers: Omit<SavedBarber, 'kind'>[]; salons: Omit<SavedSalon, 'kind'>[]; gap_alerts: boolean };

const initials = (n: string) =>
  n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const col = (r: SavedRow): 'barber_id' | 'salon_id' => (r.kind === 'barber' ? 'barber_id' : 'salon_id');

export default function SavedScreen({ onBack, onOpenBarber, onOpenSalon }: {
  /** absent at a tab root — `ScreenHeader` draws its ghost spacer instead of a
   *  back button, so this needs no no-op stand-in */
  onBack?: () => void;
  onOpenBarber?: (id: string) => void;
  onOpenSalon?: (id: string) => void;
}) {
  const [w, setW] = useState<Wishlist | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [cantBook, setCantBook] = useState(false);
  // EXPL-27's undo. The row is held here rather than re-fetched, so UNDO costs
  // one insert and no round trip to find out what to restore.
  const [undo, setUndo] = useState<SavedRow | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    supabase.rpc('my_wishlist').then(({ data, error }) => {
      if (error) { Alert.alert('Could not load', error.message); return; }
      setW(data as Wishlist);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  async function unsave(row: SavedRow) {
    setW((cur) => cur && (row.kind === 'barber'
      ? { ...cur, barbers: cur.barbers.filter((b) => b.id !== row.id) }
      : { ...cur, salons: cur.salons.filter((x) => x.id !== row.id) }));
    setUndo(row);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
    const { error } = await supabase.from('wishlists').delete().eq(col(row), row.id);
    if (error) { Alert.alert('Could not remove', error.message); setUndo(null); load(); }
  }

  // No soft-delete column: `wishlists` orders by name and nothing user-visible
  // reads `created_at`, so a re-insert is a faithful undo and one less column
  // that has to mean something forever.
  async function undoRemove() {
    const row = undo;
    if (!row) return;
    setUndo(null);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from('wishlists')
      .insert({ customer_id: u.user.id, [col(row)]: row.id });
    if (error) Alert.alert('Could not put it back', error.message);
    load();
  }

  async function setAlerts(on: boolean) {
    setW((cur) => cur && { ...cur, gap_alerts: on });
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from('notification_prefs')
      .upsert({ user_id: u.user.id, push_saved_gap: on }, { onConflict: 'user_id' });
    if (error) { Alert.alert('Could not save', error.message); load(); }
  }

  // the header comes too, or there is no way out while the list is loading
  if (!w) {
    return (
      <View style={s.screen}>
        <Head onBack={onBack} kept={0} free={0} />
        <ActivityIndicator style={s.spin} />
      </View>
    );
  }

  const rows: SavedRow[] = [
    ...w.barbers.map((b) => ({ ...b, kind: 'barber' as const })),
    ...w.salons.map((x) => ({ ...x, kind: 'salon' as const })),
  ];
  const { free, later, blocked, counts } = splitSaved(rows, filter);
  const nothing = counts.all === 0;

  function open(r: SavedRow) {
    (r.kind === 'barber' ? onOpenBarber : onOpenSalon)?.(r.id);
  }

  const list = (
    <View style={s.screen}>
      <Head onBack={onBack} kept={counts.all} free={counts.free} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {!nothing && (
          <View style={s.chipRow}>
            {([['all', `All ${counts.all}`], ['barber', `Barbers ${counts.barbers}`],
              ['salon', `Salons ${counts.salons}`]] as [Filter, string][]).map(([k, label]) => (
              <Press key={k} onPress={() => setFilter(k)}
                accessibilityRole="tab" accessibilityState={{ selected: filter === k }}
                style={filter === k ? s.chipOn : s.chip}>
                <Text style={filter === k ? s.chipTextOn : s.chipText}>{label}</Text>
              </Press>
            ))}
          </View>
        )}

        {!nothing && (
          <View style={s.alertCard}>
            <View style={s.alertChip}>
              <Ionicons name="time-outline" size={16} color="#FFFFFF" />
            </View>
            <View style={s.grow}>
              <Text style={s.alertTitle}>Tell me when a saved barber has a gap</Text>
              {/* the frequency line is gone until something sends this: see the
                  header note. The switch stays, so the preference survives. */}
              <Text style={s.alertSub}>Same-day cancellations only</Text>
            </View>
            <Switch value={w.gap_alerts} onValueChange={setAlerts}
              accessibilityLabel="Notify me about gaps at saved barbers"
              trackColor={{ true: colors.accent, false: '#3A3A40' }} thumbColor="#FFFFFF" />
          </View>
        )}

        {nothing && (
          <Empty icon="heart-outline" title="Nothing saved yet"
            text="Tap the heart on a barber or a shop and they'll wait for you here." />
        )}

        {free.length > 0 && <Text style={s.section}>FREE TODAY</Text>}
        {free.map((r) => (
          <SwipeRow key={r.id} onRemove={() => unsave(r)}>
            <SavedCard row={r} onOpen={() => open(r)} onRemove={() => unsave(r)} />
          </SwipeRow>
        ))}

        {later.length > 0 && <Text style={s.section}>LATER THIS WEEK</Text>}
        {later.map((r) => (
          <SwipeRow key={r.id} onRemove={() => unsave(r)}>
            <SavedCard row={r} onOpen={() => open(r)} onRemove={() => unsave(r)} />
          </SwipeRow>
        ))}

        {/* they stay on the list; this is the way to the reasons, not a filter
            that hides them */}
        {blocked.length > 0 && (
          <Press onPress={() => setCantBook(true)} style={s.blockedStrip}
            accessibilityLabel={`${blocked.length} saved names can't be booked right now`}>
            <View style={s.blockedIcon}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
            </View>
            <Text style={s.blockedText}>
              {blocked.length} saved {blocked.length === 1 ? 'name' : 'names'} can't be booked right now
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
          </Press>
        )}

        {!nothing && <Text style={s.foot}>Nobody is told you saved them.</Text>}
        {!nothing && <Text style={s.foot}>Taking someone off doesn't cancel anything you booked with them.</Text>}
      </ScrollView>

      {undo && (
        <View style={s.toast}>
          <Text style={s.toastText} numberOfLines={1}>{undo.name} taken off Saved</Text>
          <Press onPress={undoRemove} hitSlop={8} accessibilityLabel={`Put ${undo.name} back`}>
            <Text style={s.toastUndo}>UNDO</Text>
          </Press>
        </View>
      )}
    </View>
  );

  if (cantBook) {
    return (
      <Pushed onBack={() => setCantBook(false)} behind={list}>
        {/* `blocked`, not every unbookable row: with a chip active the strip
            counts what the chip shows, and the two must agree */}
        <CantBookScreen rows={blocked} total={counts.all}
          onBack={() => setCantBook(false)}
          onRemove={(r) => { unsave(r); setCantBook(false); }} />
      </Pushed>
    );
  }
  return list;
}

function Head({ onBack, kept, free }: { onBack?: () => void; kept: number; free: number }) {
  // at a tab root there is no back button, so the eyebrow count carries the
  // header on its own rather than sitting under a centred title
  if (onBack) return <ScreenHeader title="Saved" onBack={onBack} />;
  return (
    <View style={s.head}>
      <Display size={26}>Saved</Display>
      <Text style={s.headSub}>{kept} kept · {free} free today</Text>
    </View>
  );
}

// ---- one row, either kind -------------------------------------------------
function SavedCard({ row, onOpen, onRemove }: {
  row: SavedRow; onOpen: () => void; onRemove: () => void;
}) {
  const free = row.kind === 'barber' && row.free_today != null;
  return (
    <Press onPress={onOpen} accessibilityLabel={row.name} style={s.row}>
      {row.kind === 'barber'
        ? <View style={s.avatar}><Text style={s.avatarText}>{initials(row.name)}</Text></View>
        : (
          <View style={s.shopTile}>
            <Ionicons name="cut-outline" size={19} color={colors.textTertiary} />
          </View>
        )}
      <View style={s.grow}>
        <Text style={s.name}>{row.name}</Text>
        <Text style={s.meta}>
          {row.kind === 'barber'
            ? `${row.salon}${row.rating ? ` · ${row.rating} ★` : ''}`
            : `${row.district}${row.from_cents != null ? ` · from ${Math.round(row.from_cents / 100)} DH` : ''}`}
        </Text>
        {/* today's first free time, or nothing — see the header note */}
        {free && <Text style={s.free}>Free {hhmm(row.free_today!)} today</Text>}
        {row.kind === 'salon' && !row.open && <Text style={s.shut}>Closed right now</Text>}
      </View>
      {free && (
        <Press onPress={onOpen} style={s.bookBtn} accessibilityLabel={`Book ${row.name}`}>
          <Text style={s.bookText}>BOOK</Text>
        </Press>
      )}
      <Press onPress={onRemove} hitSlop={8} scale={0.86}
        accessibilityLabel={`Remove ${row.name} from saved`} style={s.heart}>
        <Ionicons name="heart" size={16} color={colors.accent} />
      </Press>
    </Press>
  );
}

// ---- EXPL-27's swipe ------------------------------------------------------
// Its own component because the animated value and the responder cannot be
// created inside a `.map`. Core Animated + PanResponder for the same reason
// motion.tsx uses them: reanimated is a native module and a fresh build.
function SwipeRow({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(0);
  const fire = useRef(onRemove);
  fire.current = onRemove;

  const pan = useRef(PanResponder.create({
    // leftward, and clearly more sideways than down, or every list scroll
    // fights it
    onMoveShouldSetPanResponder: (_e, g) => g.dx < -8 && Math.abs(g.dy) < 12,
    onPanResponderMove: (_e, g) => x.setValue(Math.min(0, g.dx)),
    onPanResponderRelease: (_e, g) => {
      if (shouldRemove(g.dx, g.vx, width.current || 340)) {
        Animated.timing(x, { toValue: -(width.current || 340), duration: 160, useNativeDriver: true })
          .start(() => { fire.current(); x.setValue(0); });
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 260 }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(x, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 260 }).start();
    },
  })).current;

  return (
    <View style={s.swipeWrap} onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}>
      <View style={s.swipeBack} pointerEvents="none">
        <Ionicons name="trash-outline" size={17} color={colors.onAccent} />
        <Text style={s.swipeBackText}>REMOVE</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

// ---- EXPL-26 --------------------------------------------------------------
function CantBookScreen({ rows, total, onBack, onRemove }: {
  rows: SavedRow[]; total: number; onBack: () => void; onRemove: (r: SavedRow) => void;
}) {
  return (
    <View style={s.screen}>
      <ScreenHeader title="Can't book" onBack={onBack} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.headSub}>{rows.length} of your {total} saved</Text>
        {rows.map((r) => (
          <View key={r.id} style={s.blockedCard}>
            <View style={s.blockedHead}>
              {r.kind === 'barber'
                ? <View style={[s.avatar, s.avatarMuted]}><Text style={s.avatarTextMuted}>{initials(r.name)}</Text></View>
                : (
                  <View style={s.shopTile}>
                    <Ionicons name="cut-outline" size={19} color={colors.textTertiary} />
                  </View>
                )}
              <View style={s.grow}>
                <Text style={s.name}>{r.name}</Text>
                <Text style={s.meta}>{r.reason}</Text>
              </View>
              {r.kind === 'salon' && (
                <View style={s.offPill}>
                  <View style={s.offDot} />
                  <Text style={s.offText}>OFF</Text>
                </View>
              )}
            </View>
            {/* only printed when there is one — a sentence about somebody's
                money is not a thing to guess at */}
            {r.has_booking && (
              <Text style={s.blockedBody}>
                {r.kind === 'salon'
                  ? "Sterncut is working with this shop. You can't book it until that's done — your booking still stands."
                  : 'You already have a booking with him. That still stands.'}
              </Text>
            )}
            <Press onPress={() => onRemove(r)} style={s.removeBtn}
              accessibilityLabel={`Remove ${r.name} from saved`}>
              <Text style={s.removeText}>REMOVE</Text>
            </Press>
          </View>
        ))}
        <View style={s.note}>
          <Ionicons name="information-circle-outline" size={15} color={colors.textSecondary} />
          <Text style={s.noteText}>
            We never unsave anyone for you. They stay on this list, greyed, until you take them off.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  // the header is pinned, so the status-bar inset belongs on the root
  screen: { flex: 1, paddingTop: TOP_INSET, paddingHorizontal: 20, backgroundColor: colors.surface },
  content: { gap: 10, paddingTop: 2, paddingBottom: TAB_BAR_INSET },
  spin: { marginTop: sp(20) },
  grow: { flex: 1 },

  head: { paddingBottom: sp(3) },
  headSub: { fontFamily: inter.r, fontSize: 12, color: colors.textSecondary, marginTop: 5 },

  chipRow: { flexDirection: 'row', gap: 7 },
  chip: {
    height: 34, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border,
    justifyContent: 'center', paddingHorizontal: 15,
  },
  chipOn: {
    height: 34, borderRadius: radius.pill, backgroundColor: colors.ink,
    justifyContent: 'center', paddingHorizontal: 15,
  },
  chipText: { fontFamily: inter.sb, fontSize: 12, color: colors.textSecondary },
  chipTextOn: { fontFamily: inter.b, fontSize: 12, color: colors.onAccent },

  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: colors.ink, borderRadius: 20, padding: 15, paddingHorizontal: 16,
  },
  alertChip: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  alertTitle: { fontFamily: inter.b, fontSize: 12.5, color: '#FFFFFF' },
  alertSub: { fontFamily: inter.r, fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 },

  section: {
    fontFamily: inter.b, fontSize: 11, letterSpacing: 1.65,
    color: colors.textSecondary, marginTop: 6,
  },

  swipeWrap: { borderRadius: 20, overflow: 'hidden' },
  swipeBack: {
    ...StyleSheet.absoluteFillObject, backgroundColor: colors.accent,
    alignItems: 'flex-end', justifyContent: 'center', paddingRight: 20,
  },
  swipeBackText: {
    fontFamily: inter.b, fontSize: 9.5, letterSpacing: 0.95, color: colors.onAccent, marginTop: 4,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.bg, borderRadius: 20, padding: 12, paddingHorizontal: 14,
  },
  avatar: {
    width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarMuted: { backgroundColor: colors.surface },
  avatarText: { fontFamily: inter.b, fontSize: 13, color: colors.accent },
  avatarTextMuted: { fontFamily: inter.b, fontSize: 13, color: colors.textSecondary },
  shopTile: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: '#E9E6DE',
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontFamily: inter.b, fontSize: 14, color: colors.text },
  meta: { fontFamily: inter.r, fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  free: { fontFamily: inter.sb, fontSize: 11.5, color: '#16A34A', marginTop: 2 },
  shut: { fontFamily: inter.sb, fontSize: 11.5, color: colors.danger, marginTop: 2 },
  bookBtn: {
    height: 36, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15,
  },
  bookText: { fontFamily: inter.b, fontSize: 11.5, letterSpacing: 0.58, color: colors.onAccent },
  heart: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  blockedStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: 'rgba(0,0,0,0.045)', borderRadius: 20, padding: 13, paddingHorizontal: 14,
  },
  blockedIcon: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  blockedText: { flex: 1, fontFamily: inter.r, fontSize: 12, lineHeight: 17, color: '#5c5c58' },

  blockedCard: {
    backgroundColor: colors.bg, borderRadius: 20, padding: 14, paddingHorizontal: 15, gap: 12,
  },
  blockedHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  blockedBody: {
    fontFamily: inter.r, fontSize: 12, lineHeight: 18, color: '#5c5c58',
    borderTopWidth: 1, borderTopColor: '#EFECE4', paddingTop: 12,
  },
  offPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(248,113,113,0.14)', borderRadius: radius.pill,
    paddingVertical: 5, paddingHorizontal: 10,
  },
  offDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.accent },
  offText: { fontFamily: inter.b, fontSize: 10, letterSpacing: 0.8, color: colors.accent },
  removeBtn: {
    height: 42, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  removeText: { fontFamily: inter.b, fontSize: 11.5, letterSpacing: 0.46, color: '#5c5c58' },

  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    backgroundColor: 'rgba(0,0,0,0.045)', borderRadius: 18, padding: 13, paddingHorizontal: 14,
  },
  noteText: { flex: 1, fontFamily: inter.r, fontSize: 11.5, lineHeight: 17, color: '#5c5c58' },

  toast: {
    position: 'absolute', left: 16, right: 16, bottom: TAB_BAR_INSET - 20,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.ink, borderRadius: 18, padding: 14, paddingHorizontal: 16,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
  toastText: { flex: 1, fontFamily: inter.r, fontSize: 12.5, color: '#FFFFFF' },
  toastUndo: { fontFamily: inter.b, fontSize: 12, letterSpacing: 0.96, color: colors.accent },

  foot: {
    fontFamily: inter.r, fontSize: 11.5, lineHeight: 17,
    color: colors.textTertiary, marginTop: 2,
  },
});
