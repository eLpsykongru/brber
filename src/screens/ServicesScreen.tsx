import { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Card, Chip, Empty, Field, PillButton, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, sp } from '../theme';
import type { Service } from '../types';

export default function ServicesScreen({ barberId }: { barberId: string }) {
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
      <ScreenHeader title="My services" />
      <Card>
        <Field placeholder="Service name (e.g. Haircut)" value={name} onChangeText={setName} />
        <View style={s.row}>
          <Field placeholder="Price (DH)" keyboardType="decimal-pad" value={price}
            onChangeText={setPrice} style={s.half} />
          <Field placeholder="Minutes" keyboardType="number-pad" value={duration}
            onChangeText={setDuration} style={s.half} />
        </View>
        <PillButton title={editingId ? 'Update service' : 'Add service'} onPress={save} loading={busy} />
        {editingId && <PillButton title="Cancel edit" variant="secondary" onPress={clearForm} />}
      </Card>
      <FlatList
        data={services}
        keyExtractor={(svc) => svc.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Empty text="No services yet — add your first one above." />}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.item} onPress={() => startEdit(item)}>
            <View style={s.grow}>
              <Text style={[s.itemName, !item.is_active && s.inactive]}>{item.name}</Text>
              <Text style={s.meta}>{(item.price_cents / 100).toFixed(2)} DH · {item.duration_min} min</Text>
            </View>
            {!item.is_active && <Chip label="hidden" />}
            <Switch value={item.is_active} onValueChange={() => toggleActive(item)}
              trackColor={{ true: colors.accent }} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), gap: sp(3) },
  row: { flexDirection: 'row', gap: sp(2) },
  half: { flex: 1 },
  list: { gap: sp(2), paddingBottom: TAB_BAR_INSET, paddingTop: sp(2) },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2),
    borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: sp(3),
    backgroundColor: colors.bg,
  },
  grow: { flex: 1 },
  itemName: { fontSize: font.body, fontWeight: '600', color: colors.text },
  inactive: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  meta: { color: colors.textSecondary, fontSize: font.small },
});
