import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import type { Specialist } from '../types';
import { Chip, PillButton, Stars } from './ui';
import SlotPicker from './SlotPicker';

type SalonLike = { id: string; name: string; address: string | null; barbers: Specialist[] };
type Step = 'service' | 'barber' | 'time' | 'summary';
const SCREEN_H = Dimensions.get('window').height;

// distinct active service names across the salon, with price range
function serviceMenu(salon: SalonLike) {
  const byName = new Map<string, { name: string; min: number; max: number; category: string }>();
  for (const b of salon.barbers) {
    for (const sv of b.services) {
      if (!sv.is_active) continue;
      const e = byName.get(sv.name);
      if (e) { e.min = Math.min(e.min, sv.price_cents); e.max = Math.max(e.max, sv.price_cents); }
      else byName.set(sv.name, { name: sv.name, min: sv.price_cents, max: sv.price_cents, category: sv.category ?? 'Hair Services' });
    }
  }
  return [...byName.values()];
}

export default function BookingSheet({ visible, salon, onClose, onBooked }: {
  visible: boolean; salon: SalonLike; onClose: () => void; onBooked: () => void;
}) {
  const [step, setStep] = useState<Step>('service');
  const [mode, setMode] = useState<'service' | 'package'>('service');
  const [serviceName, setServiceName] = useState<string | null>(null);
  const [barber, setBarber] = useState<Specialist | null>(null);
  const [time, setTime] = useState<Date | null>(null);
  const [me, setMe] = useState<{ name: string | null; phone: string | null; email: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const translateY = useRef(new Animated.Value(SCREEN_H)).current;

  useEffect(() => {
    if (visible) {
      // reset the wizard each open
      setStep('service'); setMode('service'); setServiceName(null); setBarber(null); setTime(null);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      supabase.auth.getUser().then(async ({ data }) => {
        const uid = data.user?.id;
        const email = data.user?.email ?? null;
        if (!uid) return;
        const { data: p } = await supabase.from('profiles').select('full_name, phone').eq('id', uid).single();
        setMe({ name: p?.full_name ?? null, phone: p?.phone ?? null, email });
      });
    } else {
      translateY.setValue(SCREEN_H);
    }
  }, [visible]);

  function close() {
    Animated.timing(translateY, { toValue: SCREEN_H, duration: 180, useNativeDriver: true }).start(onClose);
  }

  // drag the handle down to dismiss
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6,
    onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 120) close();
      else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    },
  })).current;

  const menu = serviceMenu(salon);
  const offeringBarbers = serviceName
    ? salon.barbers.filter((b) => b.services.some((sv) => sv.is_active && sv.name === serviceName))
    : [];
  const svc = barber?.services.find((sv) => sv.is_active && sv.name === serviceName) ?? null;

  async function confirm() {
    if (!barber || !svc || !time) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('bookings').insert({
      customer_id: auth.user!.id, barber_id: barber.id, service_id: svc.id, starts_at: time.toISOString(),
    });
    setBusy(false);
    if (error) return Alert.alert('Could not book', error.message);
    Alert.alert('Request sent!', 'The barber will confirm your booking shortly. Pay at the shop.');
    onBooked();
    close();
  }

  const STEP_TITLE: Record<Step, string> = {
    service: 'Choose a service', barber: 'Choose a specialist', time: 'Pick a time', summary: 'Appointment overview',
  };
  const stepIndex = ['service', 'barber', 'time', 'summary'].indexOf(step);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={close} />
      <Animated.View style={[s.sheet, { transform: [{ translateY }] }]}>
        <View {...pan.panHandlers} style={s.handleZone}>
          <View style={s.handle} />
          <View style={s.headRow}>
            {step !== 'service'
              ? <Pressable onPress={() => setStep(['service', 'barber', 'time', 'summary'][stepIndex - 1] as Step)}
                  hitSlop={8} style={s.headBtn}><Ionicons name="chevron-back" size={20} color={colors.text} /></Pressable>
              : <View style={s.headBtn} />}
            <Text style={s.headTitle}>{STEP_TITLE[step]}</Text>
            <Pressable onPress={close} hitSlop={8} style={s.headBtn}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <View style={s.progress}>
            {[0, 1, 2, 3].map((i) => <View key={i} style={[s.dot, i <= stepIndex && s.dotActive]} />)}
          </View>
        </View>

        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          {/* STEP 1 — service or package */}
          {step === 'service' && (
            <>
              <View style={s.modeRow}>
                <Chip label="Services" active={mode === 'service'} onPress={() => setMode('service')} />
                <Chip label="Packages" active={mode === 'package'} onPress={() => setMode('package')} />
              </View>
              {mode === 'package' ? (
                // TODO(backlog): packages need their own table + booking mapping
                <Text style={s.note}>Packages are coming soon.</Text>
              ) : menu.length === 0 ? (
                <Text style={s.note}>No services listed yet.</Text>
              ) : menu.map((m) => (
                <Pressable key={m.name} onPress={() => { setServiceName(m.name); setBarber(null); setTime(null); setStep('barber'); }}
                  style={({ pressed }) => [s.optRow, pressed && s.pressed]}>
                  <View style={s.grow}>
                    <Text style={s.optName}>{m.name}</Text>
                    <Text style={s.optMeta}>{m.category}</Text>
                  </View>
                  <Text style={s.optPrice}>
                    {m.min === m.max ? `${(m.min / 100).toFixed(0)}` : `${(m.min / 100).toFixed(0)}–${(m.max / 100).toFixed(0)}`} DH
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </Pressable>
              ))}
            </>
          )}

          {/* STEP 2 — barber */}
          {step === 'barber' && (
            offeringBarbers.map((b) => {
              const a = b.reviews.length ? b.reviews.reduce((n, r) => n + r.rating, 0) / b.reviews.length : null;
              const price = b.services.find((sv) => sv.name === serviceName)?.price_cents;
              return (
                <Pressable key={b.id} onPress={() => { setBarber(b); setTime(null); setStep('time'); }}
                  style={({ pressed }) => [s.optRow, pressed && s.pressed]}>
                  <View style={[s.avatar, s.avatarFallback]}>
                    <Text style={s.avatarText}>
                      {(b.profiles?.full_name ?? 'B').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </Text>
                  </View>
                  <View style={s.grow}>
                    <Text style={s.optName}>{b.profiles?.full_name ?? 'Barber'}</Text>
                    <Text style={s.optMeta}>{b.specialty ?? 'Barber'}</Text>
                  </View>
                  <View style={s.barberRight}>
                    {a != null ? <Stars rating={a} /> : <Text style={s.optMeta}>New</Text>}
                    {price != null && <Text style={s.optPrice}>{(price / 100).toFixed(0)} DH</Text>}
                  </View>
                </Pressable>
              );
            })
          )}

          {/* STEP 3 — time */}
          {step === 'time' && barber && svc && (
            <SlotPicker barberId={barber.id} durationMin={svc.duration_min} selected={time} onSelect={setTime} />
          )}

          {/* STEP 4 — summary */}
          {step === 'summary' && (
            <>
              <SummaryCard label="Salon">
                <Text style={s.sumTitle}>{salon.name}</Text>
                <Text style={s.optMeta}>{salon.address}</Text>
              </SummaryCard>
              <SummaryCard label="Service" onEdit={() => setStep('service')}>
                <View style={s.sumLine}>
                  <Text style={s.sumText}>{serviceName}</Text>
                  <Text style={s.sumText}>{svc ? `${(svc.price_cents / 100).toFixed(0)} DH` : ''}</Text>
                </View>
                <Text style={s.optMeta}>{svc?.duration_min} min · paid at the shop</Text>
              </SummaryCard>
              <SummaryCard label="Specialist" onEdit={() => setStep('barber')}>
                <Text style={s.sumText}>{barber?.profiles?.full_name}</Text>
                <Text style={s.optMeta}>{barber?.specialty ?? 'Barber'}</Text>
              </SummaryCard>
              <SummaryCard label="When" onEdit={() => setStep('time')}>
                <Text style={s.sumText}>
                  {time?.toDateString()} · {time?.toTimeString().slice(0, 5)}
                </Text>
              </SummaryCard>
              <SummaryCard label="Your details">
                <Text style={s.sumText}>{me?.name ?? '—'}</Text>
                <Text style={s.optMeta}>{me?.phone ?? ''}{me?.email ? `  ·  ${me.email}` : ''}</Text>
              </SummaryCard>
            </>
          )}
        </ScrollView>

        {/* footer CTA */}
        {step === 'time' && (
          <View style={s.footer}>
            <PillButton title={time ? 'Review booking' : 'Select a time'}
              disabled={!time} onPress={() => setStep('summary')} />
          </View>
        )}
        {step === 'summary' && (
          <View style={s.footer}>
            <PillButton title="Confirm booking" loading={busy} onPress={confirm} />
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

function SummaryCard({ label, onEdit, children }: { label: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <View style={s.sumCard}>
      <View style={s.sumHead}>
        <Text style={s.sumLabel}>{label}</Text>
        {onEdit && <Pressable onPress={onEdit} hitSlop={6}><Text style={s.sumEdit}>Edit</Text></Pressable>}
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: SCREEN_H * 0.88,
    backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  handleZone: { paddingTop: sp(2.5), paddingHorizontal: sp(5), borderBottomWidth: 1, borderBottomColor: colors.border },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: sp(2) },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '700', color: colors.text },
  progress: { flexDirection: 'row', gap: sp(1.5), justifyContent: 'center', paddingVertical: sp(3) },
  dot: { width: 28, height: 4, borderRadius: 2, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent },

  body: { padding: sp(5), gap: sp(2.5), paddingBottom: sp(10) },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  modeRow: { flexDirection: 'row', gap: sp(2), marginBottom: sp(2) },
  note: { textAlign: 'center', color: colors.textTertiary, marginVertical: sp(6), fontSize: font.body },

  optRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: sp(4), backgroundColor: colors.bg,
  },
  optName: { fontSize: font.body, fontWeight: '700', color: colors.text },
  optMeta: { fontSize: font.small, color: colors.textSecondary },
  optPrice: { fontSize: font.body, fontWeight: '700', color: colors.text },
  barberRight: { alignItems: 'flex-end', gap: 2 },
  avatar: { width: 46, height: 46, borderRadius: radius.pill },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.body, fontWeight: '700', color: colors.accent },

  sumCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: sp(4), gap: 2, backgroundColor: colors.bg,
  },
  sumHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp(1) },
  sumLabel: { fontSize: font.small, fontWeight: '700', color: colors.textSecondary },
  sumEdit: { fontSize: font.small, fontWeight: '600', color: colors.accent },
  sumTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  sumLine: { flexDirection: 'row', justifyContent: 'space-between' },
  sumText: { fontSize: font.body, fontWeight: '600', color: colors.text },

  footer: {
    padding: sp(5), paddingBottom: sp(8), borderTopWidth: 1, borderTopColor: colors.border,
  },
});
