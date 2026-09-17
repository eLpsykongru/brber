import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Eyebrow, Ico, Screen, T, TopBar } from '../components/dark';
import { useAndroidBack } from '../lib/back';
import { dayGaps, dayWords, firstFits, Gap, hhmmOf, offerText } from '../lib/line';
import type { Block, Range, Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// BTD-16 "Come back tomorrow" and BTD-19, its day picker (ADDENDUM-app-first, B10).
// Leaving today's line for another day's book is a conversion, not a move: there is
// nothing of his to drag. 0119 writes an offer and one text with a tap-to-confirm
// link; until he taps, the time stays bookable by anyone else. Only a man with a
// number gets here — the board greys this out on a nameless walk-in.

export type OfferFor = {
  bookingId: string; no: number; name: string; service: string; durationMin: number;
  startsAt: string; waitingSince: string;
};

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const SPAN_DAYS = 14;
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minsFrom = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const minsTo = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
/** "Tomorrow 10:00", "Sat 19 Sep 10:00" */
const said = (at: Date) => {
  const d = dayWords(at);
  return `${d === 'tomorrow' ? 'Tomorrow' : d} ${hhmmOf(at)}`;
};

type Book = {
  windows: Window[]; daysOff: string[]; blocks: Block[]; booked: Range[];
  bufferMin: number; barber: string; shop: string;
};

export default function OfferDayScreen({ barberId, row, onBack, onSent }: {
  barberId: string; row: OfferFor; onBack: () => void; onSent: () => void;
}) {
  const [book, setBook] = useState<Book | null>(null);
  const [picked, setPicked] = useState<Date | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [day, setDay] = useState<Date | null>(null);
  const [dayPick, setDayPick] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const tomorrow = useMemo(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }, []);

  useEffect(() => {
    const until = new Date(tomorrow.getTime() + SPAN_DAYS * 86_400_000);
    (async () => {
      const [av, off, blk, bk, me, who] = await Promise.all([
        supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
        supabase.from('days_off').select('day').eq('barber_id', barberId).gte('day', isoDay(tomorrow)),
        supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', barberId),
        supabase.from('bookings').select('starts_at, ends_at').eq('barber_id', barberId)
          .in('status', ['pending', 'confirmed'])
          .gte('starts_at', tomorrow.toISOString()).lt('starts_at', until.toISOString()),
        supabase.from('barbers').select('buffer_before_min, buffer_after_min, salon_id').eq('id', barberId).single(),
        supabase.from('profiles').select('full_name').eq('id', barberId).single(),
      ]);
      const shop = me.data?.salon_id
        ? (await supabase.from('salons').select('name').eq('id', me.data.salon_id).single()).data?.name
        : null;
      if (av.error || bk.error) {
        Alert.alert('Could not load your days', (av.error ?? bk.error)!.message);
        return;
      }
      const loaded: Book = {
        windows: (av.data ?? []) as Window[],
        daysOff: (off.data ?? []).map((d) => d.day as string),
        blocks: (blk.data ?? []) as Block[],
        booked: (bk.data ?? []) as Range[],
        bufferMin: (me.data?.buffer_before_min ?? 0) + (me.data?.buffer_after_min ?? 0),
        barber: (who.data?.full_name ?? 'Your barber').split(' ')[0],
        shop: shop ?? 'the shop',
      };
      setBook(loaded);
      const first = firstFits(tomorrow, SPAN_DAYS, row.durationMin, loaded.windows, loaded.booked,
        loaded.daysOff, loaded.blocks, loaded.bufferMin)[0];
      if (first) setPicked(first.start);
    })();
  }, [barberId, row.durationMin, tomorrow]);

  // the picker is this screen's own step; leaving the screen is the board's to answer
  useAndroidBack(choosing ? () => setChoosing(false) : null);

  const suggestions = book
    ? firstFits(tomorrow, SPAN_DAYS, row.durationMin, book.windows, book.booked, book.daysOff, book.blocks, book.bufferMin)
    : [];
  const pickedIsOwn = picked && !suggestions.some((g) => g.start.getTime() === picked.getTime());

  async function send() {
    if (!picked || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('queue_offer_day', { p_booking: row.bookingId, p_starts: picked.toISOString() });
    setBusy(false);
    if (error) return Alert.alert('Could not offer that time', error.message);
    Alert.alert('Offer sent', `${row.name} gets one text. ${said(picked)} shows as provisional on your day until he taps — anyone else can still book it.`);
    onSent();
  }

  // ---- BTD-19 · pick another day ---------------------------------------------------------
  if (choosing && book) {
    const days = Array.from({ length: SPAN_DAYS }, (_, i) =>
      new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + i));
    const works = (d: Date) => !book.daysOff.includes(isoDay(d))
      && (book.windows.some((w) => w.weekday === d.getDay())
        || book.blocks.some((b) => b.kind === 'open' && b.day === isoDay(d)));
    const busyDay = (d: Date) => book.booked.some((b) => isoDay(new Date(b.starts_at)) === isoDay(d));
    const shown = day ?? days.find(works) ?? days[0];
    const gaps: Gap[] = dayGaps(shown, row.durationMin, book.windows, book.booked, book.daysOff, book.blocks, book.bufferMin);
    const dayName = shown.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' }).toUpperCase();
    const gapSub = (g: Gap, i: number) => {
      if (!g.fits) return `Only ${g.minutes} min — too short for him`;
      const firstChair = i === 0 && book.windows.some((w) => w.weekday === shown.getDay() && w.start_min === g.startMin);
      if (firstChair) return `First chair · ${g.minutes} min clear`;
      if (i === gaps.length - 1) return `Last gap of the day · ${g.minutes} min`;
      return `${g.minutes} min clear`;
    };

    return (
      <Screen gap={13}>
        <TopBar title={`A time for ${row.name}`} onBack={() => setChoosing(false)} />
        <View style={s.card}>
          <View style={s.grid}>
            {days.slice(0, 7).map((d, i) => (
              <T key={`h${i}`} w="b" size={9.5} c={D.faint} ls={0.6} style={s.gridHead}>{DAY_LETTERS[d.getDay()]}</T>
            ))}
            {days.map((d) => {
              const on = isoDay(d) === isoDay(shown);
              const open = works(d);
              return (
                <Pressable key={isoDay(d)} disabled={!open} onPress={() => { setDay(d); setDayPick(null); }}
                  accessibilityRole="button" accessibilityState={{ selected: on, disabled: !open }}
                  accessibilityLabel={d.toDateString()}
                  style={({ pressed }) => [s.cell, on && s.cellOn, pressed && s.pressed]}>
                  <T w={on ? 'eb' : 'sb'} size={12} c={open ? (on ? '#fff' : D.textDim) : D.muted}>{d.getDate()}</T>
                  {open && <View style={[s.cellDot, { backgroundColor: on ? '#fff' : busyDay(d) ? D.accent : D.green }]} />}
                </Pressable>
              );
            })}
          </View>
          <T size={10.5} c={D.faint} style={s.cardFoot}>
            Days you don't work are dimmed. Dots are how full you already are, not how free.
          </T>
        </View>

        <View style={s.labelRow}>
          <Eyebrow ls={1.5}>{dayName} · YOUR GAPS</Eyebrow>
          <T size={11} c={D.faint}>{row.durationMin} min needed</T>
        </View>
        {gaps.length === 0 && <T size={12.5} c={D.sub}>Nothing free that day.</T>}
        <View style={{ gap: 8 }}>
          {gaps.map((g, i) => {
            const on = dayPick?.getTime() === g.start.getTime();
            return (
              <Pressable key={g.startMin} disabled={!g.fits} onPress={() => setDayPick(g.start)}
                accessibilityRole="button" accessibilityState={{ selected: on, disabled: !g.fits }}
                style={({ pressed }) => [s.gap, !g.fits && s.gapShort, on && s.ring, pressed && s.pressed]}>
                <T w="eb" size={14} c={g.fits ? D.text : D.faint} style={s.gapTime}>{hhmmOf(g.start)}</T>
                <T size={11.5} c={g.fits ? D.sub : D.faint} style={s.grow}>{gapSub(g, i)}</T>
                {on && <View style={s.tick}><Ico name="check" size={11} color="#fff" /></View>}
              </Pressable>
            );
          })}
        </View>

        <View style={s.recessedNote}>
          <Ico name="info" size={14} color={D.sub} />
          <T size={11.5} c={D.sub} style={[s.grow, { lineHeight: 17 }]}>
            Only gaps that fit {row.service} are offered. Picking one brings you back to the message
            before anything is sent.
          </T>
        </View>
        {dayPick && (
          <Pressable onPress={() => { setPicked(dayPick); setChoosing(false); }} accessibilityRole="button"
            style={({ pressed }) => [s.white, pressed && s.pressed]}>
            <T w="eb" size={12.5} c="#111" ls={0.5}>USE {said(dayPick).toUpperCase()}</T>
            <T size={10} c="rgba(0,0,0,0.55)">Back to the text he'll get</T>
          </Pressable>
        )}
      </Screen>
    );
  }

  // ---- BTD-16 · move him off today -------------------------------------------------------
  const option = (at: Date, title: string, sub: string) => {
    const on = picked?.getTime() === at.getTime();
    return (
      <Pressable key={at.getTime()} onPress={() => setPicked(at)} accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={({ pressed }) => [s.option, on && s.ring, pressed && s.pressed]}>
        <View style={s.grow}>
          <T w="b" size={13.5}>{title}</T>
          <T size={11} c={D.sub} style={{ marginTop: 2 }}>{sub}</T>
        </View>
        {on && <View style={s.tick}><Ico name="check" size={11} color="#fff" /></View>}
      </Pressable>
    );
  };

  return (
    <Screen gap={13}>
      <TopBar title="Move him off today" onBack={onBack} />
      <View style={s.who}>
        <View style={s.ticket}><T w="b" size={12} c={D.sub}>{pad(row.no)}</T></View>
        <View style={s.grow}>
          <T w="b" size={14}>{row.name}</T>
          <T size={11} c={D.sub} style={{ marginTop: 2 }}>{row.service} · waiting {minsFrom(row.waitingSince)} min</T>
        </View>
        <T size={11} c={D.sub}>~{minsTo(row.startsAt)} min left</T>
      </View>

      <Eyebrow ls={1.5}>GIVE HIM A TIME INSTEAD</Eyebrow>
      {!book && <ActivityIndicator color={D.accent} accessibilityLabel="Loading your days" />}
      {book && (
        <View style={{ gap: 8 }}>
          {suggestions.map((g, i) => option(g.start, said(g.start),
            i === 0 ? `First time that fits · ${g.minutes} min clear` : `Next one · ${g.minutes} min clear`))}
          {pickedIsOwn && picked && option(picked, said(picked), 'Picked from your days')}
          {suggestions.length === 0 && !picked && (
            <T size={12.5} c={D.sub}>Nothing fits {row.service} in the next two weeks.</T>
          )}
          <Pressable onPress={() => { setChoosing(true); setDay(null); setDayPick(null); }} accessibilityRole="button"
            style={({ pressed }) => [s.option, pressed && s.pressed]}>
            <View style={s.grow}>
              <T w="b" size={13.5}>Pick another day</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>Only gaps long enough for him</T>
            </View>
            <Ico name="chevron-right" size={14} color={D.sub} />
          </Pressable>
        </View>
      )}

      {book && picked && (
        <View style={s.textCard}>
          <Eyebrow ls={1.4}>HE GETS ONE TEXT</Eyebrow>
          <View style={s.bubble}>
            <T size={12} c={D.textDim} style={{ lineHeight: 18.5 }}>{offerText(book.barber, picked, book.shop)}</T>
          </View>
          <T size={11} c={D.faint} style={{ lineHeight: 16.5 }}>
            The same tap as a web name's confirm. Until he taps, {said(picked)} shows provisional on your
            day and stays bookable by anyone else — you haven't lost the slot to a man who may not come.
          </T>
        </View>
      )}

      <View style={{ gap: 8, marginTop: 2 }}>
        <Pressable disabled={!picked || busy} onPress={send} accessibilityRole="button"
          style={({ pressed }) => [s.white, (!picked || busy) && s.off, pressed && s.pressed]}>
          <T w="eb" size={12.5} c="#111" ls={0.5}>
            {picked ? `OFFER HIM ${said(picked).toUpperCase()}` : 'PICK A TIME FIRST'}
          </T>
          <T size={10} c="rgba(0,0,0,0.55)">Takes him out of today's line</T>
        </Pressable>
        <Pressable onPress={onBack} accessibilityRole="button"
          style={({ pressed }) => [s.keep, pressed && s.pressed]}>
          <T w="b" size={12.5} c={D.textDim}>Keep him waiting today</T>
        </Pressable>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.45 },
  ring: { borderWidth: 2, borderColor: D.accent },
  who: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 20, paddingVertical: 15, paddingHorizontal: 16,
  },
  ticket: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  tick: {
    width: 20, height: 20, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  textCard: {
    backgroundColor: D.recessed, borderWidth: 1, borderColor: D.seam, borderRadius: 18,
    paddingVertical: 15, paddingHorizontal: 16, gap: 10,
  },
  bubble: { backgroundColor: D.card, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  white: {
    height: 52, borderRadius: 16, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  keep: {
    height: 46, borderRadius: 16, backgroundColor: D.card, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },

  // BTD-19
  card: { backgroundColor: D.card, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, gap: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
  gridHead: { width: `${100 / 7}%`, textAlign: 'center' },
  cell: {
    width: `${100 / 7}%`, height: 36, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  cellOn: { backgroundColor: D.accent },
  cellDot: { width: 4, height: 4, borderRadius: 999 },
  cardFoot: { borderTopWidth: 1, borderTopColor: D.seam, paddingTop: 9, lineHeight: 15 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  gap: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  gapShort: { backgroundColor: D.recessed, opacity: 0.55 },
  gapTime: { width: 52, fontVariant: ['tabular-nums'] },
  recessedNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.recessed,
    borderWidth: 1, borderColor: D.seam, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 15,
  },
});
