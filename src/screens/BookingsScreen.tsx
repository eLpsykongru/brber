import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import {
  Eyebrow, Ico, Screen, Serif, T, TAB_INSET,
} from '../components/dark';
import BookingPanelSheet, { BookingRequestSheet, PanelBooking, RowSheet } from '../components/BookingPanels';
import CancelBookingSheet from '../components/CancelBookingSheet';
import ClientSheet, { ClientRef } from '../components/ClientSheet';
import { FrontSheet } from '../components/LineSheets';
import RateClientSheet from '../components/RateClientSheet';
import SettleBundleSheet from '../components/SettleBundleSheet';
import SlotPicker from '../components/SlotPicker';
import { Pushed } from '../components/motion';
import { PillButton } from '../components/ui';
import {
  chairList, collectCents, dayMoney, isLinePlace, nextToCall, rungOf, smsSends, undoableDone, verbOf, waitingOf,
} from '../lib/line';
import { checkIn } from '../lib/lineCalls';
import { Block, daySlots, Window } from '../lib/slots';
import { useAndroidBack } from '../lib/back';
import { supabase } from '../lib/supabase';
import { colors, dark as D, inter, sp } from '../theme';
import type { Barber, Profile } from '../types';

/** 10d/10e read the same fact at two distances from the deadline (0054). */
type Standing = {
  hidden: boolean; expired: boolean;
  licence_expires_at: string | null; days_left: number | null;
};
import { LicenceBanner } from '../components/Trouble';
import { ShopClosedBanner, ShopClosedTiles, ShopStatus } from '../components/ShopPause';
import BarberQueueScreen from './BarberQueueScreen';
import ChatScreen from './ChatScreen';
import { HiddenScreen } from './OutboxScreen';
import EarningsScreen from './EarningsScreen';
import NotificationsScreen from './NotificationsScreen';
import BarberReviewsScreen from './BarberReviewsScreen';
import HeldBackScreen, { Held, loadHeld } from './HeldBackScreen';
import RescheduleAskScreen from './RescheduleAskScreen';
import OfferDayScreen, { OfferFor } from './OfferDayScreen';
import { countWord } from '../lib/inboxRules';
import { loc, tr } from '../lib/i18n';

// ADDENDUM-app-first, turn B11: Home is THE CHAIR (BTD-20). NEXT UP and the live queue
// were the same list shown twice with two sets of verbs; now bookings and walk-ins are
// one list in the order each man reaches the chair, each row carries one button read
// off where it sits (line.ts), and done — the one rung that moves money — can be taken
// back until the next man sits down (BTD-22, 0121). No clock: the rows decide.

type BookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  created_at: string;          // BTD-21 — when the booking, or the place, was made
  status: string;
  price_cents: number;
  deposit_cents: number;   // BTD-03 — what is already held, so "collect" is the rest
  walk_in_name: string | null;
  walk_in_phone: string | null;   // BTD-02 (0118)
  customer_id: string;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  dropped_at: string | null;   // BTD-15 (0119)
  joined_line: boolean;        // held his own place in the app (0119)
  notes: string | null;   // 39d
  services: { name: string; duration_min: number | null } | null;
  customer: { full_name: string | null; avatar_url: string | null; phone: string | null } | null;
};

/** 0114/0118 — a place taken on the web page, behind a walk-in row */
type Guest = {
  booking_id: string; first_name: string; phone: string; source: 'code' | 'link';
  joined_at: string; confirmed: boolean;
};

// the line moves while he works; the queue board polls the same way
const POLL_MS = 20_000;

const dh = (cents: number) => `${Math.round(cents / 100)} DH`;
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const pad = (n: number) => String(n).padStart(2, '0');
const minsSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const minsTo = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
const minLabel = (min: number) => new Date(0, 0, 0, 0, min).toTimeString().slice(0, 5);
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// BNT-05 is handed over once per cut; this remembers which cut it was
const HELD_SEEN_KEY = 'held_seen_cut';

const nameOf = (b: BookingRow, barberId: string) =>
  b.walk_in_name ?? (b.customer_id === barberId ? tr('Walk-in') : b.customer?.full_name ?? tr('Client'));
const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

type Tone = 'green' | 'coral' | 'amber' | 'plain';
const TONE_BG: Record<Tone, string> = { green: D.greenSoft, coral: D.accentSoft, amber: D.amberSoft12, plain: D.card2 };
const TONE_FG: Record<Tone, string> = { green: D.green, coral: D.accent, amber: D.amber, plain: D.sub };

/** A client's photo or initials; a walk-in, who has neither, wears his Nº */
function Badge({ b, barberId, no, tone, size = 40 }: {
  b: BookingRow; barberId: string; no: number; tone: Tone; size?: number;
}) {
  const walkIn = b.customer_id === barberId;
  const url = walkIn ? null : b.customer?.avatar_url;
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 999 }} />;
  return (
    <View style={[s.badge, { width: size, height: size, backgroundColor: TONE_BG[tone] }]}>
      <T w="b" size={12} c={TONE_FG[tone]}>{walkIn ? (no ? pad(no) : '—') : initialsOf(nameOf(b, barberId))}</T>
    </View>
  );
}

export default function BookingsScreen({ barber, profile, phone, onProfileChanged, onChromeHidden, goSchedule, onOpenGap }: {
  barber: Barber;
  profile: Profile;
  phone: string | null;
  onProfileChanged: () => void;
  onChromeHidden?: (hidden: boolean) => void;
  goSchedule: () => void;
  /** BDY-06 — a cancellation opens the day it left a hole in; HomeScreen owns the day */
  onOpenGap: (bookingId: string) => void;
}) {
  const barberId = barber.id;
  const [bookings, setBookings] = useState<BookingRow[] | null>(null); // null = first load in flight
  const [windows, setWindows] = useState<Window[]>([]);
  const [daysOff, setDaysOff] = useState<{ id: string; day: string }[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [salonName, setSalonName] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  // where the routing audit's gaps land: a reschedule ask (BDY-14), one review
  // (BRV-09), and what silent-while-cutting held back (BNT-05)
  const [askFor, setAskFor] = useState<string | null>(null);
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [heldSeen, setHeldSeen] = useState<string | null>(null);
  // turn 10 — standing is a fact about the shop, so it loads with the day
  const [standing, setStanding] = useState<Standing | null>(null);
  const [shop, setShop] = useState<ShopStatus | null>(null);   // 11b
  const [hidden, setHidden] = useState(false);
  const [unread, setUnread] = useState(0);
  const [chat, setChat] = useState<{ id: string; title: string } | null>(null);
  const [sheetClient, setSheetClient] = useState<ClientRef | null>(null);
  const [resched, setResched] = useState<BookingRow | null>(null);
  const [reschedAt, setReschedAt] = useState<Date | null>(null);
  const [completedB, setCompletedB] = useState<BookingRow | null>(null);
  const [settleB, setSettleB] = useState<BookingRow | null>(null);
  // BTD-21's Service tile opens the same checklist, and it always shows the list
  const [settleAsk, setSettleAsk] = useState(false);
  const [cancelling, setCancelling] = useState<BookingRow | null>(null);
  const [showEarnings, setShowEarnings] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [panel, setPanel] = useState<BookingRow | null>(null);      // BTD-21
  const [request, setRequest] = useState<BookingRow | null>(null);  // 3d
  // BTD-20 — the line's switch rides on the money card; a web name carries whether he tapped
  const [lineOpen, setLineOpen] = useState(true);
  const [guests, setGuests] = useState<Record<string, Guest>>({});
  const [frontAsk, setFrontAsk] = useState<string | null>(null);   // BTD-17
  const [offerFor, setOfferFor] = useState<OfferFor | null>(null); // BTD-16

  useEffect(() => {
    if (!barber.salon_id) return;
    supabase.from('salons').select('name').eq('id', barber.salon_id).single()
      .then(({ data }) => setSalonName(data?.name ?? null));
  }, [barber.salon_id]);

  // the line: today through +14 days (requests), whether it is open, who never tapped
  const loadLine = useCallback(async (quiet = false) => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 14);
    const [book, me, guestRows] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, ends_at, created_at, status, price_cents, deposit_cents, walk_in_name, walk_in_phone, customer_id, checked_in_at, started_at, completed_at, dropped_at, joined_line, notes, services(name, duration_min), customer:profiles!customer_id(full_name, avatar_url, phone)')
        .eq('barber_id', barberId)
        .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
        .in('status', ['pending', 'confirmed'])
        .order('starts_at'),
      supabase.from('barbers').select('accepting_bookings').eq('id', barberId).single(),
      supabase.rpc('barber_guests_today'),
    ]);
    if (book.error) { if (!quiet) Alert.alert(tr('Could not load bookings'), book.error.message); }
    else setBookings(book.data as unknown as BookingRow[]);
    if (me.data) setLineOpen(me.data.accepting_bookings);
    const byBooking: Record<string, Guest> = {};
    for (const g of (guestRows.data ?? []) as Guest[]) byBooking[g.booking_id] = g;
    setGuests(byBooking);
  }, [barberId]);

  const load = useCallback(async () => {
    await loadLine();
    const [av, off, blk] = await Promise.all([
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
      supabase.from('days_off').select('id, day').eq('barber_id', barberId)
        .gte('day', isoDay(new Date())),
      supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', barberId),
    ]);
    setWindows(av.data ?? []);
    setDaysOff(off.data ?? []);
    setBlocks(blk.data ?? []);
    const { count } = await supabase.from('notifications')
      .select('id', { count: 'exact', head: true })
      // user_id: 0037 renamed the column, and barber_id made this count fail silently
      .eq('user_id', barberId).is('read_at', null);
    setUnread(count ?? 0);
    setHeld(await loadHeld(barberId));
  }, [barberId, loadLine]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const poll = setInterval(() => loadLine(true), POLL_MS);
    return () => clearInterval(poll);
  }, [loadLine]);
  useEffect(() => {
    AsyncStorage.getItem(HELD_SEEN_KEY).then(setHeldSeen).catch(() => {});
  }, []);
  // a reload can find nothing left to hand over (a new cut, a new day) while BNT-05
  // is open; without this the dashboard came back with the tab bar still hidden
  useEffect(() => {
    if (heldOpen && !held) { setHeldOpen(false); onChromeHidden?.(false); }
  }, [heldOpen, held]);
  // separate from load(): the day reloads constantly, standing changes weekly
  useEffect(() => {
    supabase.rpc('my_standing').then(({ data }) => { if (data) setStanding(data as Standing); });
  }, [barberId]);
  // 11b — owner-only in practice: my_shop_status() answers { salon: null } for a
  // co-barber, and every piece of the banner no-ops on that.
  const loadShop = useCallback(() => {
    supabase.rpc('my_shop_status').then(({ data }) => setShop((data as ShopStatus) ?? null));
  }, []);
  useEffect(() => { loadShop(); }, [loadShop, barberId]);

  async function accept(b: BookingRow) {
    const { error } = await supabase.rpc('accept_booking', { p_booking: b.id });
    if (error) Alert.alert(tr('Could not accept'), error.message);
    load();
  }

  function decline(b: BookingRow) {
    Alert.alert(tr('Decline this request?'), `${nameOf(b, barberId)} · ${hhmm(b.starts_at)}`, [
      { text: tr('Keep'), style: 'cancel' },
      {
        text: tr('Decline'), style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('cancel_booking', { p_booking: b.id });
          if (error) Alert.alert(tr('Could not decline'), error.message);
          load();
        },
      },
    ]);
  }

  function openChat(req: { id: string; title: string } | null) {
    setSheetClient(null);
    setChat(req);
    onChromeHidden?.(!!req);
  }

  const panelOf = (b: BookingRow): PanelBooking => ({
    id: b.id, customerId: b.customer_id, name: nameOf(b, barberId),
    initials: initialsOf(nameOf(b, barberId)),
    service: b.services?.name ?? tr('Service'),
    durationMin: Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000),
    whenLabel: new Date(b.starts_at).toLocaleDateString(loc('en-US'), { weekday: 'short', month: 'short', day: 'numeric' }),
    timeLabel: hhmm(b.starts_at),
    priceCents: b.price_cents,
    depositCents: b.deposit_cents ?? 0,
    checkedInAt: b.checked_in_at, startedAt: b.started_at,
    phone: b.customer_id === barberId ? phoneOf(b) : b.customer?.phone ?? null,
    isWalkIn: b.customer_id === barberId,
    notes: b.notes,
  });

  const clientRefOf = (b: BookingRow): ClientRef => ({
    name: nameOf(b, barberId),
    avatarUrl: b.customer_id === barberId ? null : b.customer?.avatar_url ?? null,
    phone: b.customer_id === barberId ? null : b.customer?.phone ?? null,
    customerId: b.customer_id,
    walkInName: b.walk_in_name,
  });

  function openHeld() {
    if (!held) return;
    setHeldSeen(held.cut.id);
    AsyncStorage.setItem(HELD_SEEN_KEY, held.cut.id).catch(() => {});
    setHeldOpen(true);
    onChromeHidden?.(true);
  }

  function openEarnings(v: boolean) {
    setShowEarnings(v);
    onChromeHidden?.(v);
  }

  // ---- B11 · one verb per rung ------------------------------------------------------
  const unconfirmed = (b: BookingRow) => !!guests[b.id] && !guests[b.id].confirmed;
  /** a web guest's number, or the one the barber typed (BTD-02) */
  const phoneOf = (b: BookingRow) => guests[b.id]?.phone ?? b.walk_in_phone ?? null;

  /** CALL HIM and HE'S HERE are one check-in. A web name that never tapped is asked about first (BTD-17). */
  async function callIn(b: BookingRow, anyway = false) {
    if (!anyway && unconfirmed(b)) return setFrontAsk(b.id);
    // only a man called up from somewhere else is told; a walk-in is standing there
    const error = await checkIn(b.id, isLinePlace(b, barberId) && b.customer_id !== barberId);
    if (error) Alert.alert(tr('Could not call'), error);
    loadLine();
  }

  async function seat(b: BookingRow) {
    const { error } = await supabase.rpc('advance_booking', { p_booking: b.id, p_stage: 'start' });
    if (error) Alert.alert(tr('Could not seat him'), error.message);
    loadLine();
  }

  function primary(b: BookingRow) {
    switch (verbOf(b, barberId)) {
      case 'CALL HIM': case "HE'S HERE": return callIn(b);
      case 'SEAT HIM': return seat(b);
      // 34f — done settles first: what was actually done decides the price, and a
      // half-taken bundle loses its saving. The sheet runs advance_booking itself, and
      // closes straight through when there is only one service.
      case 'DONE': return setSettleB(b);
    }
  }

  // BTD-15 "Take him off", BTD-17 "Drop him" — the no-show 0119's queue_take_off writes
  async function dropNow(b: BookingRow) {
    const { error } = await supabase.rpc('queue_take_off', { p_booking: b.id });
    if (error) Alert.alert(tr('Could not take him off'), error.message);
    loadLine();
  }

  function takeOff(b: BookingRow) {
    const walkIn = b.customer_id === barberId;
    Alert.alert(tr('Take {b} off the line?', { b: nameOf(b, barberId) }),
      walkIn ? tr('He leaves today\'s line. Nothing is recorded against a walk-in.') : tr('Marks him a no-show and frees the slot.'), [
        { text: tr('Keep'), style: 'cancel' },
        { text: walkIn ? tr('Take off') : tr('No-show'), style: 'destructive', onPress: () => dropNow(b) },
      ]);
  }

  // BTD-22 — status and money go back together (0121)
  async function undoDone(b: BookingRow) {
    const { error } = await supabase.rpc('revert_completion', { p_booking: b.id });
    if (error) Alert.alert(tr('Could not put him back'), error.message);
    load();
  }

  /** An account moves his own booking; a walk-in is offered a time by text, which needs his number and a way to send it (BTD-16). */
  function anotherDayOff(b: BookingRow): string | null {
    if (b.customer_id !== barberId) return null;
    if (!phoneOf(b)) return tr("Needs his number — you'll only have his name");
    if (!smsSends()) return tr('Waits until Sterncut can send texts');
    return null;
  }

  function anotherDay(b: BookingRow) {
    setPanel(null);
    if (b.customer_id !== barberId) { setResched(b); setReschedAt(null); return; }
    setOfferFor({
      bookingId: b.id, no: noOf(b), name: nameOf(b, barberId), service: b.services?.name ?? tr('Service'),
      durationMin: b.services?.duration_min
        ?? Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000),
      startsAt: b.starts_at, waitingSince: guests[b.id]?.joined_at ?? b.created_at,
    });
    onChromeHidden?.(true);
  }

  async function confirmReschedule() {
    if (!resched || !reschedAt) return;
    const { error } = await supabase.rpc('reschedule_booking', {
      p_booking: resched.id, p_new_start: reschedAt.toISOString(),
    });
    if (error) Alert.alert(tr('Could not reschedule'), error.message);
    setResched(null); setReschedAt(null);
    load();
  }

  const reviewMsg = (b: BookingRow) =>
    tr('Thanks for coming in! How was your {service}? You can rate it in the app: My Bookings → Rate ⭐', { service: b.services?.name ?? tr('cut') });

  async function askReviewInChat(b: BookingRow) {
    const { error } = await supabase.from('messages')
      .insert({ booking_id: b.id, sender_id: barberId, body: reviewMsg(b) });
    if (error) Alert.alert(tr('Could not send'), error.message);
    else Alert.alert(tr('Sent'), tr('Review ask sent in chat.'));
  }

  function askReviewBySms(b: BookingRow) {
    const to = b.customer?.phone;
    if (!to) return;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${to}${sep}body=${encodeURIComponent(reviewMsg(b))}`)
      .catch(() => Alert.alert(tr('SMS'), tr('Could not open the SMS app.')));
  }

  const todayOff = daysOff.find((d) => d.day === isoDay(new Date()));
  async function toggleClockOut() {
    if (todayOff) {
      await supabase.from('days_off').delete().eq('id', todayOff.id);
      return load();
    }
    Alert.alert(tr('Clock out?'), tr('The shop closes for the rest of today — new bookings for today are blocked. Existing ones stay.'), [
      { text: tr('Keep working'), style: 'cancel' },
      {
        text: tr('Clock out'), style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('days_off')
            .insert({ barber_id: barberId, day: isoDay(new Date()), label: tr('Clocked out') });
          if (error) Alert.alert(tr('Could not clock out'), error.message);
          load();
        },
      },
    ]);
  }

  async function loadStanding() {
    const { data } = await supabase.rpc('my_standing');
    if (data) setStanding(data as Standing);
  }

  // Android back, in the same order these early returns are checked. The
  // dashboard itself is a tab root, so at the bottom it falls through to
  // Android and backgrounds the app.
  useAndroidBack(
    offerFor ? () => { setOfferFor(null); onChromeHidden?.(false); }
    : chat ? () => openChat(null)
      : showEarnings ? () => openEarnings(false)
          : showQueue ? () => { setShowQueue(false); onChromeHidden?.(false); load(); }
            : inboxOpen ? () => { setInboxOpen(false); onChromeHidden?.(false); load(); }
              : askFor ? () => { setAskFor(null); onChromeHidden?.(false); load(); }
                : reviewFor ? () => { setReviewFor(null); onChromeHidden?.(false); }
                  : heldOpen ? () => { setHeldOpen(false); onChromeHidden?.(false); }
                // same condition as the render below, so back is never a
                // no-op on a screen that is showing a back button
                : (hidden || standing?.hidden) ? () => { setHidden(false); loadStanding(); }
                  : null,
  );

  // ---- derive the dashboard ----
  const now = Date.now();
  const todayKey = new Date().toDateString();
  const rows = bookings ?? [];
  const confirmed = rows.filter((b) => b.status === 'confirmed');
  // today's book: every confirmed row, and a request whose time is still ahead
  const todayRows = rows.filter((b) => new Date(b.starts_at).toDateString() === todayKey
    && (b.status === 'confirmed' || (b.status === 'pending' && new Date(b.starts_at).getTime() > now)));
  const book = todayRows.filter((b) => b.status === 'confirmed');   // loaded by start: Nº is the place in it
  // by id: a sheet opened before the last poll holds the row as it was then
  const noOf = (b: BookingRow) => book.findIndex((x) => x.id === b.id) + 1;

  // BTD-20 — one list per chair, and A10's two counting rules: waiting leaves out the man
  // in the chair and an unanswered request; the money is TAKEN, which climbs only at done.
  const list = chairList(todayRows);
  const waiting = waitingOf(todayRows);
  const { takenCents, bookedCents } = dayMoney(todayRows);
  const notConfirmed = waiting.filter(unconfirmed).length;
  const nextCall = nextToCall(book.filter((b) => !b.completed_at));
  const chairTaken = list.some((b) => rungOf(b) === 'in_chair');
  // BTD-22 — the chair's latest done, until somebody sits down after it (0121 asks the same)
  const doneRow = undoableDone(book);
  const done = doneRow ? { row: doneRow } : null;
  const whole = (cents: number) => String(Math.round(cents / 100));
  const frontRow = frontAsk ? rows.find((b) => b.id === frontAsk) ?? null : null;
  const panelRow = panel ? rows.find((b) => b.id === panel.id) ?? panel : null;

  const today = new Date();
  const dateLabel = today
    .toLocaleDateString(loc('en-GB'), { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();
  const firstName = (profile.full_name ?? tr('Barber')).split(' ')[0];
  const nextShift = windows.length
    ? (() => {
      for (let i = 1; i <= 7; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        const w = windows.find((x) => x.weekday === d.getDay());
        if (w && !daysOff.some((o) => o.day === isoDay(d))) {
          return `${d.toLocaleDateString(loc('en-US'), { weekday: 'short' })} ${minLabel(w.start_min)}`;
        }
      }
      return '—';
    })()
    : '—';

  // first genuinely free slot in the next week, minus the booking we're about to drop —
  // 1r offers it to the client in the same breath as the cancellation
  function nextFreeSlot(excludeId: string): string | null {
    const busy = confirmed.filter((b) => b.id !== excludeId);
    const off = daysOff.map((d) => d.day);
    for (let i = 0; i <= 7; i++) {
      const day = new Date(); day.setDate(day.getDate() + i);
      const free = daySlots(day, 30, windows, busy, off, blocks)
        .find((sl) => sl.status === 'free');
      if (free) {
        return `${free.time.toLocaleDateString(loc('en-US'), { weekday: 'short' })} ${free.time.toTimeString().slice(0, 5)}`;
      }
    }
    return null;
  }

  const sheetOf = (b: BookingRow): RowSheet => {
    const frees = nextToCall(book.filter((x) => !x.completed_at), b.id);
    return { row: b, no: noOf(b), frees: frees ? noOf(frees) : null, unconfirmed: unconfirmed(b), anotherDayOff: anotherDayOff(b) };
  };

  /** What a row says under the name: what is happening to it now, or where the place came from */
  function subOf(b: BookingRow): string {
    const service = b.services?.name ?? tr('Service');
    const g = guests[b.id];
    switch (rungOf(b)) {
      case 'request': return tr('{at} booking · asked to come in', { at: hhmm(b.starts_at) });
      case 'in_chair': return tr('{service} · {m} min in', { service, m: minsSince(b.started_at!) });
      case 'called':
        if (g && !g.confirmed) return tr("Called {at} anyway · hasn't tapped", { at: hhmm(b.checked_in_at!) });
        if (isLinePlace(b, barberId)) return tr('{service} · called {at}', { service, at: hhmm(b.checked_in_at!) });
        return (b.deposit_cents ?? 0) > 0
          ? tr('{at} booking · {paid} paid · {cash} in cash', { at: hhmm(b.starts_at), paid: dh(b.deposit_cents), cash: whole(collectCents(b)) })
          : tr('{at} booking · {cash} in cash', { at: hhmm(b.starts_at), cash: dh(collectCents(b)) });
      default:
        if (g && !g.confirmed) return tr("Texted {m} min ago · hasn't tapped", { m: minsSince(g.joined_at) });
        if (b.dropped_at) return tr("{service} · didn't come · at the end", { service });
        if (g) return g.source === 'link' ? tr('{service} · took your link', { service }) : tr('{service} · put his name in from the web', { service });
        if (b.customer_id === barberId) return tr('{service} · you wrote him down', { service });
        if (b.joined_line) return tr('{service} · held his own place in the app', { service });
        return tr('{at} booking · {service}', { at: hhmm(b.starts_at), service });
    }
  }

  // BTD-20 — one row of THE CHAIR. In the chair and called-up rows are cards with their
  // button full width; the rest are one line, and only the man CALL NEXT would call
  // carries his button. A request keeps its ✕/✓: it is a different decision, not a rung.
  function chairRow(b: BookingRow) {
    const rung = rungOf(b);
    const name = nameOf(b, barberId);
    const line = isLinePlace(b, barberId);
    const grey = unconfirmed(b);
    const open = () => (rung === 'request' ? setRequest(b) : setPanel(b));

    if (rung === 'in_chair' || rung === 'called') {
      const cutting = rung === 'in_chair';
      const label = cutting ? tr('DONE · COLLECT {cash}', { cash: dh(collectCents(b)) }) : tr('SEAT HIM');
      return (
        <View key={b.id} style={[s.bigRow, { borderColor: cutting ? D.green : D.accent }]}>
          <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={tr('{name}, open', { name })}
            style={({ pressed }) => [s.bigTop, pressed && s.pressed]}>
            <Badge b={b} barberId={barberId} no={noOf(b)} tone={cutting ? 'green' : 'coral'} />
            <View style={s.grow}>
              <T w="b" size={14}>{name}</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>{subOf(b)}</T>
            </View>
            <View style={[s.chip, { backgroundColor: cutting ? D.green : D.accentSoft }]}>
              <T w="b" size={10} c={cutting ? D.bg : D.accent} ls={0.8}>
                {cutting ? tr('IN CHAIR') : line ? tr('CALLED') : tr('HERE')}
              </T>
            </View>
          </Pressable>
          <Pressable onPress={() => primary(b)} accessibilityRole="button" accessibilityLabel={label}
            style={({ pressed }) => [s.bigBtn, { backgroundColor: cutting ? D.green : D.accent }, pressed && s.pressed]}>
            {cutting && <Ico name="check" size={15} color={D.bg} />}
            <T w="eb" size={12.5} c={cutting ? D.bg : '#fff'} ls={0.62}>{label}</T>
          </Pressable>
        </View>
      );
    }

    const isNext = nextCall?.id === b.id && !grey;
    return (
      <Pressable key={b.id} onPress={open} accessibilityRole="button" accessibilityLabel={`${name}, ${subOf(b)}`}
        style={({ pressed }) => [s.row, grey && s.unconfirmedRow, !!b.dropped_at && s.droppedRow, pressed && s.pressed]}>
        <Badge b={b} barberId={barberId} no={noOf(b)} tone={grey ? 'amber' : 'plain'} size={38} />
        <View style={s.grow}>
          <T w="b" size={13.5} c={grey || b.dropped_at ? D.sub : D.text}>{name}</T>
          <T size={11} c={grey ? D.amber : D.sub} style={{ marginTop: 2 }}>{subOf(b)}</T>
        </View>
        {rung === 'request' ? (
          <View style={s.pucks}>
            <Pressable onPress={() => decline(b)} hitSlop={6} accessibilityRole="button" accessibilityLabel={tr('Decline {name}', { name })}
              style={({ pressed }) => [s.puck34, pressed && s.pressed]}>
              <Ico name="x" size={14} color={D.red} />
            </Pressable>
            <Pressable onPress={() => accept(b)} hitSlop={6} accessibilityRole="button" accessibilityLabel={tr('Accept {name}', { name })}
              style={({ pressed }) => [s.puck34, { backgroundColor: D.green }, pressed && s.pressed]}>
              <Ico name="check" size={14} color={D.bg} />
            </Pressable>
          </View>
        ) : grey ? (
          <View style={[s.chip, { backgroundColor: D.amberSoft12 }]}>
            <T w="b" size={10} c={D.amber} ls={0.6}>{tr('UNCONFIRMED')}</T>
          </View>
        ) : isNext ? (
          <Pressable onPress={() => primary(b)} hitSlop={4} accessibilityRole="button"
            style={({ pressed }) => [s.callPill, pressed && s.pressed]}>
            <T w="b" size={11.5}>{verbOf(b, barberId) === 'CALL HIM' ? tr('Call him') : tr('He\'s here')}</T>
          </Pressable>
        ) : b.dropped_at ? null : (
          <T size={11} c={D.sub} style={s.tnum}>{line ? tr('~{starts_at} min', { starts_at: minsTo(b.starts_at) }) : hhmm(b.starts_at)}</T>
        )}
      </Pressable>
    );
  }

  const dash = (
    <View style={s.root}>
      <Screen gap={14} bottom={TAB_INSET}>
        {/* 1a header — eyebrow date over the Playfair greeting, bell with its unread dot */}
        <View style={s.headRow}>
          {/* the greeting used to open Profile. Nobody looks for their own
              account behind their own name, so Profile is a tab now and this
              is just the greeting. */}
          <View style={s.grow}>
            <Eyebrow ls={1.8}>{dateLabel}</Eyebrow>
            <Serif size={26} ls={0.03} style={s.greet}>{tr('Salam, {firstName}', { firstName })}</Serif>
          </View>
          <Pressable onPress={() => { setInboxOpen(true); onChromeHidden?.(true); }}
            accessibilityRole="button"
            accessibilityLabel={tr('Notifications, {unread} unread', { unread })}
            style={({ pressed }) => [s.bell, pressed && s.pressed]}>
            <Ico name="bell" size={16} />
            {unread > 0 && <View style={s.bellDot} />}
          </Pressable>
        </View>

        {/* 10d — nine days out this is something he notices between clients, so
            it is a banner over the day, not a screen in front of it. Once the
            date has gone it stops being a warning and becomes 10e. */}
        {standing && !standing.hidden && (
          <LicenceBanner standing={standing} onSend={() => setHidden(true)} />
        )}

        {/* 11b — the shop is shut and he is still standing in it. Above the
            clocked-out banner because closing the shop outranks clocking out. */}
        {shop && <ShopClosedBanner st={shop} onReopened={loadShop} />}

        {/* BNT-05 — the cut is done, and what the chair held back is handed over
            here once per cut, rather than all of it buzzing at mark-done */}
        {held && heldSeen !== held.cut.id && (
          <View style={s.clockedCard}>
            <View style={s.clockedIcon}><Ico name="scissors" size={16} color={D.amber} /></View>
            <View style={s.grow}>
              <T w="b" size={13} c={D.amber}>{tr('{count} waited for you to finish', { count: countWord(held.items.length) })}</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                {tr('Held {started_at}–{completed_at} while you were cutting', { started_at: hhmm(held.cut.started_at), completed_at: hhmm(held.cut.completed_at) })}
              </T>
            </View>
            <Pressable onPress={openHeld} accessibilityRole="button" accessibilityLabel={tr('See what was held back')}
              style={({ pressed }) => [s.undoBtn, pressed && s.pressed]}>
              <T w="eb" size={11} c={D.bg} ls={0.55}>{tr('SEE')}</T>
            </Pressable>
          </View>
        )}

        {/* 1s — the clocked-out banner replaces nothing, it sits above the number */}
        {todayOff && (
          <View style={s.clockedCard}>
            <View style={s.clockedIcon}><Ico name="slash" size={16} color={D.amber} /></View>
            <View style={s.grow}>
              <T w="b" size={13} c={D.amber}>{tr('Clocked out for today')}</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>{tr('New bookings for today are blocked')}</T>
            </View>
            <Pressable onPress={toggleClockOut} accessibilityRole="button" accessibilityLabel={tr('Clock back in')}
              style={({ pressed }) => [s.undoBtn, pressed && s.pressed]}>
              <T w="eb" size={11} c={D.bg} ls={0.55}>{tr('UNDO')}</T>
            </Pressable>
          </View>
        )}

        {/* BTD-20 — TAKEN, not booked: it climbs only when a man is done, and booked sits
            beside it. The line's switch rides on the right and opens it (BTD-14); the rest
            of the card opens Earnings. */}
        <View style={s.moneyCard}>
          <Pressable onPress={() => openEarnings(true)} accessibilityRole="button"
            accessibilityLabel={tr('Taken today {takenCents} of {bookedCents} booked, earnings details', { takenCents: dh(takenCents), bookedCents: dh(bookedCents) })}
            style={({ pressed }) => [s.moneyTap, pressed && s.pressed]}>
            <View>
              <T w="b" size={9.5} c={D.sub} ls={1.15}>{tr('TAKEN TODAY')}</T>
              <Serif size={25} ls={0} style={[s.money, todayOff && { color: D.muted }]}>{dh(takenCents)}</Serif>
            </View>
            <View style={s.moneyRule} />
            <View style={s.grow}>
              <T size={11.5} c={D.sub} style={{ lineHeight: 16.5 }}>
                {done
                  ? tr('Up {price_cents} from {row} · {count} waiting', { price_cents: dh(done.row.price_cents), row: nameOf(done.row, barberId).split(' ')[0], count: waiting.length })
                  : tr('{count} waiting · {takenCents} of {bookedCents} booked', { count: waiting.length, takenCents: whole(takenCents), bookedCents: dh(bookedCents) })}
              </T>
              {notConfirmed > 0 && (
                <T size={11} c={D.amber} style={{ marginTop: 2 }}>
                  {notConfirmed === 1 ? tr('1 name not confirmed') : tr('{notConfirmed} names not confirmed', { notConfirmed })}
                </T>
              )}
            </View>
          </Pressable>
          <Pressable onPress={() => { setShowQueue(true); onChromeHidden?.(true); }} hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={(lineOpen ? tr('The line is open, open the live queue') : tr('The line is paused, open the live queue'))}
            style={({ pressed }) => [s.linePill, !lineOpen && { backgroundColor: D.card2 }, pressed && s.pressed]}>
            <View style={[s.linePillDot, !lineOpen && { backgroundColor: D.sub }]} />
            <T w="eb" size={9} c={lineOpen ? D.green : D.sub} ls={0.9}>{lineOpen ? tr('OPEN') : tr('PAUSED')}</T>
          </Pressable>
        </View>

        {/* 11b — the money did not go anywhere, and what closing switched off */}
        {shop?.open === false && (
          <T size={12} c={D.sub} style={s.closedNote}>{tr('Nothing was cancelled — closing only stops new ones')}</T>
        )}
        {shop && <ShopClosedTiles st={shop} />}

        {(list.length > 0 || done) && (
          <View style={s.sectionRow}>
            <Eyebrow ls={1.65}>{done && !chairTaken ? tr('THE CHAIR IS EMPTY') : tr('THE CHAIR')}</Eyebrow>
            <T size={11} c={D.faint}>
              {done && !chairTaken ? tr('{count} waiting', { count: waiting.length }) : tr('bookings and walk-ins, in order')}
            </T>
          </View>
        )}

        {bookings === null && <ActivityIndicator color={D.accent} accessibilityLabel={tr('Loading the chair')} />}

        {/* BTD-22 — done is the only rung that moves money, so it is the only one with a way back */}
        {done && (
          <View style={s.doneCard}>
            <View style={s.bigTop}>
              <View style={s.doneTick}><Ico name="check" size={20} color={D.bg} /></View>
              <View style={s.grow}>
                <T w="b" size={14.5}>{tr('{row} is done', { row: nameOf(done.row, barberId) })}</T>
                <T size={11.5} c={D.sub} style={{ marginTop: 2 }}>
                  {tr('{dh} in cash · chair free since {hhmm}', { dh: dh(collectCents(done.row)), hhmm: hhmm(done.row.completed_at!) })}
                </T>
              </View>
            </View>
            <View style={s.undoStrip}>
              <Ico name="rotate-ccw" size={14} color={D.sub} />
              <T size={11.5} c={D.sub} style={[s.grow, { lineHeight: 16.5 }]}>
                {tr('Wrong man? Put him back any time until the next man sits down — the cash goes back too.')}
              </T>
              <Pressable onPress={() => undoDone(done.row)} accessibilityRole="button"
                accessibilityLabel={tr('Undo, put {row} back in the chair', { row: nameOf(done.row, barberId) })}
                style={({ pressed }) => [s.undoPill, pressed && s.pressed]}>
                <T w="b" size={11.5}>{tr('Undo')}</T>
              </Pressable>
            </View>
          </View>
        )}

        {list.length > 0 && <View style={s.list}>{list.map(chairRow)}</View>}

        {(list.length > 0 || done) && (
          <T size={11} c={D.faint} style={s.footnote}>
            {done
              ? tr('Done is the only rung that moves money, so it is the only one with a way back. Once someone else is in the chair the cash is counted, and a wrong one is the owner\'s to fix — he\'s holding it.')
              : tr('Bookings keep their clock time; walk-ins fill the space between. Waiting leaves out the man in the chair and any request you haven\'t answered.')}
          </T>
        )}

        {!todayOff && bookings !== null && (
          <Pressable onPress={toggleClockOut} accessibilityRole="button" accessibilityLabel={tr('Clock out')}
            style={({ pressed }) => [s.clockOutWide, pressed && s.pressed]}>
            <T w="b" size={11.5} c={D.textDim} ls={0.55}>{tr('CLOCK OUT')}</T>
          </Pressable>
        )}

        {/* 1s — nothing left today */}
        {bookings !== null && list.length === 0 && (
          <View style={s.emptyWrap}>
            <View style={s.emptyCircle}><Ico name="scissors" size={32} color={D.muted} /></View>
            <View style={{ alignItems: 'center' }}>
              <Serif size={19} ls={0.03}>{tr('Nothing left today')}</Serif>
              <T size={13} c={D.sub} style={s.emptyText}>
                {todayOff
                  ? tr('Enjoy the day. You\'re back {nextShift}.', { nextShift })
                  : tr('Enjoy the day. The chair is free until tomorrow.')}
              </T>
            </View>
            <Pressable onPress={goSchedule} accessibilityRole="button" accessibilityLabel={tr('See the schedule')}
              style={({ pressed }) => [s.emptyBtn, pressed && s.pressed]}>
              <T w="b" size={12} ls={0.72}>{tr('SEE THE SCHEDULE')}</T>
            </Pressable>
          </View>
        )}
      </Screen>

      {/* client quick-view */}
      <ClientSheet client={sheetClient} barberId={barberId}
        onClose={() => setSheetClient(null)}
        onChat={(id, title) => openChat({ id, title })} />

      {/* 34f — tick off what was actually done, then complete. Hands off to BTD-22's card, and to 3a
          for a client with an account. A walk-in has nobody to rate: the card is his goodbye. */}
      <SettleBundleSheet
        booking={settleB && {
          id: settleB.id,
          starts_at: settleB.starts_at,
          client: nameOf(settleB, barberId),
        }}
        ask={settleAsk}
        onClose={() => { setSettleB(null); setSettleAsk(false); }}
        onDone={() => {
          const b = settleB;
          setSettleB(null); setSettleAsk(false);
          if (b && b.customer_id !== barberId) setCompletedB(b);
          load();
        }} />

      {/* 3a–3c — rate the client, raised straight after MARK DONE */}
      <RateClientSheet
        visible={!!completedB}
        onClose={() => setCompletedB(null)}
        barberId={barberId}
        booking={completedB && {
          id: completedB.id,
          customerId: completedB.customer_id,
          name: nameOf(completedB, barberId),
          initials: initialsOf(nameOf(completedB, barberId)),
          service: completedB.services?.name ?? tr('Service'),
          time: hhmm(completedB.starts_at),
          priceCents: completedB.price_cents,
          isWalkIn: completedB.customer_id === barberId,
          hasPhone: !!completedB.customer?.phone,
          lateMin: completedB.checked_in_at
            ? Math.max(0, Math.round(
              (new Date(completedB.checked_in_at).getTime() - new Date(completedB.starts_at).getTime()) / 60_000))
            : null,
        }}
        // the list may not have reloaded yet: count the cut just done once, never twice
        takenTodayCents={takenCents + (completedB && !book.some((b) => b.id === completedB.id && b.completed_at)
          ? completedB.price_cents : 0)}
        next={(() => {
          const n = waiting.find((b) => b.id !== completedB?.id);
          if (!n) return null;
          return {
            ticket: pad(noOf(n)),
            label: nameOf(n, barberId),
            service: n.services?.name ?? tr('Service'),
            waitingMin: Math.max(0, Math.round((now - new Date(n.starts_at).getTime()) / 60_000)),
            priceCents: n.price_cents,
          };
        })()}
        onAskInChat={() => completedB && askReviewInChat(completedB)}
        onAskBySms={() => { const b = completedB; setCompletedB(null); if (b) askReviewBySms(b); }}
        onDone={() => { setCompletedB(null); load(); }}
      />

      {/* BTD-21 — one row, opened: where it sits on the four rungs, and its one next verb */}
      <BookingPanelSheet
        visible={!!panel}
        booking={panelRow && panelOf(panelRow)}
        sheet={panelRow && sheetOf(panelRow)}
        barberId={barberId}
        onClose={() => setPanel(null)}
        onPrimary={() => {
          const b = panelRow;
          setPanel(null);
          // a sheet opening as another closes can be swallowed with it
          if (b) setTimeout(() => primary(b), unconfirmed(b) ? 350 : 0);
        }}
        onChat={() => { const b = panel; setPanel(null); if (b) openChat({ id: b.id, title: nameOf(b, barberId) }); }}
        onHistory={() => { const b = panel; setPanel(null); if (b) setSheetClient(clientRefOf(b)); }}
        onService={() => {
          const b = panelRow;
          setPanel(null);
          if (b) setTimeout(() => { setSettleAsk(true); setSettleB(b); }, 350);
        }}
        onAnotherDay={() => { const b = panel; if (b) anotherDay(b); }}
        // the take-off asks first, and an Alert over a closing sheet can vanish with it
        onTakeOff={() => { const b = panel; setPanel(null); if (b) setTimeout(() => takeOff(b), 350); }}
      />

      {/* 3d — a request, with the shop's flag on it */}
      <BookingRequestSheet
        visible={!!request}
        booking={request && panelOf(request)}
        onClose={() => setRequest(null)}
        onAccept={() => { const b = request; setRequest(null); if (b) accept(b); }}
        onDecline={() => { const b = request; setRequest(null); if (b) setCancelling(b); }}
        onClearFlag={async () => {
          const b = request; setRequest(null);
          if (!b) return;
          const { error } = await supabase.from('client_flags')
            .update({ reason: null, require_full_payment: false, blocked: false })
            .eq('barber_id', barberId).eq('customer_id', b.customer_id);
          if (error) Alert.alert(tr('Could not clear the flag'), error.message);
        }}
      />

      {/* 1r — cancel a booking */}
      <CancelBookingSheet
        visible={!!cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={() => { setCancelling(null); load(); }}
        target={cancelling && {
          id: cancelling.id,
          name: nameOf(cancelling, barberId),
          time: hhmm(cancelling.starts_at),
          isWalkIn: cancelling.customer_id === barberId,
          nextFreeLabel: nextFreeSlot(cancelling.id),
        }}
      />

      {/* BTD-17 — CALL HIM on a web name that never tapped: asked once, here */}
      <FrontSheet visible={!!frontRow}
        row={frontRow && {
          no: noOf(frontRow), name: nameOf(frontRow, barberId),
          service: frontRow.services?.name ?? tr('Service'), phone: phoneOf(frontRow),
        }}
        textedAt={frontRow ? guests[frontRow.id]?.joined_at ?? null : null}
        onClose={() => setFrontAsk(null)}
        onCall={() => { const r = frontRow; setFrontAsk(null); if (r) callIn(r, true); }}
        onDrop={() => { const r = frontRow; setFrontAsk(null); if (r) dropNow(r); }} />

      {/* reschedule */}
      <Modal visible={!!resched} transparent animationType="slide" onRequestClose={() => setResched(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('Close')} style={s.sheetBackdrop} onPress={() => setResched(null)} />
        {resched && (
          <View style={[s.menuSheet, s.sheetLight]} onAccessibilityEscape={() => setResched(null)}>
            <Text style={s.sheetTitleLight}>
              {tr('Move {resched} · {x} min', { resched: nameOf(resched, barberId), x: (new Date(resched.ends_at).getTime() - new Date(resched.starts_at).getTime()) / 60_000 })}
            </Text>
            {/* ponytail: SlotPicker is light-themed; lives on a light sheet until a dark variant matters */}
            <ScrollView style={{ flexGrow: 0 }}>
              <SlotPicker barberId={barberId}
                durationMin={(new Date(resched.ends_at).getTime() - new Date(resched.starts_at).getTime()) / 60_000}
                selected={reschedAt} onSelect={setReschedAt} />
            </ScrollView>
            <PillButton title={reschedAt ? tr('Move to {reschedAt}', { reschedAt: reschedAt.toTimeString().slice(0, 5) }) : tr('Pick a new time')}
              disabled={!reschedAt} onPress={confirmReschedule} />
            <PillButton variant="secondary" title={tr('Keep the time he has')} onPress={() => setResched(null)} />
          </View>
        )}
      </Modal>

    </View>
  );

  // Everything below is pushed over the dashboard, which stays mounted behind
  // it so a swipe back reads as returning rather than a card vanishing.
  //
  // ponytail: the dashboard's derivation runs now even while a child is open.
  // It is array work over rows already in memory, so it costs a render, not a
  // fetch — memoise it if that ever shows up in a profile.
  if (offerFor) {
    const shut = () => { setOfferFor(null); onChromeHidden?.(false); };
    return (
      <Pushed onBack={shut} behind={dash}>
        <OfferDayScreen barberId={barberId} row={offerFor} onBack={shut} onSent={() => { shut(); load(); }} />
      </Pushed>
    );
  }
  if (chat) {
    // the customer reads one thread with this barber, so the barber reads the
    // same one back - otherwise "like I said last time" arrives pointing at a
    // message he cannot see. A walk-in books under the barber's own id, and
    // ChatScreen leaves those on their single booking rather than pooling
    // every walk-in he has ever had into one thread.
    const row = bookings?.find((x) => x.id === chat.id);
    return (
      <Pushed onBack={() => openChat(null)} behind={dash}>
        <ChatScreen dark bookingId={chat.id} threadWith={row?.customer_id} myId={barberId}
          title={chat.title} onBack={() => openChat(null)} />
      </Pushed>
    );
  }
  if (showEarnings) {
    return (
      <Pushed onBack={() => openEarnings(false)} behind={dash}>
        <EarningsScreen barberId={barberId} onBack={() => openEarnings(false)} />
      </Pushed>
    );
  }
  if (showQueue) {
    const shut = () => { setShowQueue(false); onChromeHidden?.(false); load(); };
    return (
      <Pushed onBack={shut} behind={dash}>
        <BarberQueueScreen barberId={barberId} onBack={shut} />
      </Pushed>
    );
  }
  if (inboxOpen) {
    const shut = () => { setInboxOpen(false); onChromeHidden?.(false); };
    return (
      <Pushed onBack={() => { shut(); load(); }} behind={dash}>
        <NotificationsScreen barberId={barberId}
          onBack={() => { shut(); load(); }}
          onOpenAsk={(id) => { shut(); setAskFor(id); onChromeHidden?.(true); }}
          onOpenReview={(id) => { shut(); setReviewFor(id); onChromeHidden?.(true); }}
          onOpenGap={(id) => { shut(); onOpenGap(id); }}
          // a notification names a booking; the sheet it opens depends on whether
          // that booking is still a request. Unknown id (older than the loaded
          // window) just closes the inbox rather than opening the wrong thing.
          onOpenBooking={(id) => {
            const row = bookings?.find((x) => x.id === id);
            shut();
            if (row) (row.status === 'pending' ? setRequest : setPanel)(row);
          }} />
      </Pushed>
    );
  }
  if (askFor) {
    const shut = () => { setAskFor(null); onChromeHidden?.(false); load(); };
    return (
      <Pushed onBack={shut} behind={dash}>
        <RescheduleAskScreen barberId={barberId} bookingId={askFor} onBack={shut} />
      </Pushed>
    );
  }
  if (reviewFor) {
    const shut = () => { setReviewFor(null); onChromeHidden?.(false); };
    return (
      <Pushed onBack={shut} behind={dash}>
        <BarberReviewsScreen barberId={barberId} openBookingId={reviewFor} onBack={shut} />
      </Pushed>
    );
  }
  if (heldOpen && held) {
    const shut = () => { setHeldOpen(false); onChromeHidden?.(false); };
    return (
      <Pushed onBack={shut} behind={dash}>
        <HeldBackScreen barberId={barberId} held={held} onBack={shut} onChanged={load}
          onOpenAsk={(id) => { setHeldOpen(false); setAskFor(id); }}
          onOpenReview={(id) => { setHeldOpen(false); setReviewFor(id); }} />
      </Pushed>
    );
  }
  // 10e — opened by hand from the banner, or the moment ops hides the shop.
  // It is not a lock screen: he can always back out and keep cutting.
  if (hidden || standing?.hidden) {
    const shut = () => { setHidden(false); loadStanding(); };
    return (
      <Pushed onBack={shut} behind={dash}>
        <HiddenScreen onBack={shut} onSent={loadStanding} />
      </Pushed>
    );
  }
  return dash;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: D.bg },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  tnum: { fontVariant: ['tabular-nums'] },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  greet: { marginTop: 5 },
  closedNote: { marginTop: 6 },   // 11b
  bell: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 999,
    backgroundColor: D.accent,
  },

  clockedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 20, padding: 15,
    paddingHorizontal: 16, backgroundColor: D.amberSoft12, borderWidth: 1, borderColor: D.amberLine,
  },
  clockedIcon: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: 'rgba(232,161,0,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  undoBtn: {
    height: 32, borderRadius: 999, backgroundColor: D.amber, paddingHorizontal: 13,
    alignItems: 'center', justifyContent: 'center',
  },

  // BTD-20 — TAKEN TODAY, with the line's switch on the right
  moneyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.card,
    borderRadius: 18, paddingVertical: 13, paddingLeft: 15, paddingRight: 12,
  },
  moneyTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  money: { marginTop: 1, lineHeight: 28, fontVariant: ['tabular-nums'] },
  moneyRule: { width: 1, alignSelf: 'stretch', backgroundColor: D.border },
  linePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: D.greenSoft,
    borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10,
  },
  linePillDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: D.green },

  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  list: { gap: 8 },
  badge: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  chip: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9 },

  // in the chair, or called up: the card whose button is the next thing he does
  bigRow: {
    backgroundColor: D.card, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 15, gap: 11,
    borderWidth: 2,
  },
  bigTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bigBtn: {
    height: 44, borderRadius: 999, flexDirection: 'row', gap: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14,
  },
  // BTD-14's unconfirmed row, the same everywhere it appears: recessed, dashed amber
  unconfirmedRow: {
    backgroundColor: D.recessed, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(232,161,0,0.45)',
  },
  droppedRow: { backgroundColor: D.recessed },
  callPill: {
    height: 34, borderRadius: 999, borderWidth: 1, borderColor: D.border, paddingHorizontal: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  pucks: { flexDirection: 'row', gap: 7 },
  puck34: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  footnote: { lineHeight: 16.5 },
  clockOutWide: {
    height: 46, borderRadius: 999, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },

  // BTD-22
  doneCard: {
    backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 13,
    borderWidth: 2, borderColor: D.green,
  },
  doneTick: {
    width: 42, height: 42, borderRadius: 999, backgroundColor: D.green,
    alignItems: 'center', justifyContent: 'center',
  },
  undoStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card2,
    borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13,
  },
  undoPill: {
    height: 32, borderRadius: 999, backgroundColor: D.bg, borderWidth: 1, borderColor: D.muted,
    paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center',
  },

  emptyWrap: { alignItems: 'center', gap: 15, paddingTop: 44 },
  emptyCircle: {
    width: 88, height: 88, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: D.muted, alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { textAlign: 'center', marginTop: 8, maxWidth: 250, lineHeight: 20 },
  emptyBtn: {
    height: 48, borderRadius: 999, backgroundColor: D.card2, paddingHorizontal: 26,
    alignItems: 'center', justifyContent: 'center',
  },

  sheetBackdrop: { flex: 1, backgroundColor: D.scrim },
  menuSheet: {
    backgroundColor: D.sheet, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    padding: sp(5), paddingBottom: sp(10), gap: sp(3),
  },
  // capped so a long day's slot grid scrolls instead of pushing the backdrop and buttons off screen
  sheetLight: { backgroundColor: colors.bg, maxHeight: '88%' },
  sheetTitleLight: { fontFamily: inter.b, fontSize: 18, color: colors.text },
});
