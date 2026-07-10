import { useEffect, useState } from 'react';
import {
  Alert, Button, FlatList, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import type { Service } from '../types';

export default function ServicesScreen({ barberId, onBack }: { barberId: string; onBack: () => void }) {
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

  async function toggleActive(s: Service) {
    const { error } = await supabase.from('services').update({ is_active: !s.is_active }).eq('id', s.id);
    if (error) Alert.alert('Could not update', error.message);
    else load();
  }

  return (
    <View style={styles.screen}>
      <Button title="← Back" onPress={onBack} />
      <Text style={styles.title}>My services</Text>
      <TextInput style={styles.input} placeholder="Service name (e.g. Haircut)" value={name} onChangeText={setName} />
      <View style={styles.row}>
        <TextInput style={[styles.input, styles.half]} placeholder="Price" keyboardType="decimal-pad"
          value={price} onChangeText={setPrice} />
        <TextInput style={[styles.input, styles.half]} placeholder="Minutes" keyboardType="number-pad"
          value={duration} onChangeText={setDuration} />
      </View>
      <Button title={busy ? '...' : editingId ? 'Update service' : 'Add service'} disabled={busy} onPress={save} />
      {editingId && <Button title="Cancel edit" onPress={clearForm} />}
      <FlatList
        data={services}
        keyExtractor={(s) => s.id}
        ListEmptyComponent={<Text style={styles.empty}>No services yet — add your first one above.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => startEdit(item)}>
            <View style={styles.itemText}>
              <Text style={!item.is_active && styles.inactive}>{item.name}</Text>
              <Text style={styles.meta}>{(item.price_cents / 100).toFixed(2)} · {item.duration_min} min</Text>
            </View>
            <Switch value={item.is_active} onValueChange={() => toggleActive(item)} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  row: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  item: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  itemText: { flex: 1 },
  inactive: { color: '#999', textDecorationLine: 'line-through' },
  meta: { color: '#666', fontSize: 12 },
  empty: { textAlign: 'center', color: '#666', marginTop: 24 },
});
