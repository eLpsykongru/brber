import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Display } from './ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, shadow, shadowLg } from '../theme';

// Turn 36 of "Customer App 3.dc.html" — the missing write. Barber 8d ranks
// candidates by evidence of wanting the slot and puts a green ASKED at the top,
// but nothing ever recorded an ask. This is where it comes from: the empty state
// of the slot picker, which is exactly the moment someone wants a day and can't
// have it.
//
// An ask is NOT a hold. Nothing is reserved, nothing is charged, and the barber
// still chooses who gets offered — so the copy never implies a queue position.

const CHIPS: { label: string; min: number | null }[] = [
  { label: 'Any time', min: null },
  { label: 'After 10:00', min: 10 * 60 },
  { label: 'After 15:00', min: 15 * 60 },
];

const dayName = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long' });
const dayShort = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type AskRecord = {
  id: string; day: Date; earliestMin: number | null; anyBarber: boolean;
  barberName: string; salonName: string; serviceName: string; priceCents: number;
  closesMin: number | null;
};

// ---------------------------------------------------------------------------
// 36a — drawn in place of the time grid when the day has nothing left
// ---------------------------------------------------------------------------
export function AskBlock({ salonId, barberId, barberName, salonName, serviceId, serviceName, priceCents, day, coBarbers, closesMin, onAsked }: {
  salonId: string | null; barberId: string; barberName: string; salonName: string | null;
  serviceId: string | null; serviceName: string; priceCents: number;
  day: Date;
  /** other barbers who work that day — drives the "any barber" row's subtitle */
  coBarbers: string[];
  /** shop closing time in minutes, for 36b's "expires when he closes" */
  closesMin: number | null;
  onAsked: (rec: AskRecord) => void;
}) {
  const [earliest, setEarliest] = useState<number | null>(null);
  const [anyBarber, setAnyBarber] = useState(false);
  const [busy, setBusy] = useState(false);

  async function ask() {
    if (!salonId) {
      return Alert.alert('Not available here', 'This shop has no page yet, so asks can\'t be recorded.');
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('ask_for_day', {
      p_salon: salonId, p_date: isoDay(day), p_service: serviceId,
      p_barber: anyBarber ? null : barberId, p_earliest_min: earliest,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not record that', error.message);
    onAsked({
      id: data as string, day, earliestMin: earliest, anyBarber,
      barberName, salonName: salonName ?? 'the shop', serviceName, priceCents, closesMin,
    });
  }

  return (
    <>
      <View style={s.fullBlock}>
        <View style={s.fullCircle}>
          <Ionicons name="calendar-clear-outline" size={22} color="#C9C5BB" />
        </View>
        <Text style={s.fullTitle}>{dayName(day)} is full</Text>
        <Text style={s.fullSub}>
          Every slot with {barberName.split(' ')[0]} is taken. Cancellations happen most mornings.
        </Text>
      </View>

      <View style={s.hero}>
        <View>
          <Text style={s.heroEyebrow}>TELL ME IF IT OPENS</Text>
          <Text style={s.heroBody}>
            If someone cancels, {barberName.split(' ')[0]} can offer you the slot.
            First to take it gets it.
          </Text>
        </View>

        <View style={s.heroSection}>
          <Text style={s.heroLabel}>EARLIEST I CAN COME</Text>
          <View style={s.chipRow}>
            {CHIPS.map((c) => {
              const on = earliest === c.min;
              return (
                <Pressable key={c.label} onPress={() => setEarliest(c.min)}
                  style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipText, on && s.chipTextOn]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {coBarbers.length > 0 && (
          <View style={s.heroSection}>
            <View style={s.anyRow}>
              <View style={s.grow}>
                <Text style={s.anyTitle}>Any barber at {salonName ?? 'the shop'}</Text>
                <Text style={s.anySub}>
                  {coBarbers.slice(0, 2).join(' and ')} work{coBarbers.length === 1 ? 's' : ''} that day too
                </Text>
              </View>
              <Pressable onPress={() => setAnyBarber((v) => !v)} hitSlop={6}
                accessibilityRole="switch" accessibilityState={{ checked: anyBarber }}
                style={[s.toggle, anyBarber && s.toggleOn]}>
                <View style={s.knob} />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      <Pressable onPress={ask} disabled={busy}
        style={({ pressed }) => [s.askBtn, (pressed || busy) && s.pressed]}>
        {busy ? <ActivityIndicator color="#fff" />
          : <Text style={s.askText}>ASK FOR {dayName(day).toUpperCase()}</Text>}
      </Pressable>
      <Text style={s.askFoot}>Not a booking · nothing is held or charged</Text>
    </>
  );
}

// ---------------------------------------------------------------------------
// 36b — what was recorded, said back plainly
// ---------------------------------------------------------------------------
export function AskedSheet({ rec, onDone, onBookOther }: {
  rec: AskRecord | null; onDone: () => void; onBookOther: () => void;
}) {
  if (!rec) return null;
  const closes = rec.closesMin != null
    ? `${String(Math.floor(rec.closesMin / 60)).padStart(2, '0')}:${String(rec.closesMin % 60).padStart(2, '0')}`
    : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDone}>
      <View style={s.scrim}>
        <View style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.center}>
            <View style={s.okCircle}>
              <Ionicons name="checkmark" size={28} color={colors.success} />
            </View>
            <Display size={23} style={s.title}>You're on the list</Display>
            <Text style={s.sub}>
              {rec.barberName.split(' ')[0]} sees you asked. If {dayName(rec.day)} opens up,
              you get a push.
            </Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardEyebrow}>WHAT WE RECORDED</Text>
            <Row k="Day" v={dayShort(rec.day)} />
            <Row k="Earliest" v={rec.earliestMin == null ? 'Any time'
              : `After ${String(Math.floor(rec.earliestMin / 60)).padStart(2, '0')}:00`} />
            <Row k="Barber" v={rec.anyBarber ? `Any at ${rec.salonName}` : `${rec.barberName.split(' ')[0]} only`} />
            <Row k="Service" v={`${rec.serviceName} · ${(rec.priceCents / 100).toFixed(0)} DH`} />
            <View style={s.hr} />
            <Row k="Expires" v={closes ? `${closes} · when he closes` : 'End of that day'} />
          </View>

          {/* the honest part: an ask is not a queue position */}
          <View style={s.warnCard}>
            <View style={s.warnIcon}>
              <Ionicons name="people-outline" size={15} color={colors.textSecondary} />
            </View>
            <View style={s.grow}>
              <Text style={s.warnTitle}>You might not be the only one asked</Text>
              <Text style={s.warnBody}>
                A freed slot can go to a few people at once. Nothing is yours until you tap take.
              </Text>
            </View>
          </View>

          <View style={s.ctas}>
            <Pressable onPress={onBookOther} style={({ pressed }) => [s.ghostBtn, pressed && s.pressed]}>
              <Text style={s.ghostText}>PICK ANOTHER DAY</Text>
            </Pressable>
            <Pressable onPress={onDone} style={({ pressed }) => [s.doneBtn, pressed && s.pressed]}>
              <Text style={s.doneText}>DONE</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowK}>{k}</Text>
      <Text style={s.rowV}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },

  // 36a
  fullBlock: { alignItems: 'center', gap: 9, paddingTop: 14, paddingBottom: 4 },
  fullCircle: {
    width: 56, height: 56, borderRadius: radius.pill, borderWidth: 1.5,
    borderColor: '#C9C5BB', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
  },
  fullTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  fullSub: {
    fontSize: 12.5, color: colors.textSecondary, textAlign: 'center',
    lineHeight: 19, maxWidth: 260,
  },
  hero: { backgroundColor: colors.ink, borderRadius: 22, padding: 18, gap: 14 },
  heroEyebrow: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  heroBody: { fontSize: font.small, color: 'rgba(255,255,255,0.7)', marginTop: 6, lineHeight: 20 },
  heroSection: {
    gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 14,
  },
  heroLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  chipRow: { flexDirection: 'row', gap: 7 },
  chip: {
    flex: 1, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.65)' },
  chipTextOn: { fontWeight: '700', color: '#fff' },
  anyRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  anyTitle: { fontSize: 12.5, fontWeight: '600', color: '#fff' },
  anySub: { fontSize: font.tiny, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  toggle: {
    width: 42, height: 24, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 3, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent, alignItems: 'flex-end' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  askBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  askText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.04, color: '#fff' },
  askFoot: { textAlign: 'center', fontSize: font.tiny, color: colors.textTertiary },

  // 36b
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 22, paddingBottom: 30, gap: 14, ...shadowLg,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  center: { alignItems: 'center', paddingTop: 4 },
  okCircle: {
    width: 60, height: 60, borderRadius: radius.pill, backgroundColor: 'rgba(74,222,128,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { marginTop: 12, textAlign: 'center' },
  sub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 7,
    lineHeight: 20, textAlign: 'center',
  },
  card: {
    backgroundColor: colors.bg, borderRadius: 22, padding: 18, gap: 11, ...shadow,
  },
  cardEyebrow: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: colors.textSecondary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  rowK: { fontSize: font.small, color: colors.textSecondary },
  rowV: { fontSize: font.small, fontWeight: '700', color: colors.text, flexShrink: 1, textAlign: 'right' },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
  warnCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.bg,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, ...shadow,
  },
  warnIcon: {
    width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  warnTitle: { fontSize: font.small, fontWeight: '700', color: colors.text },
  warnBody: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 4 },
  ctas: { flexDirection: 'row', gap: 10 },
  ghostBtn: {
    flex: 1, height: 52, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  ghostText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#5C5C58' },
  doneBtn: {
    flex: 1, height: 52, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  doneText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#fff' },
});
