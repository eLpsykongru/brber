import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Display, Field, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, sp } from '../theme';
import { BookingDetailSheet } from './MyBookingScreen';
import QueueScreen, { DayQueueRow, minutesUntil } from './QueueScreen';

// Turn 6 of "Customer App 1.dc.html" — the three tabs with per-state cards:
// 6a upcoming (live queue hero + confirmed + pending), 6b completed
// (rate / rebook / receipt), 6c cancelled (who cancelled, why, deposit outcome).
// Turn 5 re-cuts the review (4a) as a sheet that rises over the Completed tab.

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  completed_at: string | null;
  price_cents: number;
  deposit_cents: number;
  cancelled_by: string | null;
  cancel_reason: string | null;
  duration_min: number | null;
  services: { name: string; duration_min: number } | null;
  // 34e — a booking holds 1–n services now (0047). One service still lands here
  // as a single row, so the card has exactly one shape to render.
  bundle: { name: string } | null;
  booking_services: {
    service_id: string; price_cents: number; duration_min: number;
    sort: number; done_at: string | null; services: { name: string } | null;
  }[];
  barbers: {
    id: string;
    profiles: { full_name: string | null } | null;
    salon: { name: string; address: string | null } | null;
  } | null;
};

type Filter = 'upcoming' | 'completed' | 'cancelled';
const SUNK = '#F7F5F1';
const DEEP_RED = '#B4351F';

function shortId(id: string) {
  return `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    + ` – ${d.toTimeString().slice(0, 5)}`;
}

// ---- 36c · my asks ---------------------------------------------------------
type Ask = {
  id: string; day: string; earliest_min: number | null; status: string;
  salon: string | null; salon_id: string; barber: string | null;
  service: string | null; price_cents: number | null;
};

function AsksSection({ asks, onCancel }: { asks: Ask[]; onCancel: (id: string) => void }) {
  if (asks.length === 0) return null;
  const live = asks.filter((a) => a.status === 'waiting').length;
  return (
    <View style={s.asksWrap}>
      <View style={s.asksHead}>
        <Text style={s.asksTitle}>ASKS · {live} WAITING</Text>
      </View>
      {asks.map((a) => {
        const dead = a.status !== 'waiting';
        const d = new Date(`${a.day}T00:00:00`);
        return (
          <View key={a.id} style={[s.askCard, dead && s.askDead]}>
            <View style={[s.askIcon, dead && s.askIconDead]}>
              <Ionicons name={dead ? 'close' : 'hourglass-outline'} size={17}
                color={dead ? colors.textTertiary : colors.accent} />
            </View>
            <View style={s.grow}>
              <Text style={[s.askDay, dead && s.askDayDead]}>
                {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {' · '}
                {a.earliest_min == null
                  ? 'any time'
                  : `after ${String(Math.floor(a.earliest_min / 60)).padStart(2, '0')}:00`}
              </Text>
              <Text style={s.askMeta}>
                {dead
                  ? 'Nothing opened up · expired'
                  : `${a.barber ? `${a.barber.split(' ')[0]} only` : `Any barber${a.salon ? ` · ${a.salon}` : ''}`}`
                    + (a.service ? ` · ${a.service}` : '')}
              </Text>
            </View>
            {!dead && (
              <Pressable onPress={() => onCancel(a.id)} hitSlop={8}>
                <Text style={s.askCancel}>Cancel</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ---- 34e · one booking, n services -----------------------------------------
const multi = (r: Row) => (r.booking_services?.length ?? 0) > 1;
// 0047 puts the sitting's length on the booking; older rows still only have the
// one service, so fall back rather than render "0 Mins" on everything pre-0047.
const minsOf = (r: Row) => r.duration_min ?? r.services?.duration_min ?? 0;

/** The running order, with the clock time each service starts at. */
function ServiceList({ row }: { row: Row }) {
  if (!multi(row)) return null;
  const items = [...row.booking_services].sort((a, b) => a.sort - b.sort);
  let at = new Date(row.starts_at).getTime();
  return (
    <View style={s.svcList}>
      {items.map((it, i) => {
        const start = new Date(at);
        at += it.duration_min * 60_000;
        return (
          <View key={it.service_id} style={s.svcRow}>
            <View style={s.svcNum}><Text style={s.svcNumText}>{i + 1}</Text></View>
            <Text style={s.svcName} numberOfLines={1}>{it.services?.name ?? 'Service'}</Text>
            <Text style={s.svcAt}>{start.toTimeString().slice(0, 5)}</Text>
          </View>
        );
      })}
    </View>
  );
}
function firstName(n: string | null | undefined) {
  return (n ?? 'the barber').split(' ')[0];
}
function initialsOf(name: string) {
  return name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
const dh = (cents: number) => (cents / 100).toFixed(0);

function BookingPhoto({ barberId, size, dim }: { barberId?: string; size: number; dim?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (barberId) listPortfolio(barberId).then((p) => { if (alive && p.length) setUrl(p[0].url); });
    return () => { alive = false; };
  }, [barberId]);
  const box = { width: size, height: size, borderRadius: size > 60 ? 16 : 14 };
  if (url) return <Image source={{ uri: url }} style={[s.photo, box, dim && s.dimmed]} />;
  return (
    <View style={[s.photo, s.photoFallback, box, dim && s.dimmed]}>
      <Ionicons name="storefront-outline" size={size * 0.32} color={colors.accent} />
    </View>
  );
}

function Chip({ text, tone }: { text: string; tone: 'ink' | 'muted' | 'accent' | 'red' }) {
  return (
    <View style={[s.chip, tone === 'accent' && s.chipAccentBg, tone === 'red' && s.chipRedBg]}>
      <Text style={[s.chipText,
        tone === 'muted' && s.chipMuted, tone === 'accent' && s.chipAccent, tone === 'red' && s.chipRed]}>
        {text}
      </Text>
    </View>
  );
}

function Btn({ title, dark, accent, icon, onPress }: {
  title: string; dark?: boolean; accent?: boolean;
  icon?: keyof typeof Ionicons.glyphMap; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [s.btn, dark && s.btnDark, accent && s.btnAccent, pressed && s.pressed]}>
      {!!icon && <Ionicons name={icon} size={13} color="#fff" />}
      <Text style={[s.btnText, (dark || accent) && s.btnTextOn]}>{title}</Text>
    </Pressable>
  );
}

export default function MyBookingsScreen({ customerId, onChromeHidden, onRebook }: {
  customerId: string; onChromeHidden?: (hidden: boolean) => void; onRebook?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [rated, setRated] = useState<Map<string, number>>(new Map());
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [receipt, setReceipt] = useState<Row | null>(null);
  const [review, setReview] = useState<Row | null>(null);           // 5a
  const [asks, setAsks] = useState<Ask[]>([]);
  const [queue, setQueue] = useState<DayQueueRow[] | null>(null);
  const [queueOpen, setQueueOpen] = useState<Row | null>(null);
  const [detail, setDetail] = useState<{ id: string; initial?: 'cancel' | 'reschedule' } | null>(null);

  const load = useCallback(async () => {
    const [bk, rv] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, ends_at, status, completed_at, price_cents, deposit_cents,'
          + ' cancelled_by, cancel_reason, duration_min, services(name, duration_min),'
          + ' bundle:bundles!bundle_id(name),'
          + ' booking_services(service_id, price_cents, duration_min, sort, done_at, services(name)),'
          + ' barbers(id, profiles(full_name), salon:salons!salon_id(name, address))')
        .eq('customer_id', customerId)
        .order('starts_at', { ascending: false })
        .limit(50),
      supabase.from('reviews').select('booking_id, rating').eq('customer_id', customerId),
    ]);
    if (bk.error) Alert.alert('Could not load bookings', bk.error.message);
    else setRows(bk.data as unknown as Row[]);
    if (rv.data) setRated(new Map(rv.data.map((r) => [r.booking_id, r.rating])));
    // 36c — asks live alongside bookings because that's where you look for
    // "am I getting a cut this week", and an ask is the answer "maybe"
    const asks = await supabase.rpc('my_waitlist_asks');
    if (asks.data) setAsks(asks.data as Ask[]);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const now = Date.now();
  const isDone = (r: Row) =>
    r.status === 'confirmed' && (!!r.completed_at || new Date(r.ends_at).getTime() < now);
  const isLive = (r: Row) => ['pending', 'confirmed'].includes(r.status);

  // the live-queue hero on 6a: a confirmed booking today, still to come
  const ticketRow = rows.find((r) => r.status === 'confirmed' && !isDone(r)
    && new Date(r.starts_at).toDateString() === new Date().toDateString());

  useEffect(() => {
    const barberId = ticketRow?.barbers?.id;
    if (!barberId) return setQueue(null);
    supabase.rpc('barber_day_queue', { p_barber: barberId })
      .then(({ data }) => setQueue((data as DayQueueRow[]) ?? []));
  }, [ticketRow?.barbers?.id, ticketRow?.id]);

  function openOverlay(next: boolean) { onChromeHidden?.(next); }

  if (queueOpen?.barbers?.id) {
    return <QueueScreen barberId={queueOpen.barbers.id} myBookingId={queueOpen.id}
      barberLine={`${firstName(queueOpen.barbers.profiles?.full_name)} · ${queueOpen.barbers.salon?.name ?? 'Salon'}`}
      onBack={() => { setQueueOpen(null); openOverlay(false); }}
      onBookings={() => { setDetail({ id: queueOpen.id }); setQueueOpen(null); openOverlay(false); }} />;
  }
  if (receipt) {
    return <Receipt booking={receipt} onBack={() => { setReceipt(null); openOverlay(false); }} />;
  }

  const filtered = rows.filter((r) => {
    if (filter === 'upcoming') return isLive(r) && !isDone(r) && new Date(r.ends_at).getTime() >= now;
    if (filter === 'completed') return isDone(r);
    return !isLive(r);
  });

  const awaitingReview = rows.filter((r) => isDone(r) && !rated.has(r.id)).length;
  const TAB_LABEL: Record<Filter, string> = {
    upcoming: 'Upcoming', completed: 'Completed', cancelled: 'Cancelled',
  };

  const mine = queue?.find((q) => q.booking_id === ticketRow?.id) ?? null;
  const ticketNo = queue && mine ? queue.findIndex((q) => q.booking_id === ticketRow!.id) + 1 : null;
  const ahead = queue && mine
    ? queue.filter((q) => q.stage !== 'done' && q.booking_id !== ticketRow!.id
      && new Date(q.starts_at).getTime() < new Date(mine.starts_at).getTime()).length
    : 0;

  const hero = filter === 'upcoming' && ticketRow && mine && ticketNo != null ? (
    <View style={s.hero}>
      <View style={s.heroTop}>
        <View style={s.heroLive}>
          <View style={s.dot} />
          <Text style={s.heroLiveText}>IN QUEUE NOW</Text>
        </View>
        <View style={s.heroTicket}>
          <Text style={s.heroTicketText}>TICKET Nº {String(ticketNo).padStart(2, '0')}</Text>
        </View>
      </View>
      <View style={s.heroMid}>
        <View>
          <Text style={s.heroBig}>{mine.stage === 'in_chair' ? "You're up" : `${ahead} ahead`}</Text>
          <Text style={s.heroSub}>
            {ticketRow.barbers?.salon?.name ?? 'Salon'} · with {firstName(ticketRow.barbers?.profiles?.full_name)}
          </Text>
        </View>
        <View style={s.right}>
          <Text style={s.heroEta}>~{minutesUntil(mine.starts_at)} min</Text>
          <Text style={s.heroEtaLabel}>EST. WAIT</Text>
        </View>
      </View>
      <View style={s.heroBars}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[s.heroBar, i <= Math.min(3 - ahead, 3) && s.heroBarOn]} />
        ))}
      </View>
      <Pressable onPress={() => { setQueueOpen(ticketRow); openOverlay(true); }}
        style={({ pressed }) => [s.heroBtn, pressed && s.pressed]}>
        <Text style={s.heroBtnText}>VIEW LIVE QUEUE</Text>
      </Pressable>
    </View>
  ) : null;

  const banner = filter === 'completed' && awaitingReview > 0 ? (
    <View style={s.reviewBanner}>
      <Ionicons name="star" size={16} color={colors.accent} />
      <Text style={s.reviewBannerText}>
        {awaitingReview} visit{awaitingReview > 1 ? 's' : ''} waiting for your review
      </Text>
    </View>
  ) : null;

  return (
    <View style={s.screen}>
      <Display size={24} style={s.title}>My bookings</Display>
      <View style={s.tabsRow}>
        {(['upcoming', 'completed', 'cancelled'] as Filter[]).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={s.tabBtn}
            accessibilityRole="tab" accessibilityState={{ selected: filter === f }}>
            <Text style={[s.tabText, filter === f && s.tabTextActive]}>{TAB_LABEL[f]}</Text>
            {filter === f && <View style={s.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<>{hero}{banner}</>}
        ListFooterComponent={filter === 'upcoming'
          ? <AsksSection asks={asks} onCancel={async (id) => {
            const { error } = await supabase.rpc('cancel_ask', { p_id: id });
            if (error) return Alert.alert('Could not cancel that', error.message);
            load();
          }} />
          : null}
        ListEmptyComponent={
          <View style={s.emptyWrap}>
            <View style={s.emptyCircle}>
              <Ionicons name="calendar-outline" size={34} color={colors.textTertiary} />
            </View>
            <Display size={19} style={s.emptyTitle}>No {filter} bookings</Display>
            <Text style={s.emptyText}>
              When you book a chair, it shows up here with its ticket and receipt.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          if (filter === 'upcoming') {
            return item.status === 'pending'
              ? <PendingCard row={item} onOpen={() => setDetail({ id: item.id })} />
              : <ConfirmedCard row={item}
                  onOpen={() => setDetail({ id: item.id })}
                  onCancel={() => setDetail({ id: item.id, initial: 'cancel' })}
                  onReschedule={() => setDetail({ id: item.id, initial: 'reschedule' })} />;
          }
          if (filter === 'completed') {
            return <CompletedCard row={item} rating={rated.get(item.id) ?? null}
              onReceipt={() => { setReceipt(item); openOverlay(true); }}
              onRate={() => setReview(item)} onRebook={onRebook} />;
          }
          return <CancelledCard row={item} customerId={customerId} onRebook={onRebook} />;
        }}
      />

      <BookingDetailSheet bookingId={detail?.id ?? ''} myId={customerId} visible={!!detail}
        initial={detail?.initial} onClose={() => { setDetail(null); load(); }} />

      {/* 5a — the review, over the list */}
      <ReviewSheet booking={review} onClose={() => setReview(null)}
        onDone={() => { setReview(null); load(); }} />
    </View>
  );
}

// ---- 6a ------------------------------------------------------------------
function ConfirmedCard({ row, onOpen, onCancel, onReschedule }: {
  row: Row; onOpen: () => void; onCancel: () => void; onReschedule: () => void;
}) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [s.card, pressed && s.pressed]}>
      <View style={s.chipRow}>
        <Chip text="CONFIRMED" tone="ink" />
        {multi(row)
          ? <Chip text={`${(row.bundle?.name ?? 'BUNDLE').toUpperCase()} · ${row.booking_services.length} SERVICES`} tone="accent" />
          : !!row.services?.name && <Chip text={row.services.name.toUpperCase()} tone="accent" />}
      </View>
      <View style={s.bodyRow}>
        <BookingPhoto barberId={row.barbers?.id} size={80} />
        <View style={s.grow}>
          <Text style={s.salon} numberOfLines={1}>{row.barbers?.salon?.name ?? 'Salon'}</Text>
          <View style={s.metaLine}>
            <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
            <Text style={s.meta} numberOfLines={1}>{row.barbers?.salon?.address ?? 'Tangier'}</Text>
          </View>
          <View style={s.metaLine}>
            <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
            <Text style={s.meta}>
              {minsOf(row)} Mins · with {firstName(row.barbers?.profiles?.full_name)}
              {' '}· {dh(row.price_cents)} DH
            </Text>
          </View>
        </View>
      </View>
      <ServiceList row={row} />
      <View style={s.idRow}>
        <View>
          <Text style={s.idLabel}>BOOKING ID</Text>
          <Text style={s.idValue}>{shortId(row.id)}</Text>
        </View>
        {row.deposit_cents > 0 && (
          <View style={s.right}>
            <Text style={s.idLabel}>DEPOSIT PAID</Text>
            <Text style={s.idValue}>{dh(row.deposit_cents)} DH / {dh(row.price_cents)} DH</Text>
          </View>
        )}
        <View style={s.right}>
          <Text style={s.idLabel}>DATE & TIME</Text>
          <Text style={s.idValue}>{stamp(row.starts_at)}</Text>
        </View>
      </View>
      <View style={s.btnRow}>
        <Btn title="CANCEL" onPress={onCancel} />
        <Btn title="RESCHEDULE" dark onPress={onReschedule} />
      </View>
      {/* 34e — a long sitting can't be moved into any old gap; say so before
          they tap Reschedule and find three-quarters of the day refuses.
          ponytail: the mock also names the next day that fits ("There's one on
          Monday") — that needs the slot scan this card doesn't load. */}
      {minsOf(row) > 30 && (
        <View style={s.hardNote}>
          <View style={s.hardIcon}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.star} />
          </View>
          <View style={s.grow}>
            <Text style={s.hardTitle}>Rescheduling is harder</Text>
            <Text style={s.hardBody}>
              Moving this needs another {Math.ceil(minsOf(row) / 30)}-slot gap in one run.
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

function PendingCard({ row, onOpen }: { row: Row; onOpen: () => void }) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [s.card, pressed && s.pressed]}>
      <View style={s.chipRow}>
        <Chip text="WAITING FOR BARBER" tone="muted" />
        {!!row.services?.name && <Chip text={row.services.name.toUpperCase()} tone="accent" />}
      </View>
      <View style={s.bodyRow}>
        <BookingPhoto barberId={row.barbers?.id} size={64} />
        <View style={s.grow}>
          <Text style={s.salonSm} numberOfLines={1}>{row.barbers?.salon?.name ?? 'Salon'}</Text>
          <View style={s.metaLine}>
            <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
            <Text style={s.meta}>
              {row.services?.duration_min ?? 0} Mins · with {firstName(row.barbers?.profiles?.full_name)}
              {' '}· {dh(row.price_cents)} DH
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

// ---- 6b ------------------------------------------------------------------
function CompletedCard({ row, rating, onReceipt, onRate, onRebook }: {
  row: Row; rating: number | null; onReceipt: () => void; onRate: () => void; onRebook?: () => void;
}) {
  return (
    <View style={s.card}>
      <View style={s.chipRow}>
        <Chip text="COMPLETED" tone="ink" />
        {!!row.services?.name && <Chip text={row.services.name.toUpperCase()} tone="accent" />}
      </View>
      <View style={s.bodyRow}>
        <BookingPhoto barberId={row.barbers?.id} size={80} />
        <View style={s.grow}>
          <Text style={s.salon} numberOfLines={1}>{row.barbers?.salon?.name ?? 'Salon'}</Text>
          <View style={s.metaLine}>
            <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
            <Text style={s.meta}>
              {row.services?.duration_min ?? 0} Mins · with {firstName(row.barbers?.profiles?.full_name)}
            </Text>
          </View>
          <Text style={s.meta}>
            {stamp(row.starts_at)} · <Text style={s.paid}>{dh(row.price_cents)} DH paid</Text>
          </Text>
          {rating != null && (
            <Text style={s.meta}>
              <Text style={s.stars}>{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</Text> You rated {rating}
            </Text>
          )}
        </View>
      </View>
      <View style={[s.btnRow, s.btnRowTop]}>
        <Btn title="RECEIPT" onPress={onReceipt} />
        {rating == null
          ? <Btn title="RATE VISIT" accent icon="star" onPress={onRate} />
          : <Btn title="BOOK AGAIN" dark onPress={() => onRebook?.()} />}
      </View>
    </View>
  );
}

// ---- 6c ------------------------------------------------------------------
function CancelledCard({ row, customerId, onRebook }: {
  row: Row; customerId: string; onRebook?: () => void;
}) {
  const byBarber = !!row.cancelled_by && row.cancelled_by !== customerId;
  const noShow = row.status === 'no_show';
  const dep = row.deposit_cents;
  return (
    <View style={s.card}>
      <View style={s.chipRow}>
        <Chip text={noShow ? 'NO-SHOW' : byBarber ? 'CANCELLED BY BARBER' : 'YOU CANCELLED'}
          tone={byBarber ? 'red' : 'muted'} />
      </View>
      <View style={s.bodyRow}>
        <BookingPhoto barberId={row.barbers?.id} size={80} dim />
        <View style={s.grow}>
          <Text style={s.salonOff} numberOfLines={1}>{row.barbers?.salon?.name ?? 'Salon'}</Text>
          <Text style={s.meta}>
            {row.services?.name ?? 'Service'} · with {firstName(row.barbers?.profiles?.full_name)}
          </Text>
          <Text style={[s.meta, s.struck]}>{stamp(row.starts_at)} · {dh(row.price_cents)} DH</Text>
        </View>
      </View>

      {!!row.cancel_reason && (
        <View style={s.reasonBox}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary}
            style={s.reasonIcon} />
          <Text style={s.reasonText}>
            {firstName(row.barbers?.profiles?.full_name)} cancelled — {row.cancel_reason}
          </Text>
        </View>
      )}

      {dep > 0 && (byBarber ? (
        <View style={s.refundBox}>
          <Ionicons name="checkmark" size={14} color="#16A34A" />
          <Text style={s.refundText}>Deposit refunded to your wallet</Text>
          <Text style={s.refundAmount}>+{dh(dep)} DH</Text>
        </View>
      ) : (
        <View style={s.keptBox}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
          <Text style={s.keptText}>Deposit not refunded — you cancelled</Text>
          <Text style={s.keptAmount}>{dh(dep)} DH</Text>
        </View>
      ))}

      <View style={s.btnRow}>
        {byBarber && <Btn title="FIND ANOTHER" onPress={() => onRebook?.()} />}
        <Btn title="REBOOK" dark onPress={() => onRebook?.()} />
      </View>
    </View>
  );
}

// ---- receipt --------------------------------------------------------------
function Receipt({ booking, onBack }: { booking: Row; onBack: () => void }) {
  const d = new Date(booking.starts_at);
  const dep = booking.deposit_cents;
  const lines: [string, string][] = [
    ['Booking ID', shortId(booking.id)],
    ['Salon', booking.barbers?.salon?.name ?? '—'],
    ['Barber', booking.barbers?.profiles?.full_name ?? '—'],
    ['Service', booking.services?.name ?? '—'],
    ['Date', d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })],
    ['Time', d.toTimeString().slice(0, 5)],
    ['Duration', `${booking.services?.duration_min ?? 0} min`],
  ];
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.receiptContent}>
      <ScreenHeader title="Receipt" onBack={onBack} />
      <View style={s.receiptCard}>
        <Ionicons name="checkmark-circle" size={48} color={colors.accent} style={s.receiptIcon} />
        <Text style={s.receiptTitle}>Booking {booking.status}</Text>
        {/* ponytail: no QR — barbers have no scanner; add when a check-in flow exists */}
        {lines.map(([k, v]) => (
          <View key={k} style={s.receiptRow}>
            <Text style={s.receiptKey}>{k}</Text>
            <Text style={s.receiptVal}>{v}</Text>
          </View>
        ))}
        <View style={s.receiptDivider} />
        {dep > 0 && (
          <View style={s.receiptRow}>
            <Text style={s.receiptKey}>Deposit paid from wallet</Text>
            <Text style={s.receiptVal}>{dh(dep)} DH</Text>
          </View>
        )}
        <View style={s.receiptRow}>
          <Text style={s.receiptTotalKey}>{dep > 0 ? 'Due at the shop' : 'To pay at the shop'}</Text>
          <Text style={s.receiptTotalVal}>{dh(booking.price_cents - dep)} DH</Text>
        </View>
      </View>
    </ScrollView>
  );
}

// ---- 5a · review as a sheet ----------------------------------------------
const RATING_WORD = ['', 'Poor', 'Okay', 'Good', 'Very good', 'Excellent'];
const REVIEW_TAGS = ['Clean fade', 'On time', 'Friendly', 'Great value', 'Clean shop'];

function ReviewSheet({ booking, onClose, onDone }: {
  booking: Row | null; onClose: () => void; onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (booking) { setRating(0); setTags(new Set()); setComment(''); setSent(false); }
  }, [booking?.id]);

  if (!booking) return null;
  const name = booking.barbers?.profiles?.full_name ?? 'your barber';
  const d = new Date(booking.starts_at);

  async function submit() {
    if (rating === 0) return Alert.alert('Pick a rating', 'Tap the stars first.');
    setBusy(true);
    // ponytail: tags fold into the comment — no tags column until reviews need filtering by tag
    const body = [[...tags].join(' · '), comment.trim()].filter(Boolean).join(' — ');
    const { error } = await supabase.from('reviews')
      .insert({ booking_id: booking!.id, rating, comment: body || null });
    setBusy(false);
    if (error) return Alert.alert('Could not submit', error.message);
    setSent(true);
  }

  // 4b — the thank-you takes the whole frame once the review is in
  if (sent) {
    return (
      <Modal visible transparent={false} animationType="fade" onRequestClose={onDone}>
        <View style={[s.screen, s.sentScreen]}>
          <View style={s.sentBadge}><Ionicons name="star" size={30} color={colors.accent} /></View>
          <Display size={28}>Shukran!</Display>
          <Text style={s.sentSub}>
            Your {rating}-star review for {firstName(name)} is live. Reviews help the best barbers in
            Tangier get found.
          </Text>
          <View style={s.sentCard}>
            <View style={s.avatar}><Text style={s.avatarText}>{initialsOf(name)}</Text></View>
            <View style={s.grow}>
              <Text style={s.reviewName}>{name}</Text>
              <Text style={s.meta} numberOfLines={1}>
                {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
                {comment.trim() ? ` · “${comment.trim()}”` : ''}
              </Text>
            </View>
          </View>
          <Pressable onPress={onDone} style={({ pressed }) => [s.submitBtn, pressed && s.pressed]}>
            <Text style={s.submitText}>DONE</Text>
          </Pressable>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={s.reviewSheet}>
        <View style={s.grabber} />
        <View style={s.reviewHead}>
          <Text style={s.skip} onPress={onClose}>Skip</Text>
          <Display size={18} style={s.reviewTitle}>Leave a review</Display>
          <Pressable onPress={onClose} hitSlop={8} style={s.reviewClose}>
            <Ionicons name="close" size={16} color={colors.text} />
          </Pressable>
        </View>

        <View style={s.reviewBooking}>
          <View style={s.avatarLg}><Text style={s.avatarText}>{initialsOf(name)}</Text></View>
          <View style={s.grow}>
            <Text style={s.reviewName}>{name}</Text>
            <Text style={s.meta} numberOfLines={1}>
              {booking.services?.name ?? 'Service'} ·{' '}
              {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ·{' '}
              {dh(booking.price_cents)} DH
            </Text>
          </View>
        </View>

        <Text style={s.tapHint}>Tap a star to rate {firstName(name)}</Text>
        <View style={s.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}
              accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
              <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={38}
                color={n <= rating ? colors.text : '#C9C5BB'} />
            </Pressable>
          ))}
        </View>
        {rating > 0 && <Text style={s.ratingWord}>{RATING_WORD[rating]}</Text>}

        <View style={s.tagRow}>
          {REVIEW_TAGS.map((t) => {
            const on = tags.has(t);
            return (
              <Pressable key={t} onPress={() => {
                const next = new Set(tags);
                if (on) next.delete(t); else next.add(t);
                setTags(next);
              }} style={[s.tag, on && s.tagOn]}>
                <Text style={[s.tagText, on && s.tagTextOn]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>

        <Field placeholder="Anything to add? (optional)" multiline value={comment}
          onChangeText={setComment} style={s.commentField} />

        <Pressable onPress={submit} disabled={busy}
          style={({ pressed }) => [s.submitBtn, (pressed || busy) && s.pressed]}>
          <Text style={s.submitText}>SUBMIT REVIEW</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: 66, paddingHorizontal: 20, gap: 14, backgroundColor: colors.surface },
  grow: { flex: 1 },
  right: { alignItems: 'flex-end' },
  pressed: { opacity: 0.75 },
  dimmed: { opacity: 0.55 },

  title: { textAlign: 'center', letterSpacing: 0.72 },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabText: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  tabUnderline: {
    position: 'absolute', bottom: -1, height: 3, width: '50%',
    backgroundColor: colors.accent, borderRadius: 2,
  },
  list: { gap: 14, paddingBottom: TAB_BAR_INSET, paddingTop: 2 },

  // 6a hero
  hero: { backgroundColor: colors.ink, borderRadius: 24, padding: 18, gap: 12, marginBottom: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLive: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
  heroLiveText: { fontSize: 10, letterSpacing: 1.8, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  heroTicket: {
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999,
    paddingVertical: 5, paddingHorizontal: 10,
  },
  heroTicketText: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: '#fff' },
  heroMid: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  heroBig: { fontFamily: serif, fontSize: 30, lineHeight: 32, color: '#fff', textTransform: 'uppercase' },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 6 },
  heroEta: { fontSize: 16, fontWeight: '800', color: '#fff' },
  heroEtaLabel: { fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.5)' },
  heroBars: { flexDirection: 'row', gap: 5 },
  heroBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  heroBarOn: { backgroundColor: colors.accent },
  heroBtn: {
    height: 42, borderRadius: 999, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  heroBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.72, color: colors.text },

  // 6b banner
  reviewBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14,
    backgroundColor: 'rgba(232,68,46,0.08)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14,
  },
  reviewBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: DEEP_RED },

  // cards
  card: { borderRadius: 24, padding: 18, gap: 14, backgroundColor: colors.bg, ...shadow },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  chipAccentBg: { backgroundColor: 'rgba(232,68,46,0.10)' },
  chipRedBg: { backgroundColor: 'rgba(232,68,46,0.10)' },
  chipText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.text },
  chipMuted: { color: colors.textSecondary },
  chipAccent: { color: colors.accent },
  chipRed: { color: DEEP_RED },

  bodyRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  photo: { backgroundColor: colors.surface },
  photoFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  salon: { fontSize: 16, fontWeight: '700', color: colors.text },
  salonSm: { fontSize: 15, fontWeight: '700', color: colors.text },
  salonOff: { fontSize: 16, fontWeight: '700', color: '#5C5C58' },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  meta: { fontSize: 12, color: colors.textSecondary, flexShrink: 1, marginTop: 4 },
  struck: { textDecorationLine: 'line-through' },
  paid: { color: colors.text, fontWeight: '700' },
  stars: { color: colors.text, fontWeight: '700' },

  idRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12,
  },
  idLabel: { fontSize: 10, letterSpacing: 1, fontWeight: '600', color: colors.textTertiary },
  idValue: {
    fontSize: font.small, fontWeight: '700', color: colors.text, marginTop: 3,
    fontVariant: ['tabular-nums'],
  },

  // 34e — the running order inside one booking
  svcList: {
    gap: 9, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 13,
  },
  svcRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  svcNum: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  svcNumText: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  svcName: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.text },
  svcAt: { fontSize: font.tiny, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  hardNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: colors.surface, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
  },
  hardIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(232,161,0,0.16)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  // 36c
  asksWrap: { gap: 10, marginTop: sp(5) },
  asksHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  asksTitle: { fontSize: font.tiny, letterSpacing: 1.65, fontWeight: '700', color: colors.textSecondary },
  askCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, ...shadow,
  },
  askDead: { opacity: 0.6 },
  askIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  askIconDead: { backgroundColor: colors.surface },
  askDay: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  askDayDead: { color: colors.textSecondary },
  askMeta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  askCancel: { fontSize: 12, fontWeight: '600', color: colors.textTertiary },

  hardTitle: { fontSize: font.small, fontWeight: '700', color: colors.text },
  hardBody: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 4 },

  btnRow: { flexDirection: 'row', gap: 10 },
  btnRowTop: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  btn: {
    flex: 1, height: 44, borderRadius: 999, flexDirection: 'row', gap: 6,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDark: { backgroundColor: colors.ink, borderColor: colors.ink },
  btnAccent: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.72, color: '#5C5C58' },
  btnTextOn: { color: '#fff' },

  // 6c boxes
  reasonBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: SUNK, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
  },
  reasonIcon: { marginTop: 1 },
  reasonText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },
  refundBox: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: 'rgba(74,222,128,0.14)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
  },
  refundText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#15803D' },
  refundAmount: { fontSize: font.small, fontWeight: '800', color: '#16A34A', fontVariant: ['tabular-nums'] },
  keptBox: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: SUNK, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
  },
  keptText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },
  keptAmount: { fontSize: font.small, fontWeight: '700', color: colors.textSecondary, fontVariant: ['tabular-nums'] },

  // empty
  emptyWrap: { alignItems: 'center', gap: sp(4), paddingVertical: sp(14) },
  emptyCircle: {
    width: 96, height: 96, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: '#C9C5BB', alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { textAlign: 'center' },
  emptyText: {
    textAlign: 'center', fontSize: font.small, lineHeight: 19,
    color: colors.textSecondary, maxWidth: 250, marginTop: -sp(2),
  },

  // receipt
  receiptContent: { paddingBottom: sp(10) },
  receiptCard: { borderRadius: radius.xl, padding: sp(5), gap: sp(2), backgroundColor: colors.bg, ...shadow },
  receiptIcon: { alignSelf: 'center' },
  receiptTitle: {
    textAlign: 'center', fontFamily: serif, fontSize: font.h2, letterSpacing: 0.5,
    color: colors.text, textTransform: 'uppercase', marginBottom: sp(2),
  },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp(1) },
  receiptKey: { fontSize: font.small, color: colors.textSecondary },
  receiptVal: { fontSize: font.small, fontWeight: '600', color: colors.text },
  receiptDivider: { height: 1, backgroundColor: colors.border, marginVertical: sp(2) },
  receiptTotalKey: { fontSize: font.body, fontWeight: '700', color: colors.text },
  receiptTotalVal: { fontSize: font.body, fontWeight: '700', color: colors.accent },

  // 5a review sheet
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  reviewSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24, paddingBottom: 34, gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  reviewHead: { flexDirection: 'row', alignItems: 'center' },
  skip: { width: 40, fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  reviewTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.54 },
  reviewClose: { width: 40, alignItems: 'flex-end' },
  reviewBooking: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, ...shadow,
  },
  avatar: {
    width: 46, height: 46, borderRadius: 999, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLg: {
    width: 46, height: 46, borderRadius: 999, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  reviewName: { fontSize: 14, fontWeight: '700', color: colors.text },
  tapHint: { textAlign: 'center', fontSize: font.small, color: colors.textSecondary },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: -4 },
  ratingWord: { textAlign: 'center', fontSize: font.small, fontWeight: '700', color: colors.text, marginTop: -6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  tag: { borderRadius: 999, backgroundColor: colors.bg, paddingVertical: 9, paddingHorizontal: 16, ...shadow },
  tagOn: { backgroundColor: colors.ink },
  tagText: { fontSize: 12, fontWeight: '600', color: '#5C5C58' },
  tagTextOn: { color: '#fff' },
  commentField: { minHeight: 70, textAlignVertical: 'top', paddingTop: 14, borderRadius: 18 },
  submitBtn: {
    height: 54, borderRadius: 999, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  submitText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: '#fff' },

  // 4b
  sentScreen: { justifyContent: 'center', alignItems: 'center', paddingBottom: sp(20), gap: sp(4) },
  sentBadge: {
    width: 72, height: 72, borderRadius: 999, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  sentSub: {
    textAlign: 'center', fontSize: font.small, lineHeight: 20, color: colors.textSecondary, maxWidth: 280,
  },
  sentCard: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3), alignSelf: 'stretch',
    backgroundColor: colors.bg, borderRadius: radius.lg, padding: sp(4.5), ...shadow,
  },
});
