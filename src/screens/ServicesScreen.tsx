import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Btn, Eyebrow, Ico, Screen, T, TAB_INSET, Toggle, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D, inter } from '../theme';
import type { Service } from '../types';

// 1n — My services. Add at the top, the live list below; the toggle hides a
// service from customers without touching the bookings that already used it.
export default function ServicesScreen({ barberId, onBack }: { barberId: string; onBack?: () => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('services')
      .select('id, name, price_cents, duration_min, is_active')
      .eq('barber_id', barberId).order('created_at');
    if (error) Alert.alert('Could not load services', error.message);
    else setServices(data);
  }
  useEffect(() => { load(); }, []);

  function startEdit(s: Service) {
    setEditingId(s.id);
    setName(s.name);
    setPrice(String(s.price_cents / 100));
    setDuration(String(s.duration_min));
  }

  function clearForm() {
    setEditingId(null); setName(''); setPrice(''); setDuration('');
  }

  async function save() {
    const priceCents = Math.round(parseFloat(price) * 100);
    const durationMin = parseInt(duration, 10);
    if (!name.trim() || !Number.isFinite(priceCents) || priceCents < 0 || !Number.isInteger(durationMin) || durationMin <= 0) {
      return Alert.alert('Invalid input', 'Name, a valid price, and a duration in minutes are required.');
    }
    setBusy(true);
    const row = { name: name.trim(), price_cents: priceCents, duration_min: durationMin };
    const { error } = editingId
      ? await supabase.from('services').update(row).eq('id', editingId)
      : await supabase.from('services').insert({ ...row, barber_id: barberId });
    setBusy(false);
    if (error) return Alert.alert('Could not save', error.message);
    clearForm();
    load();
  }

  async function toggleActive(svc: Service) {
    const { error } = await supabase.from('services').update({ is_active: !svc.is_active }).eq('id', svc.id);
    if (error) Alert.alert('Could not update', error.message);
    else load();
  }

  return (
    <View style={s.screen}>
      <View style={s.head}>
        <TopBar title={editingId ? 'Edit service' : 'My services'} onBack={onBack} plain />
        <View style={s.addCard}>
          <Eyebrow ls={1.4}>{editingId ? 'EDIT SERVICE' : 'ADD A SERVICE'}</Eyebrow>
          <TextInput value={name} onChangeText={setName} style={s.field}
            placeholder="Service name (e.g. Haircut)" placeholderTextColor={D.sub}
            accessibilityLabel="Service name" />
          <View style={s.fieldRow}>
            <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad"
              style={[s.field, s.grow]} placeholder="Price (DH)" placeholderTextColor={D.sub}
              accessibilityLabel="Price in dirhams" />
            <TextInput value={duration} onChangeText={setDuration} keyboardType="number-pad"
              style={[s.field, s.grow]} placeholder="Minutes" placeholderTextColor={D.sub}
              accessibilityLabel="Duration in minutes" />
          </View>
          <Btn title={editingId ? 'UPDATE SERVICE' : 'ADD SERVICE'} height={48} onPress={save}
            style={busy ? { opacity: 0.6 } : undefined} />
          {editingId && (
            <Pressable onPress={clearForm} accessibilityRole="button"
              style={({ pressed }) => pressed && s.pressed}>
              <T w="sb" size={12} c={D.sub} style={s.center}>Cancel edit</T>
            </Pressable>
          )}
        </View>
        <Eyebrow ls={1.65}>
          {services.length} SERVICE{services.length === 1 ? '' : 'S'} · TAP TO EDIT
        </Eyebrow>
      </View>

      <FlatList
        data={services}
        keyExtractor={(svc) => svc.id}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <T size={13} c={D.sub} style={s.center}>No services yet — add your first one above.</T>}
        ListFooterComponent={services.length
          ? <T size={11} c={D.sub} style={s.footnote}>
              Hidden services stay on past bookings but customers can't pick them.
            </T>
          : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => startEdit(item)} accessibilityRole="button"
            accessibilityLabel={`Edit ${item.name}`}
            style={({ pressed }) => [s.row, pressed && s.pressed]}>
            <Ico name="menu" size={14} color={D.muted} />
            <View style={s.grow}>
              <T w="b" size={14} c={item.is_active ? D.text : D.sub}
                style={!item.is_active && s.struck}>{item.name}</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                {(item.price_cents / 100).toFixed(2)} DH · {item.duration_min} min
              </T>
            </View>
            {!item.is_active && (
              <View style={s.hiddenChip}><T w="b" size={9} c={D.sub} ls={0.7}>HIDDEN</T></View>
            )}
            <Toggle small on={item.is_active} color={D.accent} onPress={() => toggleActive(item)} />
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  head: { paddingTop: 62, paddingHorizontal: 20, gap: 13 },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  center: { textAlign: 'center' },
  struck: { textDecorationLine: 'line-through' },

  addCard: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 11 },
  field: {
    backgroundColor: D.card2, borderRadius: 14, height: 46, paddingHorizontal: 15,
    fontFamily: inter.r, fontSize: 14, color: D.text,
  },
  fieldRow: { flexDirection: 'row', gap: 9 },

  list: { gap: 9, paddingTop: 4, paddingHorizontal: 20, paddingBottom: TAB_INSET },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 16, padding: 14, paddingHorizontal: 15,
  },
  hiddenChip: { backgroundColor: D.card2, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 7 },
  footnote: { marginTop: 4, lineHeight: 17 },
});
