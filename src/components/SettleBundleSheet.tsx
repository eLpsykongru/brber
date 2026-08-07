import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { dark, font, radius, serif } from '../theme';

// 34f of "Customer App 3.dc.html" — "he skipped the shave". The barber ticks off
// what he actually did before the booking is marked done, because a bundle price
// is a discount for taking the whole thing: take two of three and you pay the
// two at list, and the saving goes. The arithmetic lives in 0047's
// `settle_booking_services` — this sheet only shows it and then completes.
//
// It loads its own rows, so the caller doesn't need to know whether a booking is
// a bundle. One service → nothing to ask, it settles and completes silently.

type Item = {
  service_id: string; price_cents: number; duration_min: number; sort: number;
  services: { name: string } | null;
};

const dh = (cents: number) => (cents / 100).toFixed(0);
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);

export default function SettleBundleSheet({ booking, onDone, onClose }: {
  /** the booking being completed, or null when the sheet is closed */
  booking: { id: string; starts_at: string; client: string } | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [bundle, setBundle] = useState<{ name: string; price_cents: number } | null>(null);
  const [depositCents, setDepositCents] = useState(0);
  const [busy, setBusy] = useState(false);

  const finish = useCallback(async (ids: string[]) => {
    if (!booking) return;
    setBusy(true);
    const settle = await supabase.rpc('settle_booking_services',
      { p_booking: booking.id, p_done: ids });
    if (settle.error) { setBusy(false); return Alert.alert('Could not settle', settle.error.message); }
    const adv = await supabase.rpc('advance_booking', { p_booking: booking.id, p_stage: 'complete' });
    setBusy(false);
    if (adv.error) return Alert.alert('Could not complete', adv.error.message);
    onDone();
  }, [booking, onDone]);

  useEffect(() => {
    if (!booking) { setItems(null); return; }
    (async () => {
      const { data } = await supabase.from('bookings')
        .select('deposit_cents, bundle:bundles!bundle_id(name, price_cents),'
          + ' booking_services(service_id, price_cents, duration_min, sort, services(name))')
        .eq('id', booking.id).single();
      const rows = ((data as any)?.booking_services ?? []) as Item[];
      setDepositCents((data as any)?.deposit_cents ?? 0);
      setBundle((data as any)?.bundle ?? null);
      const sorted = [...rows].sort((a, b) => a.sort - b.sort);
      setDone(sorted.map((i) => i.service_id));   // everything done is the default
      // nothing to ask about a single service — settle it and get out of the way
      if (sorted.length < 2) { finish(sorted.map((i) => i.service_id)); setItems([]); return; }
      setItems(sorted);
    })();
  }, [booking, finish]);

  if (!booking || !items || items.length < 2) return null;

  const doneItems = items.filter((i) => done.includes(i.service_id));
  const skipped = items.filter((i) => !done.includes(i.service_id));
  const partsCents = doneItems.reduce((a, i) => a + i.price_cents, 0);
  const broken = !!bundle && skipped.length > 0;
  const price = bundle && !broken ? bundle.price_cents : partsCents;
  const collect = Math.max(price - depositCents, 0);
  const freedMin = skipped.reduce((a, i) => a + i.duration_min, 0);
  const listCents = items.reduce((a, i) => a + i.price_cents, 0);
  const savingCents = bundle ? Math.max(listCents - bundle.price_cents, 0) : 0;

  const start = new Date(booking.starts_at);
  const totalMin = items.reduce((a, i) => a + i.duration_min, 0);
  const initials = booking.client.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  function toggle(id: string) {
    setDone((xs) => xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>
        <View style={s.sheet}>
          <View style={s.grabber} />

          <View style={s.head}>
            <View style={s.avatar}><Text style={s.avatarText}>{initials || '?'}</Text></View>
            <View style={s.grow}>
              <Text style={s.name} numberOfLines={1}>{booking.client}</Text>
              <Text style={s.sub}>
                {bundle ? `${bundle.name} · ` : ''}{hhmm(start)} – {hhmm(new Date(start.getTime() + totalMin * 60_000))} · {totalMin} min
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={s.closeBtn}>
              <Ionicons name="close" size={17} color={dark.text} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
            <Text style={s.eyebrow}>TICK OFF WHAT YOU DID</Text>
            <View style={s.list}>
              {items.map((i) => {
                const on = done.includes(i.service_id);
                return (
                  <Pressable key={i.service_id} onPress={() => toggle(i.service_id)}
                    style={[s.row, !on && s.rowOff]}>
                    <View style={[s.box, on && s.boxOn]}>
                      {on && <Ionicons name="checkmark" size={13} color={dark.bg} />}
                    </View>
                    <Text style={[s.rowName, !on && s.rowNameOff]} numberOfLines={1}>
                      {i.services?.name ?? 'Service'}
                    </Text>
                    <Text style={[s.rowPrice, !on && s.rowPriceOff]}>{dh(i.price_cents)} DH</Text>
                  </Pressable>
                );
              })}
            </View>

            {broken && (
              <View style={s.broken}>
                <View style={s.brokenHead}>
                  <Ionicons name="alert-circle-outline" size={16} color={dark.amber} />
                  <Text style={s.brokenTitle}>BUNDLE BROKEN</Text>
                </View>
                <Text style={s.brokenBody}>
                  {doneItems.length} of {items.length} done, so it's charged as
                  {' '}{doneItems.length === 1 ? 'a single service' : `${doneItems.length} separate services`}.
                  {' '}The {dh(savingCents)} DH bundle saving doesn't apply.
                </Text>
                <View style={s.brokenRows}>
                  <View style={s.bRow}>
                    <Text style={s.bK}>Was, as a bundle</Text>
                    <Text style={s.bWas}>{dh(bundle!.price_cents)} DH</Text>
                  </View>
                  <View style={s.bRow}>
                    <Text style={s.bK}>
                      Now, {doneItems.length} service{doneItems.length === 1 ? '' : 's'}
                    </Text>
                    <Text style={s.bV}>{dh(partsCents)} DH</Text>
                  </View>
                  {depositCents > 0 && (
                    <View style={s.bRow}>
                      <Text style={s.bK}>Deposit already paid</Text>
                      <Text style={s.bV}>− {dh(depositCents)} DH</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            <View style={s.collect}>
              <Text style={s.collectK}>Collect in cash</Text>
              <Text style={s.collectV}>{dh(collect)} DH</Text>
            </View>
          </ScrollView>

          <Pressable disabled={busy} onPress={() => finish(done)}
            style={({ pressed }) => [s.cta, busy && s.ctaOff, pressed && s.pressed]}>
            {busy ? <ActivityIndicator color={dark.bg} /> : (
              <>
                <Ionicons name="checkmark-circle" size={17} color={dark.bg} />
                <Text style={s.ctaText}>MARK DONE · COLLECT {dh(collect)} DH</Text>
              </>
            )}
          </Pressable>
          {freedMin > 0 && (
            <Text style={s.freed}>
              Freed {freedMin} min — that time is open again.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
  scrim: { flex: 1, backgroundColor: dark.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: dark.sheet, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingTop: 12, paddingHorizontal: 22, paddingBottom: 34, gap: 13, maxHeight: '92%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: dark.hairline },

  head: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  avatar: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: dark.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '700', color: dark.accent },
  name: { fontSize: 16, fontWeight: '700', color: dark.text },
  sub: { fontSize: font.tiny, color: dark.sub, marginTop: 3 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: dark.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  body: { gap: 13, paddingBottom: 4 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: dark.sub },
  list: { gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: dark.card,
    borderRadius: 14, paddingHorizontal: 15, paddingVertical: 13,
  },
  rowOff: { opacity: 0.55 },
  box: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: dark.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: dark.green, borderColor: dark.green },
  rowName: { flex: 1, fontSize: 13.5, fontWeight: '700', color: dark.text },
  rowNameOff: { fontWeight: '600', color: dark.sub },
  rowPrice: { fontSize: font.small, fontWeight: '700', color: dark.text },
  rowPriceOff: { color: dark.sub, textDecorationLine: 'line-through' },

  broken: {
    backgroundColor: dark.amberSoft12, borderWidth: 1, borderColor: dark.amberLine,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 15, gap: 11,
  },
  brokenHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brokenTitle: { fontSize: font.tiny, letterSpacing: 1.3, fontWeight: '700', color: dark.amber },
  brokenBody: { fontSize: 12.5, lineHeight: 19, color: dark.textDim },
  brokenRows: {
    gap: 9, borderTopWidth: 1, borderTopColor: 'rgba(232,161,0,0.2)', paddingTop: 12,
  },
  bRow: { flexDirection: 'row', justifyContent: 'space-between' },
  bK: { fontSize: 12.5, color: dark.sub },
  bWas: { fontSize: 12.5, color: dark.sub, textDecorationLine: 'line-through' },
  bV: { fontSize: 12.5, fontWeight: '700', color: dark.text },

  collect: {
    backgroundColor: dark.card, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  collectK: { fontSize: font.small, fontWeight: '700', color: dark.text },
  collectV: { fontFamily: serif, fontSize: 26, color: dark.accent },

  cta: {
    height: 54, borderRadius: radius.pill, backgroundColor: dark.green,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontSize: font.small, fontWeight: '800', letterSpacing: 0.6, color: dark.bg },
  freed: { textAlign: 'center', fontSize: font.tiny, color: dark.sub },
});
