import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Empty, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, inter, radius, sp } from '../theme';

// 39c of "Customer App 3.dc.html" — the heart finally does something.
//
// BACKLOG has carried "Wishlist → toggling does nothing yet" since the Explore
// cards were built. 0065 adds the table. The design saves barbers *and* salons,
// so one table carries both and a row is exactly one of the two.
//
// "Nobody is told you saved them" is an RLS policy, not a reassuring sentence:
// only the saver can read the row, including the barber it names.

type SavedBarber = { id: string; name: string; salon: string; rating: number; free_today: number | null };
type SavedSalon = { id: string; name: string; district: string; from_cents: number | null; open: boolean };
type Wishlist = { barbers: SavedBarber[]; salons: SavedSalon[]; gap_alerts: boolean };

const initials = (n: string) =>
  n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export default function SavedScreen({ onBack, onOpenBarber, onOpenSalon }: {
  onBack: () => void;
  onOpenBarber?: (id: string) => void;
  onOpenSalon?: (id: string) => void;
}) {
  const [w, setW] = useState<Wishlist | null>(null);

  const load = useCallback(() => {
    supabase.rpc('my_wishlist').then(({ data, error }) => {
      if (error) { Alert.alert('Could not load', error.message); return; }
      setW(data as Wishlist);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function unsave(col: 'barber_id' | 'salon_id', id: string) {
    setW((cur) => cur && (col === 'barber_id'
      ? { ...cur, barbers: cur.barbers.filter((b) => b.id !== id) }
      : { ...cur, salons: cur.salons.filter((x) => x.id !== id) }));
    const { error } = await supabase.from('wishlists').delete().eq(col, id);
    if (error) { Alert.alert('Could not remove', error.message); load(); }
  }

  async function setAlerts(on: boolean) {
    setW((cur) => cur && { ...cur, gap_alerts: on });
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from('notification_prefs')
      .upsert({ user_id: u.user.id, push_saved_gap: on }, { onConflict: 'user_id' });
    if (error) { Alert.alert('Could not save', error.message); load(); }
  }

  if (!w) return <View style={s.screen}><ActivityIndicator style={s.spin} /></View>;
  const nothing = w.barbers.length === 0 && w.salons.length === 0;

  return (
    <View style={s.screen}>
      <ScreenHeader title="Saved" onBack={onBack} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {!nothing && (
          <View style={s.alertCard}>
            <View style={s.alertChip}>
              <Ionicons name="time-outline" size={16} color="#FFFFFF" />
            </View>
            <View style={s.grow}>
              <Text style={s.alertTitle}>Tell me when a saved barber has a gap</Text>
              <Text style={s.alertSub}>Only same-day cancellations · about one a week</Text>
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

        {w.barbers.length > 0 && (
          <>
            <Text style={s.section}>BARBERS · {w.barbers.length}</Text>
            {w.barbers.map((b) => (
              <Pressable key={b.id} onPress={() => onOpenBarber?.(b.id)}
                accessibilityLabel={b.name}
                style={({ pressed }) => [s.row, pressed && s.pressed]}>
                <View style={s.avatar}><Text style={s.avatarText}>{initials(b.name)}</Text></View>
                <View style={s.grow}>
                  <Text style={s.name}>{b.name}</Text>
                  <Text style={s.meta}>{b.salon}{b.rating ? ` · ${b.rating} ★` : ''}</Text>
                  {/* today only — see barber_next_free_today's ceiling note */}
                  {b.free_today != null && (
                    <Text style={s.free}>Free {hhmm(b.free_today)} today</Text>
                  )}
                </View>
                <Pressable onPress={() => unsave('barber_id', b.id)} hitSlop={8}
                  accessibilityLabel={`Remove ${b.name} from saved`}
                  style={({ pressed }) => [s.heart, pressed && s.pressed]}>
                  <Ionicons name="heart" size={16} color={colors.accent} />
                </Pressable>
              </Pressable>
            ))}
          </>
        )}

        {w.salons.length > 0 && (
          <>
            <Text style={s.section}>SALONS · {w.salons.length}</Text>
            {w.salons.map((x) => (
              <Pressable key={x.id} onPress={() => onOpenSalon?.(x.id)}
                accessibilityLabel={x.name}
                style={({ pressed }) => [s.row, pressed && s.pressed]}>
                <View style={s.shopTile}>
                  <Ionicons name="cut-outline" size={19} color={colors.textTertiary} />
                </View>
                <View style={s.grow}>
                  <Text style={s.name}>{x.name}</Text>
                  <Text style={s.meta}>
                    {x.district}{x.from_cents != null ? ` · from ${Math.round(x.from_cents / 100)} DH` : ''}
                  </Text>
                  {/* 39a's state, carried here so a saved shop can't look bookable */}
                  {!x.open && <Text style={s.shut}>Closed right now</Text>}
                </View>
                <Pressable onPress={() => unsave('salon_id', x.id)} hitSlop={8}
                  accessibilityLabel={`Remove ${x.name} from saved`}
                  style={({ pressed }) => [s.heart, pressed && s.pressed]}>
                  <Ionicons name="heart" size={16} color={colors.accent} />
                </Pressable>
              </Pressable>
            ))}
          </>
        )}

        {!nothing && <Text style={s.foot}>Nobody is told you saved them.</Text>}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { padding: sp(5), gap: 10, paddingBottom: TAB_BAR_INSET },
  spin: { marginTop: sp(20) },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },

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
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.bg, borderRadius: 20, padding: 12, paddingHorizontal: 14,
  },
  avatar: {
    width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: inter.b, fontSize: 13, color: colors.accent },
  shopTile: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: '#E9E6DE',
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontFamily: inter.b, fontSize: 14, color: colors.text },
  meta: { fontFamily: inter.r, fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  free: { fontFamily: inter.sb, fontSize: 11.5, color: '#16A34A', marginTop: 2 },
  shut: { fontFamily: inter.sb, fontSize: 11.5, color: colors.danger, marginTop: 2 },
  heart: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: 'rgba(232,68,46,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  foot: {
    fontFamily: inter.r, fontSize: 11.5, lineHeight: 17,
    color: colors.textTertiary, marginTop: 2,
  },
});
