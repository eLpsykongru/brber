import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Chip, Field, PillButton } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, sp } from '../theme';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'customer' | 'barber'>('customer');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (mode === 'signup') {
      if (!fullName.trim() || phone.trim().length < 6) {
        return Alert.alert('Missing info', 'Full name and a phone number are required to sign up.');
      }
      setBusy(true);
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: fullName.trim(), phone: phone.trim(), role } },
      });
      setBusy(false);
      if (error) Alert.alert('Sign up failed', error.message);
    } else {
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) Alert.alert('Sign in failed', error.message);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
      <Text style={s.brand}>brber</Text>
      <Text style={s.tagline}>Book your barber in Tangier</Text>

      <View style={s.switchRow}>
        <Chip label="Sign in" active={mode === 'signin'} onPress={() => setMode('signin')} />
        <Chip label="Create account" active={mode === 'signup'} onPress={() => setMode('signup')} />
      </View>

      <Field placeholder="Email" autoCapitalize="none" keyboardType="email-address"
        autoComplete="email" value={email} onChangeText={setEmail} />
      <Field placeholder="Password" secureTextEntry autoComplete="password"
        value={password} onChangeText={setPassword} />

      {mode === 'signup' && (
        <>
          <Field placeholder="Full name" value={fullName} onChangeText={setFullName} />
          <Field placeholder="Phone" keyboardType="phone-pad" autoComplete="tel"
            value={phone} onChangeText={setPhone} />
          <Text style={s.roleLabel}>I am a…</Text>
          <View style={s.switchRow}>
            <Chip label="Customer" active={role === 'customer'} onPress={() => setRole('customer')} />
            <Chip label="Barber" active={role === 'barber'} onPress={() => setRole('barber')} />
          </View>
        </>
      )}

      <PillButton title={mode === 'signup' ? 'Create account' : 'Sign in'}
        onPress={submit} loading={busy} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  form: { flexGrow: 1, justifyContent: 'center', padding: sp(6), gap: sp(3) },
  brand: { fontSize: 34, fontWeight: '800', textAlign: 'center', color: colors.accent },
  tagline: {
    textAlign: 'center', color: colors.textSecondary, fontSize: font.body, marginBottom: sp(4),
  },
  switchRow: { flexDirection: 'row', gap: sp(2), justifyContent: 'center' },
  roleLabel: {
    textAlign: 'center', color: colors.textSecondary, fontSize: font.small, fontWeight: '600',
    marginTop: sp(1),
  },
});
