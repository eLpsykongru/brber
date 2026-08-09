import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { daySlots, type Block, type Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { dark as D, inter } from '../theme';
import { Btn, Eyebrow, Ico, Segmented, Sheet, SheetHead, T } from './dark';

// 1c — Quick add (tab-bar +). A walk-in is added straight from here; "Appointment"
// and "Pick…" hand off to the day timeline, which owns arbitrary slot placement.
export type QuickPick = {
  mode: 'now' | 'schedule';
  name?: string;
  serviceId?: string; // client's usual service (most booked)
  preferMin?: number; // client's usual arrival, minutes from midnight
};

type Service = { id: string; name: string; price_cents: number; duration_min: number };
type Range = { starts_at: string; ends_at: string };

const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
const dh = (cents: number) => `${Math.round(cents / 100)} DH`;

export default function QuickAddSheet({ visible, barberId, onClose, onPick }: {
  visible: boolean;
  barberId: string;
  onClose: () => void;
  onPick: (pick: QuickPick) => void;
}) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [slots, setSlots] = useState<Date[]>([]);
  const [usual, setUsual] = useState<Record<string, string>>({}); // lowercased name → service id
  const [mode, setMode] = useState<'walkin' | 'appt'>('walkin');
  const [at, setAt] = useState<Date | null>(null);
  const [name, setName] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMode('walkin'); setName(''); setPickedId(null); setAt(null); setServices(null);
    (async () => {
      const [svc, av, blk, book, hist] = await Promise.all([
        supabase.from('services').select('id, name, price_cents, duration_min')
          .eq('barber_id', barberId).eq('is_active', true).order('created_at'),
        supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
        supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', barberId),
        supabase.from('bookings').select('starts_at, ends_at').eq('barber_id', barberId)
          .in('status', ['pending', 'confirmed'])
          .gte('starts_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
        supabase.from('bookings')
          .select('service_id, walk_in_name, customer:profiles!customer_id(full_name)')
          .eq('barber_id', barberId).eq('status', 'confirmed')
          .order('starts_at', { ascending: false }).limit(200),
      ]);
      const list = (svc.data ?? []) as Service[];
      setServices(list);
      setPickedId(list[0]?.id ?? null);
      const free = daySlots(new Date(), 30, (av.data ?? []) as Window[],
        (book.data ?? []) as Range[], [], (blk.data ?? []) as Block[])
        .filter((sl) => sl.status === 'free').map((sl) => sl.time);
      setSlots(free);
      setAt(free[0] ?? null);
      const seen: Record<string, string> = {};
      for (const r of (hist.data ?? []) as any[]) {
        const who = (r.walk_in_name ?? r.customer?.full_name ?? '').trim().toLowerCase();
        if (who && r.service_id && !seen[who]) seen[who] = r.service_id; // newest wins
      }
      setUsual(seen);
    })();
  }, [visible, barberId]);

  const picked = services?.find((x) => x.id === pickedId) ?? null;
  const usualId = usual[name.trim().toLowerCase()] ?? null;

  async function add() {
    if (!picked || !at) return;
    setBusy(true);
    const { error } = await supabase.from('bookings').insert({
      customer_id: barberId, barber_id: barberId, service_id: picked.id,
      starts_at: at.toISOString(), walk_in_name: name.trim() || null,
    });
    setBusy(false);
    if (error) {
      const msg = error.message.includes('no_double_booking')
        ? 'That time overlaps another booking.' : error.message;
      return Alert.alert('Could not add', msg);
    }
    onPick({ mode: 'now' }); // parent closes the sheet and reloads the day
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHead title="Quick add" onClose={onClose} left />

      <Segmented
        items={[{ key: 'walkin', label: 'Walk-in', icon: 'user' },
          { key: 'appt', label: 'Appointment', icon: 'calendar' }]}
        active={mode}
        onChange={(k) => {
          if (k === 'appt') return onPick({ mode: 'schedule' });
          setMode('walkin');
        }} />

      <View style={{ gap: 8 }}>
        <Eyebrow ls={1.4}>STARTS AT</Eyebrow>
        <View style={s.chipRow}>
          {slots.slice(0, 2).map((t, i) => {
            const on = at?.getTime() === t.getTime();
            return (
              <Pressable key={t.toISOString()} onPress={() => setAt(t)} accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [s.slotChip, on && s.slotChipOn, pressed && s.pressed]}>
                <T w={on ? 'b' : 'sb'} size={13} c={on ? '#fff' : D.sub}>
                  {i === 0 ? `Now · ${hhmm(t)}` : hhmm(t)}
                </T>
              </Pressable>
            );
          })}
          <Pressable onPress={() => onPick({ mode: 'schedule', name: name.trim() || undefined })}
            accessibilityRole="button" accessibilityLabel="Pick a time on the timeline"
            style={({ pressed }) => [s.slotChip, pressed && s.pressed]}>
            <T w="sb" size={13} c={D.sub}>Pick…</T>
          </Pressable>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow ls={1.4}>CLIENT NAME</Eyebrow>
        <View style={s.nameField}>
          <Ico name="user" size={16} color={D.sub} />
          <TextInput value={name} onChangeText={setName} style={s.nameInput}
            placeholder="Optional — shows as Walk-in" placeholderTextColor={D.sub}
            accessibilityLabel="Client name" />
        </View>
      </View>

      <View style={{ gap: 9 }}>
        <Eyebrow ls={1.4}>SERVICE · TAP TO PICK</Eyebrow>
        {services === null && <ActivityIndicator color={D.accent} accessibilityLabel="Loading services" />}
        {services?.length === 0 && (
          <T size={12} c={D.sub}>No active services — add one in My services first.</T>
        )}
        {services?.map((svc) => {
          const on = svc.id === pickedId;
          return (
            <Pressable key={svc.id} onPress={() => setPickedId(svc.id)} accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [s.svcRow, on && s.svcRowOn, pressed && s.pressed]}>
              <View style={s.grow}>
                <T w="b" size={14}>{svc.name}</T>
                <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                  {svc.duration_min} min{svc.id === usualId ? ' · usual for this client' : ''}
                </T>
              </View>
              <T w="eb" size={15} style={s.tnum}>{dh(svc.price_cents)}</T>
            </Pressable>
          );
        })}
      </View>

      <Btn title={picked && at ? `ADD TO THE CHAIR · ${dh(picked.price_cents)}` : 'NO FREE SLOT TODAY'}
        height={52} onPress={add}
        style={!picked || !at || busy ? { opacity: 0.5 } : undefined} />
    </Sheet>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  tnum: { fontVariant: ['tabular-nums'] },

  chipRow: { flexDirection: 'row', gap: 8 },
  slotChip: {
    flex: 1, height: 44, borderRadius: 14, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  slotChipOn: { backgroundColor: D.accent },

  nameField: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.card2,
    borderRadius: 14, height: 48, paddingHorizontal: 16,
  },
  nameInput: { flex: 1, fontFamily: inter.r, fontSize: 14, color: D.text, padding: 0 },

  svcRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 16, padding: 14, paddingHorizontal: 16,
  },
  svcRowOn: { borderWidth: 2, borderColor: D.accent },
});
