import { useState } from 'react';
import { Alert, Button, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'customer' | 'barber'>('customer');
  const [busy, setBusy] = useState(false);

  async function signUp() {
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, role } },
    });
    setBusy(false);
    if (error) Alert.alert('Sign up failed', error.message);
  }

  async function signIn() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) Alert.alert('Sign in failed', error.message);
  }

  return (
    <View style={styles.form}>
      <Text style={styles.title}>brber</Text>
      <TextInput style={styles.input} placeholder="Email" autoCapitalize="none"
        keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="Password" secureTextEntry
        value={password} onChangeText={setPassword} />
      <TextInput style={styles.input} placeholder="Full name (sign up only)"
        value={fullName} onChangeText={setFullName} />
      <View style={styles.roleRow}>
        {(['customer', 'barber'] as const).map((r) => (
          <TouchableOpacity key={r} style={[styles.roleBtn, role === r && styles.roleBtnActive]}
            onPress={() => setRole(r)}>
            <Text style={role === r ? styles.roleTextActive : undefined}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Button title={busy ? '...' : 'Sign up'} disabled={busy} onPress={signUp} />
      <Button title={busy ? '...' : 'Sign in'} disabled={busy} onPress={signIn} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  roleRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  roleBtn: { paddingVertical: 8, paddingHorizontal: 20, borderWidth: 1, borderColor: '#ccc', borderRadius: 8 },
  roleBtnActive: { backgroundColor: '#222', borderColor: '#222' },
  roleTextActive: { color: '#fff' },
});
