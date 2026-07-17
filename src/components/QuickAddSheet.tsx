import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, sp } from '../theme';

// Quick add (tab-bar +): walk-in now, schedule later, or book a known client.
export type QuickPick = {
  mode: 'now' | 'schedule';
  name?: string;
  serviceId?: string; // client's usual service (most booked)
  preferMin?: number; // client's usual arrival, minutes from midnight
};

type ClientRow = {
  name: string; avatar: string | null;
  serviceId: string | null; serviceName: string | null; preferMin: number | null;
};

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function QuickAddSheet({ visible, barberId, onClose, onPick }: {
  visible: boolean;
  barberId: string;
  onClose: () => void;
  onPick: (pick: QuickPick) => void;
}) {
  const [step, setStep] = useState<'menu' | 'clients'>('menu');
  const [clients, setClients] = useState<ClientRow[] | null>(null);

  useEffect(() => { if (visible) { setStep('menu'); setClients(null); } }, [visible]);

  async function loadClients() {
    setStep('clients');
    const { data } = await supabase.from('bookings')
      .select('customer_id, walk_in_name, starts_at, service_id, services(name), customer:profiles!customer_id(full_name, avatar_url)')
      .eq('barber_id', barberId)
      .in('status', ['confirmed', 'no_show'])
      .order('starts_at', { ascending: false })
      .limit(200);
    // habits per client: most-booked service + median arrival time
    type Agg = { name: string; avatar: string | null; svc: Map<string, { n: number; name: string | null }>; mins: number[] };
    const seen = new Map<string, Agg>();
    for (const r of (data ?? []) as any[]) {
      const isWalkIn = r.customer_id === barberId;
      const name = isWalkIn ? r.walk_in_name : r.customer?.full_name;
      if (!name) continue;
      let e = seen.get(name.toLowerCase());
      if (!e) {
        e = { name, avatar: isWalkIn ? null : r.customer?.avatar_url ?? null, svc: new Map(), mins: [] };
        seen.set(name.toLowerCase(), e);
      }
      const d = new Date(r.starts_at);
      e.mins.push(d.getHours() * 60 + d.getMinutes());
      if (r.service_id) {
        const c = e.svc.get(r.service_id) ?? { n: 0, name: r.services?.name ?? null };
        c.n++;
        e.svc.set(r.service_id, c);
      }
    }
    setClients([...seen.values()].map((e) => {
      let serviceId: string | null = null; let serviceName: string | null = null; let best = 0;
      // rows arrive newest-first, so ties go to the most recent service
      for (const [id, c] of e.svc) if (c.n > best) { best = c.n; serviceId = id; serviceName = c.name; }
      const mins = [...e.mins].sort((a, b) => a - b);
      return { name: e.name, avatar: e.avatar, serviceId, serviceName, preferMin: mins[Math.floor(mins.length / 2)] ?? null };
    }));
  }

  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[] = [
    { icon: 'person-add-outline', label: 'Walk-in — start now', onPress: () => onPick({ mode: 'now' }) },
    { icon: 'calendar-outline', label: 'Schedule appointment', onPress: () => onPick({ mode: 'schedule' }) },
    { icon: 'people-outline', label: 'Book existing client', onPress: loadClients },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.backdrop} onPress={onClose} />
      <View style={s.sheet} onAccessibilityEscape={onClose}>
        <View style={s.handle} />
        <View style={s.head}>
          <View style={s.grow}>
            <Text style={s.title}>{step === 'menu' ? 'Quick add' : 'Book existing client'}</Text>
            <Text style={s.sub}>{step === 'menu' ? 'Add to your chair schedule' : 'Their name prefills the booking'}</Text>
          </View>
          <Pressable onPress={step === 'menu' ? onClose : () => setStep('menu')} hitSlop={8}
            accessibilityRole="button" accessibilityLabel={step === 'menu' ? 'Close' : 'Back'}
            style={({ pressed }) => [s.closeBtn, pressed && s.pressed]}>
            <Ionicons name={step === 'menu' ? 'close' : 'chevron-back'} size={18} color={D.text} />
          </Pressable>
        </View>

        {step === 'menu' ? rows.map((r) => (
          <Pressable key={r.label} onPress={r.onPress} accessibilityRole="button" accessibilityLabel={r.label}
            style={({ pressed }) => [s.row, pressed && s.pressed]}>
            <View style={s.rowIcon}><Ionicons name={r.icon} size={20} color={D.text} /></View>
            <Text style={s.rowLabel}>{r.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={D.sub} />
          </Pressable>
        )) : (
          <ScrollView style={s.clientList} showsVerticalScrollIndicator={false}>
            {clients === null && <ActivityIndicator style={s.spinner} color={colors.accent} accessibilityLabel="Loading clients" />}
            {clients?.length === 0 && <Text style={s.sub}>No clients yet — they appear after their first visit.</Text>}
            {clients?.map((c) => (
              <Pressable key={c.name}
                onPress={() => onPick({ mode: 'schedule', name: c.name, serviceId: c.serviceId ?? undefined, preferMin: c.preferMin ?? undefined })}
                accessibilityRole="button"
                accessibilityLabel={`Book ${c.name}${c.serviceName ? `, usually ${c.serviceName}` : ''}${c.preferMin != null ? ` around ${hm(c.preferMin)}` : ''}`}
                style={({ pressed }) => [s.row, pressed && s.pressed]}>
                {c.avatar
                  ? <Image source={{ uri: c.avatar }} style={s.avatar} />
                  : <View style={[s.avatar, s.avatarFallback]}>
                      <Text style={s.avatarText}>
                        {c.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                      </Text>
                    </View>}
                <View style={s.grow}>
                  <Text style={s.rowName}>{c.name}</Text>
                  {(c.serviceName || c.preferMin != null) && (
                    <Text style={s.rowHabit} numberOfLines={1}>
                      {[c.serviceName && `Usually ${c.serviceName}`, c.preferMin != null && `~${hm(c.preferMin)}`]
                        .filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={D.sub} />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: D.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: sp(5), paddingBottom: sp(10), gap: sp(2), maxHeight: '75%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: D.border, marginBottom: sp(2) },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp(3), marginBottom: sp(2) },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  spinner: { marginVertical: sp(6) },
  title: { fontSize: font.h2, fontWeight: '700', color: D.text },
  sub: { fontSize: font.small, color: D.sub, marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(3.5), paddingVertical: sp(3) },
  rowIcon: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: font.body, fontWeight: '700', color: D.text },
  rowName: { fontSize: font.body, fontWeight: '700', color: D.text },
  rowHabit: { fontSize: font.tiny, color: D.sub, marginTop: 2 },
  clientList: { maxHeight: 320 },
  avatar: { width: 40, height: 40, borderRadius: radius.pill },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.small, fontWeight: '700', color: colors.accent },
});
