import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput,
  TextInputProps, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, serifBlack, shadow, sp } from '../theme';
import { ForgotPasswordScreen } from './AccountScreens';

export type AuthView = 'welcome' | 'signin' | 'register';

// Sterncut auth flow (design 2c → 2d → 2e): welcome with social sign-in,
// email sign-in, register. Email/password is the real rail; social is stubbed.
export default function AuthScreen({ initialView = 'welcome' }: { initialView?: AuthView }) {
  const [view, setView] = useState<AuthView>(initialView);
  if (view === 'welcome') return <Welcome onEmail={() => setView('signin')} onRegister={() => setView('register')} />;
  if (view === 'signin') return <SignIn onBack={() => setView('welcome')} onRegister={() => setView('register')} />;
  return <Register onBack={() => setView('welcome')} onSignIn={() => setView('signin')} />;
}

// TODO(backlog): real OAuth needs providers configured in Supabase + expo-auth-session deep link
function social(provider: 'Google' | 'Apple') {
  Alert.alert(`${provider} sign-in`, 'Coming soon — use email for now. See BACKLOG.md.');
}

function Welcome({ onEmail, onRegister }: { onEmail: () => void; onRegister: () => void }) {
  return (
    <View style={s.dark}>
      <View style={s.welcomeBottom}>
        <View style={s.welcomeBrand}>
          <Text style={s.brandBig}>Sterncut</Text>
          <Text style={s.brandTag}>Book your barber in Tangier</Text>
        </View>
        <Pressable onPress={() => social('Google')} style={({ pressed }) => [s.socialBtn, s.socialLight, pressed && s.pressed]}>
          <Ionicons name="logo-google" size={18} color={colors.text} />
          <Text style={s.socialLightText}>Continue with Google</Text>
        </Pressable>
        <Pressable onPress={() => social('Apple')} style={({ pressed }) => [s.socialBtn, s.socialDark, pressed && s.pressed]}>
          <Ionicons name="logo-apple" size={19} color={colors.onAccent} />
          <Text style={s.socialDarkText}>Continue with Apple</Text>
        </Pressable>
        <View style={s.orRow}>
          <View style={s.orLineDark} />
          <Text style={s.orTextDark}>OR</Text>
          <View style={s.orLineDark} />
        </View>
        <Pressable onPress={onEmail} style={({ pressed }) => [s.socialBtn, s.socialOutline, pressed && s.pressed]}>
          <Ionicons name="mail-outline" size={17} color={colors.onAccent} />
          <Text style={s.socialDarkText}>Continue with email</Text>
        </Pressable>
        <Text style={s.terms}>
          New here?{' '}
          <Text style={s.termsStrong} onPress={onRegister}>Create an account</Text>
        </Text>
      </View>
    </View>
  );
}

// white labeled input card (design 2d/2e)
function LabeledField({ label, right, ...props }: TextInputProps & { label: string; right?: React.ReactNode }) {
  return (
    <View style={s.fieldCard}>
      <View style={s.grow}>
        <Text style={s.fieldLabel}>{label}</Text>
        <TextInput placeholderTextColor={colors.textTertiary} {...props} style={s.fieldInput} />
      </View>
      {right}
    </View>
  );
}

function PasswordField({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <LabeledField label="Password" secureTextEntry={!shown} autoComplete="password"
      value={value} onChangeText={onChangeText}
      right={
        <Pressable onPress={() => setShown(!shown)} hitSlop={8}
          accessibilityLabel={shown ? 'Hide password' : 'Show password'}>
          <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textTertiary} />
        </Pressable>
      } />
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel="Go back"
      style={({ pressed }) => [s.backBtn, pressed && s.pressed]}>
      <Ionicons name="arrow-back" size={18} color={colors.text} />
    </Pressable>
  );
}

function CtaButton({ title, onPress, busy }: { title: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy}
      style={({ pressed }) => [s.cta, (pressed || busy) && s.pressed]}>
      <Text style={s.ctaText}>{busy ? '…' : title}</Text>
    </Pressable>
  );
}

function SignIn({ onBack, onRegister }: { onBack: () => void; onRegister: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false); // 23a

  async function submit() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) Alert.alert('Sign in failed', error.message);
  }

  // 23a/23b replace the one-shot alert: the wait state is most of the flow
  if (forgotOpen) {
    return <ForgotPasswordScreen initialEmail={email.trim()} onBack={() => setForgotOpen(false)} />;
  }

  return (
    <KeyboardAvoidingView style={s.light} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <BackButton onPress={onBack} />
        <View style={s.headBlock}>
          <Text style={s.display}>Welcome{'\n'}back.</Text>
          <Text style={s.sub}>Sign in to your Sterncut account.</Text>
        </View>
        <LabeledField label="Email" autoCapitalize="none" keyboardType="email-address"
          autoComplete="email" value={email} onChangeText={setEmail} />
        <PasswordField value={password} onChangeText={setPassword} />
        <Text style={s.forgot} onPress={() => setForgotOpen(true)}>Forgot password?</Text>
        <CtaButton title="Sign in" onPress={submit} busy={busy} />
        <View style={s.orRow}>
          <View style={s.orLineLight} />
          <Text style={s.orTextLight}>OR</Text>
          <View style={s.orLineLight} />
        </View>
        <View style={s.socialRow}>
          <Pressable onPress={() => social('Google')} style={({ pressed }) => [s.socialSmall, s.socialSmallLight, pressed && s.pressed]}>
            <Ionicons name="logo-google" size={17} color={colors.text} />
            <Text style={s.socialSmallLightText}>Google</Text>
          </Pressable>
          <Pressable onPress={() => social('Apple')} style={({ pressed }) => [s.socialSmall, s.socialSmallDark, pressed && s.pressed]}>
            <Ionicons name="logo-apple" size={18} color={colors.onAccent} />
            <Text style={s.socialSmallDarkText}>Apple</Text>
          </Pressable>
        </View>
        <Text style={s.footer}>
          New to Sterncut?{' '}
          <Text style={s.footerLink} onPress={onRegister}>Create an account</Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Register({ onBack, onSignIn }: { onBack: () => void; onSignIn: () => void }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // customer-only flow (design t3); barbers join through the discreet link below
  const [role, setRole] = useState<'customer' | 'barber'>('customer');
  const [busy, setBusy] = useState(false);

  async function submit() {
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
  }

  return (
    <KeyboardAvoidingView style={s.light} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <BackButton onPress={onBack} />
        <View style={s.headBlock}>
          <Text style={s.display}>Tell us about{'\n'}yourself.</Text>
          <Text style={s.sub}>Your phone helps the barber confirm your booking.</Text>
        </View>
        <LabeledField label="Full name" value={fullName} onChangeText={setFullName} />
        <LabeledField label="Phone" keyboardType="phone-pad" autoComplete="tel"
          placeholder="+212 6…" value={phone} onChangeText={setPhone} />
        <LabeledField label="Email" autoCapitalize="none" keyboardType="email-address"
          autoComplete="email" value={email} onChangeText={setEmail} />
        <PasswordField value={password} onChangeText={setPassword} />
        <CtaButton title="Create account" onPress={submit} busy={busy} />
        <Pressable onPress={() => setRole(role === 'barber' ? 'customer' : 'barber')} hitSlop={6}>
          <Text style={s.roleLink}>
            {role === 'barber'
              ? '✓ Joining as a barber — tap to switch back to customer'
              : 'Are you a barber? Join as a barber'}
          </Text>
        </Pressable>
        <Text style={s.footer}>
          Already have an account?{' '}
          <Text style={s.footerLink} onPress={onSignIn}>Sign in</Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.8 },

  dark: { flex: 1, backgroundColor: colors.ink },
  light: { flex: 1, backgroundColor: colors.surface },

  welcomeBottom: { marginTop: 'auto', paddingHorizontal: sp(6.5), paddingBottom: sp(11), gap: sp(3) },
  welcomeBrand: { alignItems: 'center', marginBottom: sp(2.5) },
  brandBig: {
    fontFamily: serifBlack, fontSize: 38, letterSpacing: 5, textTransform: 'uppercase', color: colors.onAccent,
  },
  brandTag: { fontSize: font.small, color: 'rgba(255,255,255,0.6)', marginTop: 6 },

  socialBtn: {
    height: 54, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 10,
  },
  socialLight: { backgroundColor: colors.onAccent },
  socialLightText: { fontSize: 14, fontWeight: '600', color: colors.text },
  socialDark: { backgroundColor: '#1E1E1C', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  socialDarkText: { fontSize: 14, fontWeight: '600', color: colors.onAccent },
  socialOutline: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3.5), marginVertical: sp(1.5) },
  orLineDark: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.14)' },
  orTextDark: { fontSize: 11, letterSpacing: 2, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  orLineLight: { flex: 1, height: 1, backgroundColor: colors.border },
  orTextLight: { fontSize: 11, letterSpacing: 2, fontWeight: '600', color: colors.textTertiary },

  terms: { textAlign: 'center', fontSize: font.small, color: 'rgba(255,255,255,0.6)', marginTop: sp(2) },
  termsStrong: { color: colors.onAccent, fontWeight: '700' },

  form: { flexGrow: 1, padding: sp(6.5), paddingTop: sp(16), gap: sp(4) },
  backBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  headBlock: { marginTop: sp(3), gap: sp(2.5) },
  display: {
    fontFamily: serif, fontSize: 32, lineHeight: 36, letterSpacing: 0.6,
    textTransform: 'uppercase', color: colors.text,
  },
  sub: { fontSize: 14, color: colors.textSecondary },

  fieldCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg,
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: sp(4.5), ...shadow,
  },
  fieldLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: colors.textTertiary, textTransform: 'uppercase' },
  fieldInput: { fontSize: 14, fontWeight: '500', color: colors.text, paddingVertical: 3, padding: 0 },

  forgot: { alignSelf: 'flex-end', fontSize: 12, fontWeight: '600', color: colors.accent, marginTop: -sp(2) },

  cta: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaText: {
    color: colors.onAccent, fontSize: font.small, fontWeight: '700',
    letterSpacing: 1.3, textTransform: 'uppercase',
  },

  socialRow: { flexDirection: 'row', gap: sp(3) },
  socialSmall: {
    flex: 1, height: 52, borderRadius: radius.pill, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 9,
  },
  socialSmallLight: { backgroundColor: colors.bg, ...shadow },
  socialSmallLightText: { fontSize: font.small, fontWeight: '600', color: colors.text },
  socialSmallDark: { backgroundColor: colors.ink },
  socialSmallDarkText: { fontSize: font.small, fontWeight: '600', color: colors.onAccent },

  roleLink: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  footer: { textAlign: 'center', fontSize: 12, color: colors.textSecondary },
  footerLink: { color: colors.accent, fontWeight: '600' },
});
