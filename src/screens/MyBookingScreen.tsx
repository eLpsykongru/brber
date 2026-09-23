import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import SlotPicker from '../components/SlotPicker';
import { Display } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { UnderReviewStrip } from '../components/Failures';
import { daySlots } from '../lib/slots';
import { useAndroidBack } from '../lib/back';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, shadowLg, sp, TOP_INSET } from '../theme';
import ChatScreen from './ChatScreen';
import { DayQueueRow, minutesUntil } from './QueueScreen';
import { en, loc, tr, trn, trRich } from '../lib/i18n';
import { useHideTabBar } from '../components/TabBar';

// Turn 9-13 of "Customer App.dc.html" — one booking in full.
//   9a  My booking (confirmed, with the live ticket)
//   10a Cancel confirm · 10b the pending variant · 10c the same body as a sheet
//   11a Reschedule picker · 12a request sent · 12b declined · 13a moved
//
// BACKLOG (deposits): the mock prices every screen off a 40% deposit. 0005 pins
// deposit_cents to 0 and 0022's wallet is credit-only, so the PAYMENT card keeps
// the mock's exact shape but states what is actually collected — full price, in
// cash, at the shop. The moment a rail lands and deposit_cents > 0, these rows
// render the mock's copy verbatim with no layout change.

const SURFACE_SUNK = '#F7F5F1';   // the quote / inset rows inside white cards
const DASH = '#C9C5BB';
const GREEN = '#4ADE80';
const GREEN_INK = '#15803D';
const SEEN_KEY = (id: string) => `moved_seen_${id}`;

export type Detail = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_cents: number;
  deposit_cents: number;
  created_at: string;
  completed_at: string | null;
  service_id: string;
  services: { name: string; duration_min: number } | null;
  barbers: {
    id: string;
    specialty: string | null;
    profiles: { full_name: string | null } | null;
    salon: { name: string; address: string | null; status?: string | null } | null;
  } | null;
};

export type Request = {
  id: string;
  requested_start: string;
  from_start: string;
  status: 'pending' | 'accepted' | 'declined';
  note: string | null;
  alt_starts: string[];
  decided_at: string | null;
};

const SELECT =
  'id, starts_at, ends_at, status, price_cents, deposit_cents, created_at, completed_at, service_id,'
  + ' services(name, duration_min),'
  // 38f needs the shop's status: a shop vanishing from search must never read as
  // a booking vanishing, and the only way to say so is to know it happened.
  + ' barbers(id, specialty, profiles!barbers_id_fkey(full_name), salon:salons!salon_id(name, address, status))';

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
function shortId(id: string) {
  return `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
function dayLine(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(loc('en-US'), { weekday: 'short', month: 'short', day: 'numeric' })}`;
}
function hhmm(iso: string | Date) {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toTimeString().slice(0, 5);
}
function whenLine(iso: string) {
  return `${dayLine(iso)} · ${hhmm(iso)}`;
}
function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(loc('en-US'), { month: 'short', day: 'numeric' })}, `
    + d.toLocaleTimeString(loc('en-US'), { hour: 'numeric', minute: '2-digit' });
}
function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return tr('{m} min ago', { m });
  if (m < 1440) return tr('{h} h ago', { h: Math.round(m / 60) });
  return tr('{d} d ago', { d: Math.round(m / 1440) });
}
function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString();
}
// A notification can open any booking, not only the upcoming ones the list
// sends here. Only a live one gets cancel / reschedule / ask strips. Same
// lines as My bookings' tabs: a confirmed booking whose time ran out is done.
type BookingState = 'live' | 'done' | 'cancelled' | 'no_show' | 'expired';
function stateOf(d: Pick<Detail, 'status' | 'completed_at' | 'ends_at'>): BookingState {
  if (d.status === 'cancelled') return 'cancelled';
  if (d.status === 'no_show') return 'no_show';
  if (d.completed_at || d.status === 'completed') return 'done';
  if (new Date(d.ends_at).getTime() < Date.now()) return d.status === 'pending' ? 'expired' : 'done';
  return 'live';
}
const STATE_CHIP: Record<Exclude<BookingState, 'live'>, string> = {
  done: tr('COMPLETED'), cancelled: tr('CANCELLED'), no_show: tr('NO-SHOW'), expired: tr('EXPIRED'),
};

// ---- data -----------------------------------------------------------------
function useBooking(bookingId: string) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [queue, setQueue] = useState<DayQueueRow[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bookings').select(SELECT).eq('id', bookingId).single();
    if (error) { Alert.alert(tr('Could not load the booking'), error.message); return; }
    const d = data as unknown as Detail;
    setDetail(d);

    const { data: reqs } = await supabase.from('reschedule_requests')
      .select('id, requested_start, from_start, status, note, alt_starts, decided_at')
      .eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(1);
    setRequest((reqs?.[0] as Request) ?? null);

    const barberId = d.barbers?.id;
    if (barberId) {
      supabase.from('reviews').select('rating').eq('barber_id', barberId).then(({ data: rv }) => {
        if (rv?.length) setRating(rv.reduce((a, r) => a + r.rating, 0) / rv.length);
      });
      listPortfolio(barberId).then((p) => { if (p.length) setPhoto(p[0].url); });
      if (isToday(d.starts_at) && d.status === 'confirmed') {
        supabase.rpc('barber_day_queue', { p_barber: barberId })
          .then(({ data: q }) => setQueue((q as DayQueueRow[]) ?? []));
      }
    }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);
  return { detail, request, rating, photo, queue, reload: load };
}

// ---- shared bits ----------------------------------------------------------
function Eyebrow({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[s.eyebrow, style]}>{children}</Text>;
}

function Photo({ url, size }: { url: string | null; size: number }) {
  const box = { width: size, height: size, borderRadius: size > 70 ? 16 : 14 };
  if (url) return <Image source={{ uri: url }} style={[s.photo, box]} />;
  return (
    <View style={[s.photo, s.photoFallback, box]}>
      <Ionicons name="storefront-outline" size={size * 0.34} color={colors.accent} />
    </View>
  );
}

function Pill({ title, dark, wide, onPress }: {
  title: string; dark?: boolean; wide?: boolean; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => [s.pill, dark ? s.pillDark : s.pillLight,
        { flex: wide ? 1.4 : 1 }, pressed && s.pressed]}>
      <Text style={[s.pillText, !dark && s.pillTextLight]}>{title}</Text>
    </Pressable>
  );
}

/** §6.4 — "free until 13:30 today", never "up to 2 hours before". */
function freeAt(t: Date) {
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(t) - midnight(new Date())) / 86_400_000);
  const hhmm = t.toTimeString().slice(0, 5);
  return days === 0 ? tr('{at} today', { at: hhmm })
    : days === 1 ? tr('{at} tomorrow', { at: hhmm })
      : tr('{at} on {day}', { at: hhmm, day: t.toLocaleDateString(loc('en-GB'), { weekday: 'long' }) });
}

// PAYMENT card — 9a / 10b / 10c. Mock shape, real numbers.
function Payment({ d, compact, live }: { d: Detail; compact?: boolean; live: boolean }) {
  const total = d.price_cents / 100;
  const dep = d.deposit_cents / 100;
  const pct = dep > 0 ? Math.round((d.deposit_cents / d.price_cents) * 100) : 0;
  const pending = d.status === 'pending';

  // BKG-07 / §6.4 — the free-cancellation deadline, as a moment. The server
  // does the subtraction (`booking_free_until`, 0078) so the screen and
  // `cancel_booking` can never disagree about whether it has passed.
  const [freeUntil, setFreeUntil] = useState<Date | null>(null);
  useEffect(() => {
    if (dep <= 0 || !live) return;
    let alive = true;
    supabase.rpc('booking_free_until', { p_booking: d.id })
      .then(({ data }) => { if (alive && data) setFreeUntil(new Date(data as string)); });
    return () => { alive = false; };
  }, [d.id, dep, live]);
  const stillFree = !!freeUntil && freeUntil.getTime() > Date.now();

  return (
    <View style={[s.card, compact && s.cardTight, { gap: compact ? sp(2.25) : sp(2.5) }]}>
      {!compact && <Eyebrow>{tr('PAYMENT')}</Eyebrow>}
      {pending ? (
        <Row label={dep > 0 ? tr('Deposit ({pct}%)', { pct }) : tr('Deposit')}
          value={dep > 0 && live ? tr('Taken once confirmed') : tr('Not taken')} valueMuted />
      ) : (
        <Row label={dep > 0 ? tr('Deposit paid ({pct}%)', { pct }) : tr('Paid up front')} value={tr('{dep} DH', { dep: dep.toFixed(0) })} />
      )}
      {!pending && live && <Row label={tr('Due at the shop')} value={tr('{x} DH', { x: (total - dep).toFixed(0) })} />}
      {!pending && live && <View style={s.hr} />}
      <View style={s.rowBase}>
        <Text style={s.totalKey}>{tr('Total')}</Text>
        <Text style={s.totalVal}>{tr('{total} DH', { total: total.toFixed(0) })}</Text>
      </View>
      {/* 10c drops the footnote — the sheet has no room for it. It is all about
          cancelling and confirming, so a booking that is over drops it too. */}
      <View style={[s.lockLine, (compact || !live) && s.hidden]}>
        <Ionicons name="lock-closed-outline" size={12} color={colors.textTertiary} />
        <Text style={s.lockText}>
          {dep > 0
            ? (pending
              ? tr('Nothing leaves your wallet until the barber accepts')
              : freeUntil
                ? (stillFree
                  ? tr('Free to cancel until {freeUntil} — until then the {dep} DH comes straight back to your wallet.', { freeUntil: freeAt(freeUntil), dep: dep.toFixed(0) })
                  : tr('Free cancellation ended at {freeUntil}. Cancelling now leaves the deposit with the shop.', { freeUntil: freeAt(freeUntil) }))
                : tr('Deposit refunded to your wallet if the shop cancels'))
            : tr('No deposit is taken — you pay the full price at the shop')}
        </Text>
      </View>

      {/* BKG-32 - the deadline above is a moment, deliberately. This card is
          the duration, and only exists to say the slot is not what expires. */}
      {!compact && dep > 0 && stillFree && !!freeUntil && hoursLeft(freeUntil) != null && (
        <View style={s.deadlineCard}>
          <View style={s.deadlineIcon}>
            <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          </View>
          <View style={s.grow}>
            <Text style={s.mindTitle}>{tr('{freeUntil} left on that', { freeUntil: hoursLeft(freeUntil) })}</Text>
            <Text style={s.mindBody}>
              {tr('After {replace} you can still cancel — the slot goes back to his queue either way. The {dep} DH is what changes.', { replace: freeAt(freeUntil).replace(/ .*$/, ''), dep: dep.toFixed(0) })}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

// how long until the free window shuts. Rounded down, and never shown as the
// deadline itself - `freeAt` is the only thing allowed to say when it lands.
function hoursLeft(t: Date) {
  const min = Math.floor((t.getTime() - Date.now()) / 60_000);
  if (min < 1) return null;
  if (min < 60) return tr('{m} min', { m: min });
  const h = Math.floor(min / 60);
  return trn(h, '{n} hour', '{n} hours');
}

function Row({ label, value, valueMuted, accent }: {
  label: string; value: string; valueMuted?: boolean; accent?: boolean;
}) {
  return (
    <View style={s.rowBase}>
      <Text style={s.rowKey}>{label}</Text>
      <Text style={[s.rowVal, valueMuted && s.rowValMuted, accent && s.rowValAccent]}>{value}</Text>
    </View>
  );
}

// the salon + barber card, shared by 9a / 10b / 10c / 12b
function SalonCard({ d, photo, rating, statusChip, photoSize, onChat, compact }: {
  d: Detail; photo: string | null; rating: number | null; statusChip: string;
  photoSize: number; onChat?: () => void; compact?: boolean;
}) {
  const name = d.barbers?.profiles?.full_name ?? tr('Your barber');
  const address = d.barbers?.salon?.address ?? tr('Tangier');
  const pending = d.status === 'pending';

  function openMap() {
    Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(`${d.barbers?.salon?.name ?? ''} ${address}`)}`);
  }

  return (
    <View style={[s.card, compact && s.cardTight, { gap: compact ? sp(3.25) : sp(3.5) }]}>
      <View style={s.chipRow}>
        <View style={s.chipNeutral}>
          <Text style={[s.chipNeutralText, pending && s.chipMutedText]}>{statusChip}</Text>
        </View>
        {!!d.services?.name && (
          <View style={s.chipAccent}>
            <Text style={s.chipAccentText}>{d.services.name.toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={s.bodyRow}>
        <Photo url={photo} size={photoSize} />
        <View style={s.grow}>
          <Text style={[s.salonName, compact && s.salonNameSm]} numberOfLines={1}>
            {d.barbers?.salon?.name ?? tr('Salon')}
          </Text>
          <View style={s.metaLine}>
            <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
            <Text style={s.meta} numberOfLines={1}>{address}</Text>
          </View>
          <View style={s.metaLine}>
            <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
            <Text style={s.meta}>
              {pending
                ? tr('Requested {when} · {mins} Mins', { when: whenLine(d.starts_at), mins: d.services?.duration_min ?? 0 })
                : tr('{when} · {mins} Mins', { when: whenLine(d.starts_at), mins: d.services?.duration_min ?? 0 })}
            </Text>
          </View>
        </View>
      </View>

      <View style={s.barberRow}>
        <View style={s.avatar}><Text style={s.avatarText}>{initials(name)}</Text></View>
        <View style={s.grow}>
          <Text style={s.barberName}>{name}</Text>
          <Text style={s.meta}>
            {d.barbers?.specialty ?? tr('Barber')}{rating != null ? ` · ${rating.toFixed(1)} ★` : ''}
          </Text>
        </View>
        <View style={s.puckRow}>
          <Pressable onPress={onChat} style={({ pressed }) => [s.puck, pressed && s.pressed]}
            accessibilityLabel={tr('Message the barber')}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.text} />
          </Pressable>
          <Pressable onPress={openMap} style={({ pressed }) => [s.puck, pressed && s.pressed]}
            accessibilityLabel={tr('Open in maps')}>
            <Ionicons name="location-outline" size={16} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---- 9a / 10b / 10c body --------------------------------------------------
function DetailBody({ d, request, photo, rating, queue, sheet, onQueue, onChat, onCancel, onReschedule, onAcceptOffer, onPickAnother }: {
  d: Detail; request: Request | null; photo: string | null; rating: number | null;
  queue: DayQueueRow[] | null; sheet?: boolean;
  onQueue?: () => void; onChat: () => void; onCancel: () => void; onReschedule: () => void;
  onAcceptOffer: (iso: string) => void; onPickAnother: () => void;
}) {
  const [keptOriginal, setKeptOriginal] = useState(false);
  const state = stateOf(d);
  const live = state === 'live';
  const pending = live && d.status === 'pending';
  // an ask left open on a booking that has since been cancelled or has passed
  // is history, not something to wait on
  const declined = live && !keptOriginal && request?.status === 'declined';
  const asked = live && request?.status === 'pending';

  const mine = queue?.find((r) => r.booking_id === d.id) ?? null;
  const ticketNo = queue && mine ? queue.findIndex((r) => r.booking_id === d.id) + 1 : null;
  const ahead = queue && mine
    ? queue.filter((r) => r.stage !== 'done' && r.booking_id !== d.id
      && new Date(r.starts_at).getTime() < new Date(mine.starts_at).getTime()).length
    : 0;

  return (
    <>
      {/* the live ticket — 9a. Only exists once the barber has confirmed and it's today. */}
      {mine && ticketNo != null && (
        <Pressable onPress={onQueue} disabled={!onQueue}
          style={({ pressed }) => [s.ticket, pressed && onQueue && s.pressed]}>
          <View style={s.ticketNoCol}>
            <Text style={s.ticketLabel}>{tr('TICKET')}</Text>
            <Text style={[s.ticketNo, sheet && s.ticketNoSm]}>Nº {String(ticketNo).padStart(2, '0')}</Text>
          </View>
          <View style={s.ticketDivider} />
          <View style={s.grow}>
            <View style={s.ticketHead}>
              <View style={s.dot} />
              <Text style={s.ticketBig}>
                {tr('{x} · ~{starts_at} min', { x: mine.stage === 'in_chair' ? tr('You\'re up') : tr('{ahead} ahead', { ahead }), starts_at: minutesUntil(mine.starts_at) })}
              </Text>
            </View>
            <Text style={s.ticketSub}>{tr('We\'ll notify you when you\'re next')}</Text>
          </View>
          <View style={[s.ticketChev, sheet && s.ticketChevSm]}>
            <Ionicons name="chevron-forward" size={sheet ? 13 : 14} color={colors.accent} />
          </View>
        </Pressable>
      )}

      {/* 10b — waiting for the barber */}
      {pending && (
        <View style={s.waitStrip}>
          <View style={s.waitIcon}>
            <Ionicons name="time-outline" size={17} color={colors.textSecondary} />
          </View>
          <View style={s.grow}>
            <Text style={s.waitTitle}>
              {tr('Waiting for {name} to confirm', { name: (d.barbers?.profiles?.full_name ?? tr('the barber')).split(' ')[0] })}
            </Text>
            <Text style={s.waitSub}>{tr('Usually within an hour · you\'ll get a ticket once confirmed')}</Text>
          </View>
        </View>
      )}

      {/* the ask is out — 12a's state, seen from the detail screen */}
      {asked && request && (
        <View style={s.askStrip}>
          <View style={s.askIcon}>
            <Ionicons name="swap-horizontal" size={17} color={colors.accent} />
          </View>
          <View style={s.grow}>
            <Text style={s.waitTitle}>{tr('Reschedule requested')}</Text>
            <Text style={s.waitSub}>{tr('{requested_start} · waiting for an answer', { requested_start: whenLine(request.requested_start) })}</Text>
          </View>
        </View>
      )}

      {/* 12b — declined, with what he can do instead */}
      {declined && request && (
        <DeclinedCard d={d} request={request} onAcceptOffer={onAcceptOffer} />
      )}

      <SalonCard d={d} photo={photo} rating={rating} compact={sheet}
        photoSize={sheet ? 68 : 74} onChat={onChat}
        statusChip={state !== 'live' ? STATE_CHIP[state]
          : pending ? tr('PENDING') : declined ? tr('STILL CONFIRMED') : tr('CONFIRMED')} />

      {/* 38f — the shop is hidden from search, and that is the one thing this
          card must not let him confuse with his booking being gone. */}
      {d.barbers?.salon?.status && d.barbers.salon.status !== 'live' && live && (
        <UnderReviewStrip barberName={d.barbers?.profiles?.full_name ?? tr('your barber')}
          onMessage={onChat} onCancel={onCancel} />
      )}

      <Payment d={d} compact={sheet} live={live} />

      {!sheet && (
        <View style={s.idCard}>
          <View>
            <Text style={s.idLabel}>{pending ? tr('REQUEST ID') : tr('BOOKING ID')}</Text>
            <Text style={s.idValue}>{shortId(d.id)}</Text>
          </View>
          <View style={s.right}>
            <Text style={s.idLabel}>{pending ? tr('SENT') : tr('BOOKED')}</Text>
            <Text style={s.idValue}>{stamp(d.created_at)}</Text>
          </View>
        </View>
      )}

      {/* the two CTAs sit in the caller's absolute footer, but the sheet keeps them inline */}
      {sheet && live && (
        <View style={s.footerInline}>
          <Pill title={tr('CANCEL')} onPress={onCancel} />
          <Pill title={tr('RESCHEDULE')} dark wide onPress={onReschedule} />
        </View>
      )}
      {!sheet && declined && (
        <View style={s.footerInline}>
          <Pill title={tr('PICK ANOTHER TIME')} onPress={onPickAnother} />
          <Pill title={tr('KEEP {starts_at}', { starts_at: dayLine(d.starts_at).split(',')[0].toUpperCase() })} dark
            onPress={() => setKeptOriginal(true)} />
        </View>
      )}
    </>
  );
}

// 12b's banner. `alt_starts` is what the barber offered; when he offered nothing
// the screen falls back to the next free slots it can work out itself, and says so.
function DeclinedCard({ d, request, onAcceptOffer }: {
  d: Detail; request: Request; onAcceptOffer: (iso: string) => void;
}) {
  const [fallback, setFallback] = useState<string[]>([]);
  const offered = request.alt_starts ?? [];
  const barberId = d.barbers?.id;
  const name = d.barbers?.profiles?.full_name ?? tr('Your barber');

  useEffect(() => {
    if (offered.length || !barberId) return;
    nextFreeSlots(barberId, d.services?.duration_min ?? 30, new Date(request.requested_start), 2)
      .then((slots) => setFallback(slots.map((t) => t.toISOString())));
  }, [barberId, offered.length, request.requested_start, d.services?.duration_min]);

  const rows = offered.length ? offered : fallback;

  return (
    <View style={[s.card, s.cardTight, s.declined]}>
      <View style={s.declinedHead}>
        <View style={s.declinedIcon}>
          <Ionicons name="close" size={17} color={colors.accent} />
        </View>
        <View style={s.grow}>
          <Text style={s.declinedTitle}>{tr('Reschedule declined')}</Text>
          <Text style={s.waitSub}>
            {whenLine(request.requested_start)}
            {request.decided_at ? tr(' · declined {decided_at}', { decided_at: ago(request.decided_at) }) : ''}
          </Text>
        </View>
      </View>

      {!!request.note && (
        <View style={s.quote}>
          <View style={s.quoteAvatar}><Text style={s.quoteAvatarText}>{initials(name)}</Text></View>
          <Text style={s.quoteText}>“{request.note}”</Text>
        </View>
      )}

      {rows.length > 0 && (
        <>
          <Eyebrow style={s.suggestLabel}>
            {offered.length
              ? tr('{name} SUGGESTS', { name: name.split(' ')[0].toUpperCase() })
              : tr('NEXT FREE WITH {name}', { name: name.split(' ')[0].toUpperCase() })}
          </Eyebrow>
          <View style={s.offerList}>
            {rows.map((iso) => (
              <View key={iso} style={s.offer}>
                <View style={s.grow}>
                  <Text style={s.offerWhen}>{whenLine(iso)}</Text>
                  <Text style={s.waitSub}>{tr('Same service · {duration_min} min', { duration_min: d.services?.duration_min ?? 30 })}</Text>
                </View>
                <Pressable onPress={() => onAcceptOffer(iso)}
                  style={({ pressed }) => [s.offerBtn, pressed && s.pressed]}>
                  <Text style={s.offerBtnText}>{offered.length ? tr('ACCEPT') : tr('ASK')}</Text>
                </Pressable>
              </View>
            ))}
          </View>
          {/* BKG-37 - ASK and ACCEPT look alike; only this line says why they
              aren't. A scanned slot dressed as an offer is a broken promise. */}
          {!offered.length && (
            <Text style={s.scanNote}>
              {tr('{x} on his real calendar, not times he has offered. ASK sends a fresh request — he still has to accept.', { x: rows.length === 1 ? tr('This is the soonest gap') : tr('These {count} are the soonest gaps', { count: rows.length }) })}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

// The two rows under 12b when the barber named no alternatives: the soonest free
// slots on his real calendar, scanned forward a fortnight.
async function nextFreeSlots(barberId: string, durationMin: number, from: Date, count: number) {
  const to = new Date(from.getTime() + 14 * 86_400_000);
  const [av, off, blk, buf, booked] = await Promise.all([
    supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
    supabase.from('days_off').select('day').eq('barber_id', barberId),
    supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', barberId),
    supabase.from('barbers').select('buffer_before_min, buffer_after_min').eq('id', barberId).single(),
    supabase.rpc('booked_ranges', {
      p_barber: barberId,
      p_from: new Date(Math.max(from.getTime(), Date.now())).toISOString(),
      p_to: to.toISOString(),
    }),
  ]);
  const bufferMin = buf.data ? buf.data.buffer_before_min + buf.data.buffer_after_min : 0;
  const daysOff = (off.data ?? []).map((r) => r.day);
  const out: Date[] = [];
  for (let i = 0; i < 14 && out.length < count; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    for (const sl of daySlots(day, durationMin, av.data ?? [], booked.data ?? [], daysOff, blk.data ?? [], bufferMin)) {
      if (sl.status === 'free' && out.length < count) out.push(sl.time);
    }
  }
  return out;
}

// ---- 10a · cancel confirm -------------------------------------------------
// kept in English: the reason goes to the barber as it is, and is shown translated
const REASONS = [en('Something came up'), en('Wrong time'), en('Too far'), en('Other')];

const OTHER_MAX = 140;

// 35a/35b. Two states of one sheet, because they are the same decision with
// different stakes: a confirmed booking costs you the deposit, a pending request
// costs nothing because the barber never answered. The reason stays OPTIONAL on
// both — the deliberate asymmetry with the barber's required radio rows (1r/3a),
// because nobody owes a shop an explanation.
function CancelSheet({ d, pending, visible, onClose, onReschedule, onDone }: {
  d: Detail; pending: boolean; visible: boolean;
  onClose: () => void; onReschedule: () => void; onDone: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [walletCents, setWalletCents] = useState<number | null>(null);
  const [freeUntil, setFreeUntil] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const dep = d.deposit_cents / 100;
  const stillFree = !!freeUntil && freeUntil.getTime() > Date.now();
  const lapsed = !pending && dep > 0 && !!freeUntil && !stillFree;
  const first = (d.barbers?.profiles?.full_name ?? tr('your barber')).split(' ')[0];
  const isOther = reason === 'Other';
  // "Other" without words says nothing the chip didn't; send the words instead.
  const sent = isOther ? (other.trim() || null) : reason;

  useEffect(() => {
    if (!visible) { setReason(null); setOther(''); return; }
    // 35b shows the wallet on both sides of a withdrawal to prove it didn't move
    if (!pending) return;
    supabase.from('wallet_transactions').select('amount_cents')
      .then(({ data }) => setWalletCents((data ?? []).reduce((a, r: any) => a + r.amount_cents, 0)));
  }, [visible, pending]);

  useEffect(() => {
    if (!visible || pending) return;
    supabase.rpc('booking_free_until', { p_booking: d.id })
      .then(({ data }) => setFreeUntil(data ? new Date(data as string) : null));
  }, [visible, pending, d.id]);

  async function confirm() {
    setBusy(true);
    const { error } = await supabase.rpc('cancel_booking', { p_booking: d.id, p_reason: sent });
    setBusy(false);
    if (error) return Alert.alert(pending ? tr('Could not withdraw') : tr('Could not cancel'), error.message);
    onDone(sent);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrimDeep} onPress={onClose} />
      <View style={s.sheetBottom}>
        <View style={s.grabber} />
        <View style={s.center}>
          <View style={pending ? s.calmCircle : s.warnCircle}>
            <Ionicons name={pending ? 'time-outline' : 'warning-outline'} size={26}
              color={pending ? colors.textSecondary : colors.accent} />
          </View>
          <Display size={24} style={s.sheetTitle}>
            {pending ? tr('Withdraw request?') : tr('Cancel booking?')}
          </Display>
          <Text style={s.sheetSub}>
            {pending
              ? tr('{first} hasn\'t answered yet, so there\'s nothing to cancel — the request just disappears.', { first })
              : tr('{name} with {first}, {starts_at}. The slot goes back to the queue.', { name: d.services?.name ?? tr('Your service'), first, starts_at: whenLine(d.starts_at) })}
          </Text>
        </View>

        <View style={[s.card, s.cardTight]}>
          <View style={s.lockRow}>
            {pending
              ? <View style={s.okDot}><Ionicons name="checkmark" size={12} color={colors.success} /></View>
              : <Ionicons name="lock-closed-outline" size={15} color={colors.accent} style={s.lockIcon} />}
            <Text style={s.lockBody}>
              {pending
                ? trRich('<b>Nothing was charged</b> — your wallet is untouched and no deposit was held.', {
                  b: (text, key) => <Text key={key} style={s.lockStrong}>{text}</Text>,
                })
                : dep > 0
                  ? (lapsed
                    ? trRich('<b>Free cancellation ended at {freeAt}.</b> Cancelling now leaves the {dep} DH with the shop — he has been holding the chair for you since then.', {
                      b: (text, key) => <Text key={key} style={s.lockStrong}>{text}</Text>,
                    }, { freeAt: freeAt(freeUntil!), dep: dep.toFixed(0) })
                    : stillFree
                      ? trRich('<b>Free until {freeAt}</b> — cancel before then and the {dep} DH goes straight back to your wallet.', {
                        b: (text, key) => <Text key={key} style={s.lockStrong}>{text}</Text>,
                      }, { freeAt: freeAt(freeUntil!), dep: dep.toFixed(0) })
                      : trRich('<b>Your {dep} DH deposit is not refunded</b> when you cancel — it is only returned to your wallet if the barber cancels.', {
                        b: (text, key) => <Text key={key} style={s.lockStrong}>{text}</Text>,
                      }, { dep: dep.toFixed(0) }))
                  : trRich('<b>Nothing was charged for this booking</b> — you pay at the shop, so cancelling costs you nothing.', {
                    b: (text, key) => <Text key={key} style={s.lockStrong}>{text}</Text>,
                  })}
            </Text>
          </View>
          <View style={s.hr} />
          {pending ? (
            <>
              <Row label={tr('Wallet before')} value={tr('{x} DH', { x: ((walletCents ?? 0) / 100).toFixed(0) })} />
              <Row label={tr('Wallet after')} value={tr('{x} DH', { x: ((walletCents ?? 0) / 100).toFixed(0) })} />
            </>
          ) : (
            <>
              <Row label={tr('Paid up front')} value={tr('{dep} DH', { dep: dep.toFixed(0) })} />
              <Row label={tr('Refund to wallet')} value={stillFree ? tr('{dep} DH', { dep: dep.toFixed(0) }) : tr('0 DH')}
                accent={!stillFree} />
            </>
          )}
        </View>

        {lapsed && (
          <View style={s.deadlineCard}>
            <View style={s.deadlineIcon}>
              <Ionicons name="swap-horizontal-outline" size={14} color={colors.textSecondary} />
            </View>
            <View style={s.grow}>
              <Text style={s.mindTitle}>{tr('Moving it keeps the {dep} DH.', { dep: dep.toFixed(0) })}</Text>
              <Text style={s.mindBody}>
                {tr('A reschedule carries the deposit over — if {starts_at} just doesn\'t work, that\'s the cheaper door.', { starts_at: whenLine(d.starts_at).split(' · ')[0] })}
              </Text>
            </View>
          </View>
        )}

        <View style={s.reasonBlock}>
          <Eyebrow>{tr('REASON (OPTIONAL)')}</Eyebrow>
          <View style={s.reasonRow}>
            {REASONS.map((r) => {
              const on = reason === r;
              return (
                <Pressable key={r} onPress={() => setReason(on ? null : r)}
                  style={({ pressed }) => [s.reason, on && s.reasonOn, pressed && s.pressed]}>
                  <Text style={[s.reasonText, on && s.reasonTextOn]}>{tr(r)}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 35a — "Other" has to go somewhere, or the chip is a dead end */}
          {isOther && (
            <>
              <TextInput value={other} onChangeText={(t) => setOther(t.slice(0, OTHER_MAX))}
                multiline placeholder={tr('What happened?')} placeholderTextColor={colors.textTertiary}
                style={s.otherInput} />
              <View style={s.otherFoot}>
                <Text style={s.otherCount}>
                  {tr('{first} sees this · {count} / {OTHER_MAX}', { first, count: other.length, OTHER_MAX })}
                </Text>
                <Pressable onPress={() => setReason(null)} hitSlop={8}>
                  <Text style={s.skip}>{tr('Skip')}</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        <View style={s.sheetCtas}>
          <Pressable onPress={confirm} disabled={busy}
            style={({ pressed }) => [pending ? s.inkBtn : s.dangerBtn, (pressed || busy) && s.pressed]}>
            <Text style={pending ? s.inkText : s.dangerText}>
              {pending ? tr('WITHDRAW REQUEST')
                : lapsed ? tr('CANCEL AND LOSE {dep} DH', { dep: dep.toFixed(0) }) : tr('CANCEL BOOKING')}
            </Text>
          </Pressable>
          <Pressable onPress={pending ? onClose : onReschedule}
            style={({ pressed }) => [s.keepBtn, pressed && s.pressed]}>
            <Text style={s.keepText}>
              {pending ? tr('KEEP WAITING') : tr('KEEP IT — RESCHEDULE INSTEAD')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ---- 35c · the receipt ----------------------------------------------------
// Cancelling used to just pop you back to the list. This is what actually
// happened, in the order you care about: it's done, the barber knows, here is
// the money. The deposit line is the point — 35a warned you, and this is the
// same number after the fact rather than a surprise in the wallet later.
function CancelledScreen({ d, ticketNo, reason, withdrawn, refunded, onMessage, onBookAgain, onBack }: {
  d: Detail; ticketNo: number | null; reason: string | null; withdrawn: boolean;
  /** 0078 — whether the hold went back to the wallet. Read off `deposit_holds`
   *  after the cancel, never recomputed here: the receipt must say what the
   *  ledger did, not what this screen thinks the rule was. */
  refunded: boolean;
  onMessage: () => void; onBookAgain: () => void; onBack: () => void;
}) {
  const first = (d.barbers?.profiles?.full_name ?? tr('Your barber')).split(' ')[0];
  const dep = d.deposit_cents / 100;
  const at = new Date(d.starts_at).toTimeString().slice(0, 5);

  // BKG-35 - a withdrawn request has no money story, so the proof is the
  // wallet reading the same on both sides rather than a refund line of 0 DH.
  const [walletCents, setWalletCents] = useState<number | null>(null);
  useEffect(() => {
    if (!withdrawn) return;
    supabase.from('wallet_transactions').select('amount_cents')
      .then(({ data }) => setWalletCents((data ?? []).reduce((a, r: any) => a + r.amount_cents, 0)));
  }, [withdrawn]);
  const wallet = `${((walletCents ?? 0) / 100).toFixed(0)} DH`;

  return (
    <View style={s.screen}>
      <View style={s.receiptHead}>
        <Pressable onPress={onBack} hitSlop={8} style={s.receiptBack}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Text style={s.receiptRef}>{`#${d.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`}</Text>
        <View style={s.receiptBackGhost} />
      </View>

      <View style={s.receiptCenter}>
        <View style={s.receiptIcon}>
          <Ionicons name={withdrawn ? 'close' : 'calendar-clear-outline'} size={26}
            color={colors.textSecondary} />
        </View>
        <Display size={24} style={s.outcomeTitle}>{withdrawn ? tr('Withdrawn') : tr('Cancelled')}</Display>
        <Text style={s.receiptSub}>
          {withdrawn
            ? tr('Your request is gone. {first} never saw it, and nothing was charged.', { first })
            : ticketNo != null
              ? tr('{first} has been told. Your ticket Nº {no} is released and {at} is back in his queue.', { first, no: String(ticketNo).padStart(2, '0'), at })
              : tr('{first} has been told. {at} is back in his queue.', { first, at })}
        </Text>
      </View>

      <View style={s.receiptCard}>
        <Row label={withdrawn ? tr('You asked for') : tr('Was')} value={whenLine(d.starts_at)} />
        <Row label={tr('Service')}
          value={tr('{name} · {x} DH', { name: d.services?.name ?? tr('Service'), x: (d.price_cents / 100).toFixed(0) })} />
        {!!reason && !withdrawn && <Row label={tr('You said')} value={tr(reason)} />}
        <View style={s.hr} />
        {withdrawn ? (
          <>
            <Row label={tr('Wallet before')} value={wallet} />
            <Row label={tr('Wallet after')} value={wallet} />
            <Text style={s.receiptNote}>{tr('Nothing was ever held — a request is not a deposit')}</Text>
          </>
        ) : (
          <>
            <Row label={tr('Deposit paid')} value={tr('{dep} DH', { dep: dep.toFixed(0) })} />
            <View style={s.rowBase}>
              <Text style={s.refundK}>{tr('Refunded to wallet')}</Text>
              <Text style={[s.refundV, refunded && s.refundBack]}>
                {refunded ? tr('{dep} DH', { dep: dep.toFixed(0) }) : tr('0 DH')}
              </Text>
            </View>
            {dep > 0 && refunded && (
              <Text style={s.receiptNote}>{tr('In your wallet already · you cancelled inside the free window')}</Text>
            )}
          </>
        )}
      </View>

      {/* no released slot to talk about, so no "changed your mind" card - just
          the one thing he might not realise: asking again costs nothing */}
      {withdrawn && (
        <View style={s.deadlineCard}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary}
            style={s.lockIcon} />
          <Text style={s.mindBody}>
            {tr('Nothing to undo and nobody to tell. If you want that time after all, ask again — {at} is still open on his day.', { at })}
          </Text>
        </View>
      )}

      {!withdrawn && (
        <View style={s.mindCard}>
          <View style={s.mindIcon}>
            <Ionicons name="refresh-outline" size={15} color={colors.textSecondary} />
          </View>
          <View style={s.grow}>
            <Text style={s.mindTitle}>{tr('Changed your mind?')}</Text>
            <Text style={s.mindBody}>
              {tr('{at} is free again for now.{x}{x2}', { at, x: dep > 0 && !refunded ? tr(' Rebooking it doesn\'t bring the {dep} DH back.', { dep: dep.toFixed(0) }) : '', x2: dep > 0 && refunded ? tr(' Your {dep} DH is back in your wallet to spend on it.', { dep: dep.toFixed(0) }) : '' })}
            </Text>
          </View>
        </View>
      )}

      <View style={s.receiptCtas}>
        <Pressable onPress={onMessage} style={({ pressed }) => [s.msgBtn, pressed && s.pressed]}>
          <Text style={s.msgText}>{tr('MESSAGE {first}', { first: first.toUpperCase() })}</Text>
        </Pressable>
        <Pressable onPress={onBookAgain} style={({ pressed }) => [s.againBtn, pressed && s.pressed]}>
          <Text style={s.againText}>{tr('BOOK AGAIN')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---- 11a · pick a new time ------------------------------------------------
function RescheduleSheet({ d, visible, onClose, onSent }: {
  d: Detail; visible: boolean; onClose: () => void; onSent: () => void;
}) {
  const [pick, setPick] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const dep = d.deposit_cents / 100;
  const first = (d.barbers?.profiles?.full_name ?? 'the barber').split(' ')[0];
  const current = useMemo(() => new Date(d.starts_at), [d.starts_at]);

  async function send() {
    if (!pick) return;
    setBusy(true);
    const { error } = await supabase.rpc('request_reschedule',
      { p_booking: d.id, p_new_start: pick.toISOString() });
    setBusy(false);
    if (error) return Alert.alert(tr('Could not send the request'), error.message);
    onSent();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={s.sheetTall}>
        <View style={s.grabber} />
        <View style={s.sheetHead}>
          <Pressable onPress={onClose} hitSlop={8} style={s.headSlot}>
            <Ionicons name="chevron-back" size={16} color={colors.text} />
          </Pressable>
          <Display size={18} style={s.headTitle}>{tr('Reschedule')}</Display>
          <Pressable onPress={onClose} hitSlop={8} style={[s.headSlot, s.headSlotEnd]}>
            <Ionicons name="close" size={16} color={colors.text} />
          </Pressable>
        </View>

        <View style={s.currentCard}>
          <View style={s.avatarSm}>
            <Text style={s.avatarText}>{initials(d.barbers?.profiles?.full_name ?? 'B')}</Text>
          </View>
          <View style={s.grow}>
            <Text style={s.currentTitle}>{d.services?.name ?? tr('Service')} · {first}</Text>
            <Text style={s.waitSub}>{tr('Currently {starts_at}', { starts_at: whenLine(d.starts_at) })}</Text>
          </View>
          <View style={s.minChip}>
            <Text style={s.minChipText}>{tr('{duration_min} MIN', { duration_min: d.services?.duration_min ?? 30 })}</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.pickerScroll}>
          {d.barbers?.id && (
            <SlotPicker barberId={d.barbers.id} durationMin={d.services?.duration_min ?? 30}
              selected={pick} onSelect={setPick} label={tr('NEW DATE')} markDay={current} />
          )}
          <View style={s.noteCard}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} style={s.lockIcon} />
            <Text style={s.noteText}>
              {tr('{x}{first} confirms the new time.', { x: dep > 0
                ? tr('Your {dep} DH deposit carries over — nothing new is charged. ', { dep: dep.toFixed(0) })
                : tr('Nothing is charged for a move. '), first })}
            </Text>
          </View>
        </ScrollView>

        <View style={s.sheetFooter}>
          <Pressable onPress={send} disabled={!pick || busy}
            style={({ pressed }) => [s.moveBtn, (pressed || !pick || busy) && s.pressedHard]}>
            <Text style={s.moveText}>
              {pick ? tr('MOVE TO {dayLine} · {pick}', { dayLine: dayLine(pick.toISOString()).toUpperCase(), pick: hhmm(pick) }) : tr('PICK A NEW TIME')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ---- 12a · request sent ---------------------------------------------------
function RequestedScreen({ d, request, onBack, onChat }: {
  d: Detail; request: Request; onBack: () => void; onChat: () => void;
}) {
  const name = d.barbers?.profiles?.full_name ?? tr('Your barber');
  const dep = d.deposit_cents / 100;
  return (
    <View style={s.outcome}>
      <View style={s.outcomeIcon}>
        <Ionicons name="time-outline" size={30} color={colors.accent} />
      </View>
      <View>
        <Display size={28} style={s.outcomeTitle}>{tr('Request sent')}</Display>
        <Text style={s.outcomeSub}>
          {tr('{name} has to accept the new time. Your original slot is held until he answers.', { name: name.split(' ')[0] })}
        </Text>
      </View>

      <View style={s.outcomeCard}>
        <View style={s.swapRow}>
          <View style={s.grow}>
            <Text style={s.swapLabel}>{tr('CURRENT')}</Text>
            <Text style={s.swapWas}>{whenLine(request.from_start)}</Text>
          </View>
          <View style={s.swapArrow}>
            <Ionicons name="arrow-forward" size={14} color={colors.text} />
          </View>
          <View style={[s.grow, s.right]}>
            <Text style={[s.swapLabel, s.swapLabelNew]}>{tr('REQUESTED')}</Text>
            <Text style={s.swapNew}>{whenLine(request.requested_start)}</Text>
          </View>
        </View>
        <View style={s.hr} />
        <View style={s.barberRowFlat}>
          <View style={s.avatar}><Text style={s.avatarText}>{initials(name)}</Text></View>
          <View style={s.grow}>
            <Text style={s.barberName}>{name}</Text>
            <Text style={s.meta}>
              {d.services?.name ?? tr('Service')} · {d.barbers?.salon?.name ?? tr('Salon')}
            </Text>
          </View>
          <View style={s.chipNeutral}><Text style={s.chipMutedText}>{tr('PENDING')}</Text></View>
        </View>
        <View style={s.sunkRow}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
          <Text style={s.sunkLabel}>{dep > 0 ? tr('Deposit unchanged') : tr('Nothing charged')}</Text>
          <Text style={s.sunkValue}>{tr('{dep} DH', { dep: dep.toFixed(0) })}</Text>
        </View>
      </View>

      <Pressable onPress={onBack} style={({ pressed }) => [s.wideDark, pressed && s.pressed]}>
        <Text style={s.wideDarkText}>{tr('BACK TO MY BOOKING')}</Text>
      </Pressable>
      <Text style={s.linkAccent} onPress={onChat}>{tr('Message {name}', { name: name.split(' ')[0] })}</Text>
    </View>
  );
}

// ---- 13a · moved ----------------------------------------------------------
function MovedScreen({ d, request, ticketNo, onDone }: {
  d: Detail; request: Request; ticketNo: number | null; onDone: () => void;
}) {
  const name = d.barbers?.profiles?.full_name ?? tr('Your barber');
  const dep = d.deposit_cents / 100;
  const total = d.price_cents / 100;
  return (
    <View style={[s.outcome, s.outcomeTight]}>
      <View style={s.movedIcon}>
        <Ionicons name="checkmark" size={30} color="#16A34A" />
      </View>
      <View>
        <Display size={28} style={s.outcomeTitle}>{tr('Moved')}</Display>
        <Text style={s.outcomeSub}>
          {tr('{name} accepted your new time. Same service, same price — nothing else to pay up front.', { name: name.split(' ')[0] })}
        </Text>
      </View>

      <View style={s.movedCard}>
        <View style={s.swapRow}>
          <View style={s.grow}>
            <Text style={s.movedLabel}>{tr('WAS')}</Text>
            <Text style={s.movedWas}>{whenLine(request.from_start)}</Text>
          </View>
          <View style={s.movedArrow}>
            <Ionicons name="arrow-forward" size={14} color="#fff" />
          </View>
          <View style={[s.grow, s.right]}>
            <Text style={[s.movedLabel, s.swapLabelNew]}>{tr('NOW')}</Text>
            <Text style={s.movedNow}>{whenLine(d.starts_at)}</Text>
          </View>
        </View>
        <View style={s.hrDark} />
        <View style={s.rowBase}>
          <View>
            <Text style={s.movedLabel}>{ticketNo != null ? tr('NEW TICKET') : tr('SERVICE')}</Text>
            <Text style={s.movedTicket}>
              {ticketNo != null ? `Nº ${String(ticketNo).padStart(2, '0')}` : (d.services?.name ?? tr('Service'))}
            </Text>
          </View>
          <View style={s.right}>
            <Text style={s.movedLabel}>{dep > 0 ? tr('DEPOSIT CARRIED') : tr('DUE AT THE SHOP')}</Text>
            <Text style={s.movedAmount}>{tr('{x} DH', { x: (dep > 0 ? dep : total).toFixed(0) })}</Text>
          </View>
        </View>
      </View>

      <View style={s.movedBarber}>
        <View style={s.avatarLg}><Text style={s.avatarText}>{initials(name)}</Text></View>
        <View style={s.grow}>
          <Text style={s.barberName}>{name}</Text>
          <Text style={s.meta}>
            {tr('{name} · {x} DH at the shop', { name: d.services?.name ?? tr('Service'), x: (total - dep).toFixed(0) })}
          </Text>
        </View>
        <View style={s.chipGreen}><Text style={s.chipGreenText}>{tr('CONFIRMED')}</Text></View>
      </View>

      <Pressable onPress={onDone} style={({ pressed }) => [s.wideDark, pressed && s.pressed]}>
        <Text style={s.wideDarkText}>{tr('VIEW MY BOOKING')}</Text>
      </Pressable>
    </View>
  );
}

// ---- the screen -----------------------------------------------------------
type Overlay = 'cancel' | 'reschedule' | 'requested' | 'moved' | 'chat' | null;

export default function MyBookingScreen({ bookingId, myId, onBack, onQueue, onReport }: {
  bookingId: string; myId: string; onBack: () => void;
  onQueue?: () => void; onReport?: (bookingId: string) => void;
}) {
  useHideTabBar();
  const { detail, request, rating, photo, queue, reload } = useBooking(bookingId);
  const [overlay, setOverlay] = useState<Overlay>(null);
  // 35c — held after cancelling so the receipt can be shown instead of popping back
  const [cancelled, setCancelled] = useState<{ reason: string | null; withdrawn: boolean; refunded: boolean } | null>(null);

  // 13a fires once per acceptance — the barber answers while the app is closed,
  // so the celebration is owed on the next open, not on the tap that caused it.
  // A booking cancelled or past since then is owed nothing.
  const isLive = !!detail && stateOf(detail) === 'live';
  useEffect(() => {
    if (!isLive || request?.status !== 'accepted' || !request.decided_at) return;
    AsyncStorage.getItem(SEEN_KEY(request.id)).then((seen) => {
      if (!seen) setOverlay('moved');
    });
  }, [isLive, request?.id, request?.status, request?.decided_at]);

  async function dismissMoved() {
    if (request) await AsyncStorage.setItem(SEEN_KEY(request.id), '1');
    setOverlay(null);
  }

  // the three overlays sit over the booking; under them, back leaves the
  // booking itself. 13a (moved) is excluded on purpose — it is an
  // acknowledgement, and dismissMoved is the only way through it.
  useAndroidBack(
    overlay === 'chat' || overlay === 'requested' ? () => setOverlay(null) : onBack,
  );

  if (!detail) return <View style={s.screen} />;
  const d = detail;
  const name = d.barbers?.profiles?.full_name ?? tr('Your barber');
  const pending = d.status === 'pending';
  const declined = isLive && request?.status === 'declined';
  const mine = queue?.find((r) => r.booking_id === d.id) ?? null;
  const ticketNo = queue && mine ? queue.findIndex((r) => r.booking_id === d.id) + 1 : null;

  if (overlay === 'chat') {
    return <ChatScreen bookingId={d.id} myId={myId} title={name}
      subtitle={d.barbers?.salon?.name ?? undefined} onBack={() => setOverlay(null)} />;
  }
  if (overlay === 'requested' && request) {
    return <RequestedScreen d={d} request={request} onBack={() => setOverlay(null)}
      onChat={() => setOverlay('chat')} />;
  }
  if (overlay === 'moved' && request) {
    return <MovedScreen d={d} request={request} ticketNo={ticketNo} onDone={dismissMoved} />;
  }
  // 35c — the after-state. Cancelling used to pop straight back to the list.
  if (cancelled) {
    return <CancelledScreen d={d} ticketNo={ticketNo} reason={cancelled.reason}
      withdrawn={cancelled.withdrawn} refunded={cancelled.refunded}
      onBack={onBack} onBookAgain={onBack}
      onMessage={() => { setCancelled(null); setOverlay('chat'); }} />;
  }

  async function askFor(iso: string) {
    const rpc = declined && request?.alt_starts?.length
      ? supabase.rpc('accept_reschedule_offer', { p_request: request.id, p_start: iso })
      : supabase.rpc('request_reschedule', { p_booking: d.id, p_new_start: iso });
    const { error } = await rpc;
    if (error) return Alert.alert(tr('Could not do that'), error.message);
    await reload();
    setOverlay(declined && request?.alt_starts?.length ? 'moved' : 'requested');
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable onPress={onBack} hitSlop={8}
            style={({ pressed }) => [s.headPuck, pressed && s.pressed]} accessibilityLabel={tr('Go back')}>
            <Ionicons name="arrow-back" size={16} color={colors.text} />
          </Pressable>
          <Display size={18} style={s.headTitle}>{tr('My booking')}</Display>
          {declined ? <View style={s.headSpacer} /> : (
            <Pressable onPress={() => Alert.alert(tr('This booking'), undefined, [
              { text: tr('Message the barber'), onPress: () => setOverlay('chat') },
              // 17a is reached from here as well as from Help Center
              { text: tr('Report a problem'), onPress: () => onReport?.(d.id) },
              { text: tr('Close'), style: 'cancel' },
            ])} hitSlop={8}
              style={({ pressed }) => [s.headPuck, pressed && s.pressed]} accessibilityLabel={tr('More')}>
              <Ionicons name="ellipsis-vertical" size={16} color={colors.text} />
            </Pressable>
          )}
        </View>

        <DetailBody d={d} request={request} photo={photo} rating={rating} queue={queue}
          onQueue={onQueue} onChat={() => setOverlay('chat')}
          onCancel={() => setOverlay('cancel')} onReschedule={() => setOverlay('reschedule')}
          onAcceptOffer={askFor} onPickAnother={() => setOverlay('reschedule')} />
      </ScrollView>

      {isLive && !declined && (
        <View style={s.footer}>
          <Pill title={pending ? tr('WITHDRAW') : tr('CANCEL')} onPress={() => setOverlay('cancel')} />
          <Pill title={pending ? tr('MESSAGE {name}', { name: name.split(' ')[0].toUpperCase() }) : tr('RESCHEDULE')} dark wide
            onPress={() => setOverlay(pending ? 'chat' : 'reschedule')} />
        </View>
      )}

      <CancelSheet d={d} pending={pending} visible={overlay === 'cancel'}
        onClose={() => setOverlay(null)}
        onReschedule={() => setOverlay('reschedule')}
        onDone={async (reason) => {
          setOverlay(null);
          // 0075's hold is the record of where the money went. Asking it beats
          // re-deriving the window here and getting a different answer.
          const { data: hold } = await supabase.from('deposit_holds')
            .select('state').eq('booking_id', d.id).maybeSingle();
          setCancelled({ reason, withdrawn: pending, refunded: hold?.state === 'to_customer' });
        }} />
      <RescheduleSheet d={d} visible={overlay === 'reschedule'} onClose={() => setOverlay(null)}
        onSent={async () => { await reload(); setOverlay('requested'); }} />
    </View>
  );
}

// ---- 10c · the same body, as a sheet over My bookings ---------------------
export function BookingDetailSheet({ bookingId, myId, visible, initial, onClose, onQueue, onReport }: {
  bookingId: string; myId: string; visible: boolean;
  initial?: 'cancel' | 'reschedule'; onClose: () => void; onQueue?: () => void;
  onReport?: (bookingId: string) => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={s.sheetOver}>
        <View style={s.grabber} />
        <View style={s.sheetHead}>
          {/* BKG-42 - the same menu the full screen has. Without it, reporting
              a problem is unreachable from the list, which is the main door. */}
          {onReport ? (
            <Pressable onPress={() => Alert.alert(tr('This booking'), undefined, [
              { text: tr('Report a problem'), onPress: () => onReport(bookingId) },
              { text: tr('Close'), style: 'cancel' },
            ])} hitSlop={8} style={({ pressed }) => [s.headSlot, pressed && s.pressed]}
              accessibilityLabel={tr('More')}>
              <Ionicons name="ellipsis-vertical" size={16} color={colors.text} />
            </Pressable>
          ) : <View style={s.headSlot} />}
          <Display size={18} style={s.headTitle}>{tr('My booking')}</Display>
          <Pressable onPress={onClose} hitSlop={8} style={[s.headSlot, s.headSlotEnd]}>
            <Ionicons name="close" size={16} color={colors.text} />
          </Pressable>
        </View>
        <SheetBody bookingId={bookingId} myId={myId} initial={initial}
          onClose={onClose} onQueue={onQueue} />
      </View>
    </Modal>
  );
}

function SheetBody({ bookingId, myId, initial, onClose, onQueue }: {
  bookingId: string; myId: string; initial?: 'cancel' | 'reschedule';
  onClose: () => void; onQueue?: () => void;
}) {
  const { detail, request, rating, photo, queue, reload } = useBooking(bookingId);
  // 6a's CANCEL / RESCHEDULE land straight in the right flow instead of making
  // you tap through the detail you already saw on the card
  const [overlay, setOverlay] = useState<Overlay>(initial ?? null);
  if (!detail) return <View style={s.grow} />;
  const d = detail;

  if (overlay === 'chat') {
    return <ChatScreen bookingId={d.id} myId={myId} title={d.barbers?.profiles?.full_name ?? tr('Barber')}
      subtitle={d.barbers?.salon?.name ?? undefined} onBack={() => setOverlay(null)} />;
  }

  return (
    <>
      <ScrollView contentContainerStyle={s.sheetScroll} showsVerticalScrollIndicator={false}>
        <DetailBody d={d} request={request} photo={photo} rating={rating} queue={queue} sheet
          onQueue={onQueue} onChat={() => setOverlay('chat')}
          onCancel={() => setOverlay('cancel')} onReschedule={() => setOverlay('reschedule')}
          onAcceptOffer={async (iso) => {
            const { error } = await supabase.rpc('request_reschedule',
              { p_booking: d.id, p_new_start: iso });
            if (error) return Alert.alert(tr('Could not do that'), error.message);
            reload();
          }}
          onPickAnother={() => setOverlay('reschedule')} />
      </ScrollView>
      {/* ponytail: 35b works here, but 35c's receipt is a full screen — inside the
          sheet the close still wins. Open the booking full-screen to get it. */}
      <CancelSheet d={d} pending={d.status === 'pending'} visible={overlay === 'cancel'}
        onClose={() => setOverlay(null)}
        onReschedule={() => setOverlay('reschedule')}
        onDone={() => { setOverlay(null); onClose(); }} />
      <RescheduleSheet d={d} visible={overlay === 'reschedule'} onClose={() => setOverlay(null)}
        onSent={async () => { await reload(); setOverlay(null); }} />
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: TOP_INSET, paddingHorizontal: 20, paddingBottom: 110, gap: 13 },
  grow: { flex: 1 },
  right: { alignItems: 'flex-end' },
  pressed: { opacity: 0.7 },
  pressedHard: { opacity: 0.45 },
  hidden: { display: 'none' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headPuck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  headSpacer: { width: 40 },
  headTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.72 },

  // 9a ticket
  ticket: {
    backgroundColor: colors.ink, borderRadius: 22, paddingVertical: 16, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', gap: 13,
  },
  ticketNoCol: { alignItems: 'center', gap: 2 },
  ticketLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  ticketNo: { fontFamily: serif, fontSize: 24, lineHeight: 27, color: '#fff' },
  ticketNoSm: { fontSize: 22, lineHeight: 25 },
  ticketDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.12)' },
  ticketHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN },
  ticketBig: { fontSize: font.small, fontWeight: '700', color: '#fff' },
  ticketSub: { fontSize: font.tiny, color: 'rgba(255,255,255,0.55)', marginTop: 3 },
  ticketChev: {
    width: 32, height: 32, borderRadius: radius.pill, backgroundColor: 'rgba(232,68,46,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  ticketChevSm: { width: 30, height: 30 },

  // 10b waiting strip
  waitStrip: {
    backgroundColor: colors.bg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: DASH,
    borderRadius: 22, paddingVertical: 16, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', gap: 13,
  },
  waitIcon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  waitTitle: { fontSize: font.small, fontWeight: '700', color: colors.text },
  waitSub: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 3 },
  askStrip: {
    backgroundColor: colors.bg, borderRadius: 22, paddingVertical: 16, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', gap: 13, ...shadow,
  },
  askIcon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  // cards
  card: { backgroundColor: colors.bg, borderRadius: 24, padding: 18, ...shadow },
  cardTight: { borderRadius: 22, padding: 16 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chipNeutral: {
    backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10,
  },
  chipNeutralText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.text },
  chipMutedText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textSecondary },
  chipAccent: {
    backgroundColor: 'rgba(232,68,46,0.10)', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10,
  },
  chipAccentText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.accent },
  chipGreen: {
    backgroundColor: 'rgba(74,222,128,0.18)', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9,
  },
  chipGreenText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: GREEN_INK },

  bodyRow: { flexDirection: 'row', gap: 14 },
  photo: { backgroundColor: colors.surface },
  photoFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  salonName: { fontSize: 16, fontWeight: '700', color: colors.text },
  salonNameSm: { fontSize: 15 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  meta: { fontSize: 12, color: colors.textSecondary, flexShrink: 1, marginTop: 2 },

  barberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14,
  },
  barberRowFlat: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 42, height: 42, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarSm: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLg: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '700', color: colors.accent },
  barberName: { fontSize: font.small, fontWeight: '700', color: colors.text },
  puckRow: { flexDirection: 'row', gap: 8 },
  puck: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },

  // payment
  eyebrow: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: colors.textSecondary },
  rowBase: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowKey: { fontSize: font.small, color: colors.textSecondary },
  rowVal: { fontSize: font.small, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  rowValMuted: { color: colors.textSecondary },
  rowValAccent: { color: colors.accent },
  hr: { height: 1, backgroundColor: colors.border },
  hrDark: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  totalKey: { fontSize: font.small, fontWeight: '700', color: colors.text },
  totalVal: { fontSize: 17, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  lockLine: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 },
  lockText: { fontSize: font.tiny, color: colors.textTertiary, flex: 1 },

  idCard: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.bg,
    borderRadius: 20, paddingVertical: 14, paddingHorizontal: 18, ...shadow,
  },
  idLabel: { fontSize: 10, letterSpacing: 1, fontWeight: '600', color: colors.textTertiary },
  idValue: {
    fontSize: font.small, fontWeight: '700', color: colors.text, marginTop: 3,
    fontVariant: ['tabular-nums'],
  },

  // footer CTAs
  footer: {
    position: 'absolute', left: 20, right: 20, bottom: 26, flexDirection: 'row', gap: 10,
  },
  footerInline: { flexDirection: 'row', gap: 10, marginTop: 2 },
  pill: { height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  pillDark: { backgroundColor: colors.ink },
  pillLight: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.border },
  pillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.72, color: '#fff' },
  pillTextLight: { color: '#5C5C58' },

  // 12b declined
  declined: { borderWidth: 2, borderColor: colors.accent, gap: 13, padding: 18 },
  declinedHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  declinedIcon: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  declinedTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  quote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    backgroundColor: SURFACE_SUNK, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  quoteAvatar: {
    width: 26, height: 26, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  quoteAvatarText: { fontSize: 9, fontWeight: '700', color: colors.accent },
  quoteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },
  suggestLabel: { marginTop: 2, fontSize: font.tiny },
  offerList: { gap: 9 },
  offer: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 16,
    paddingVertical: 13, paddingHorizontal: 15,
  },
  offerWhen: { fontSize: 14, fontWeight: '700', color: colors.text },
  offerBtn: {
    height: 34, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
  offerBtnText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: '#fff' },

  // sheets
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  scrimDeep: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.52)' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  sheetBottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24, paddingBottom: 34, gap: 15, ...shadowLg,
  },
  sheetTall: {
    position: 'absolute', left: 0, right: 0, bottom: 0, top: 104, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 22, gap: 13, ...shadowLg,
  },
  sheetOver: {
    position: 'absolute', left: 0, right: 0, bottom: 0, top: 74, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 22, gap: 12, ...shadowLg,
  },
  sheetScroll: { gap: 12, paddingBottom: 34 },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  headSlot: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headSlotEnd: { alignItems: 'flex-end' },
  center: { alignItems: 'center', paddingTop: 4 },
  warnCircle: {
    width: 60, height: 60, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetTitle: { marginTop: 14, textAlign: 'center' },
  sheetSub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 8, lineHeight: 20, textAlign: 'center',
  },
  lockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  lockIcon: { marginTop: 1 },
  lockBody: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },
  lockStrong: { color: colors.text, fontWeight: '700' },
  reasonBlock: { gap: 9 },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: {
    borderRadius: radius.pill, backgroundColor: colors.bg, paddingVertical: 9, paddingHorizontal: 16,
  },
  reasonOn: { backgroundColor: colors.ink },
  reasonText: { fontSize: 12, fontWeight: '600', color: '#5C5C58' },
  reasonTextOn: { color: '#fff' },
  sheetCtas: { gap: 10, marginTop: 2 },
  dangerBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  dangerText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.04, color: '#fff' },
  keepBtn: {
    height: 52, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  keepText: { fontSize: font.small, fontWeight: '700', letterSpacing: 0.78, color: colors.text },

  // 35a/35b — "Other" gets somewhere to go, and a withdrawal is calm, not alarming
  calmCircle: {
    width: 60, height: 60, borderRadius: radius.pill, backgroundColor: '#E9E6DE',
    alignItems: 'center', justifyContent: 'center',
  },
  okDot: {
    width: 20, height: 20, borderRadius: radius.pill, backgroundColor: 'rgba(74,222,128,0.18)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  otherInput: {
    backgroundColor: colors.bg, borderRadius: 18, minHeight: 64, paddingHorizontal: 16,
    paddingVertical: 13, fontSize: 14, lineHeight: 21, color: colors.text,
    textAlignVertical: 'top', ...shadow,
  },
  otherFoot: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  otherCount: { flex: 1, fontSize: font.tiny, color: colors.textTertiary },
  skip: { fontSize: font.tiny, fontWeight: '600', color: colors.textSecondary },
  inkBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  inkText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.04, color: '#fff' },

  // 35c — the receipt
  receiptHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  receiptBack: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  receiptBackGhost: { width: 40 },
  receiptRef: {
    flex: 1, textAlign: 'center', fontSize: font.tiny, letterSpacing: 1.98,
    fontWeight: '700', color: colors.textSecondary,
  },
  receiptCenter: { alignItems: 'center', gap: 13, paddingTop: 2 },
  receiptIcon: {
    width: 64, height: 64, borderRadius: radius.pill, backgroundColor: '#E9E6DE',
    alignItems: 'center', justifyContent: 'center',
  },
  receiptSub: {
    fontSize: font.small, color: colors.textSecondary, lineHeight: 20,
    textAlign: 'center', maxWidth: 272,
  },
  receiptCard: {
    backgroundColor: colors.bg, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 16,
    gap: 11, ...shadow,
  },
  receiptNote: { fontSize: 11, lineHeight: 16, color: colors.textSecondary, marginTop: -2 },
  refundK: { fontSize: font.small, fontWeight: '700', color: colors.text },
  refundV: { fontSize: 18, fontWeight: '800', color: colors.accent, fontVariant: ['tabular-nums'] },
  refundBack: { color: colors.success },
  mindCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.bg,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, ...shadow,
  },
  mindIcon: {
    width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  // BKG-32 - sunk inside the payment card, not a card of its own
  deadlineCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.surface,
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12,
  },
  deadlineIcon: {
    width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  scanNote: { fontSize: 11, lineHeight: 17, color: colors.textSecondary, marginTop: 2 },
  mindTitle: { fontSize: font.small, fontWeight: '700', color: colors.text },
  mindBody: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 4 },
  receiptCtas: { flexDirection: 'row', gap: 10 },
  msgBtn: {
    flex: 1, height: 52, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  msgText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#5C5C58' },
  againBtn: {
    flex: 1.2, height: 52, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  againText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#fff' },

  // 11a
  currentCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.bg,
    borderRadius: 18, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  currentTitle: { fontSize: font.small, fontWeight: '700', color: colors.text },
  minChip: {
    backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9,
  },
  minChipText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: '#5C5C58' },
  pickerScroll: { paddingBottom: 110 },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, marginTop: 14, ...shadow,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },
  sheetFooter: { position: 'absolute', left: 22, right: 22, bottom: 28 },
  moveBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  moveText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.04, color: '#fff' },

  // 12a / 13a outcomes
  outcome: {
    flex: 1, backgroundColor: colors.surface, paddingTop: 96, paddingHorizontal: 26,
    gap: 18, alignItems: 'center',
  },
  outcomeTight: { paddingTop: 88 },
  outcomeIcon: {
    width: 68, height: 68, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  movedIcon: {
    width: 68, height: 68, borderRadius: radius.pill, backgroundColor: 'rgba(74,222,128,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  outcomeTitle: { textAlign: 'center' },
  outcomeSub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 8, lineHeight: 20,
    maxWidth: 290, textAlign: 'center',
  },
  outcomeCard: {
    width: '100%', backgroundColor: colors.bg, borderRadius: 24, padding: 20, gap: 14, ...shadowLg,
  },
  movedCard: { width: '100%', backgroundColor: colors.ink, borderRadius: 24, padding: 20, gap: 14 },
  swapRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  swapLabel: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: colors.textTertiary },
  swapLabelNew: { color: colors.accent },
  swapWas: {
    fontSize: 14, fontWeight: '700', marginTop: 4, color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  swapNew: { fontSize: 14, fontWeight: '700', marginTop: 4, color: colors.text },
  swapArrow: {
    width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  movedArrow: {
    width: 30, height: 30, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  movedLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  movedWas: {
    fontSize: 14, fontWeight: '600', marginTop: 4, color: 'rgba(255,255,255,0.5)',
    textDecorationLine: 'line-through',
  },
  movedNow: { fontFamily: serif, fontSize: 19, lineHeight: 23, color: '#fff', marginTop: 4 },
  movedTicket: { fontFamily: serif, fontSize: 22, lineHeight: 26, color: '#fff', marginTop: 4 },
  movedAmount: {
    fontSize: 18, fontWeight: '800', color: '#fff', marginTop: 6, fontVariant: ['tabular-nums'],
  },
  movedBarber: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.bg, borderRadius: 24, padding: 18, ...shadowLg,
  },
  sunkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: SURFACE_SUNK,
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
  },
  sunkLabel: { flex: 1, fontSize: 12, color: '#5C5C58' },
  sunkValue: { fontSize: font.small, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  wideDark: {
    width: '100%', height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  wideDarkText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: '#fff' },
  linkAccent: { fontSize: font.small, fontWeight: '600', color: colors.accent },
});
