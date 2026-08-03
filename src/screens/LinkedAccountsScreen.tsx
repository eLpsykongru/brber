import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Display } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow } from '../theme';

// 21a linked accounts (and the biometric toggle that 24b acts on).

export const LOCK_KEY = 'lock_with_biometrics';

/** Device-local on purpose: "protect this phone" is not an account setting. */
export async function biometricLockOn() {
  return (await AsyncStorage.getItem(LOCK_KEY)) === '1';
}

type Identity = { provider: string; email?: string | null; created_at?: string };

const LOOK: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  email: { label: 'Email & password', icon: 'mail-outline' },
  phone: { label: 'Phone number', icon: 'call-outline' },
  google: { label: 'Google', icon: 'logo-google' },
  apple: { label: 'Apple', icon: 'logo-apple' },
};

export default function LinkedAccountsScreen({ onBack, onSetPassword }: {
  onBack: () => void; onSetPassword: () => void;
}) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [lock, setLock] = useState(false);
  const [sessionSince, setSessionSince] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    setEmail(data.user?.email ?? null);
    setIdentities((data.user?.identities ?? []) as Identity[]);
    setSessionSince(data.user?.last_sign_in_at ?? null);
    setHasBiometrics(await LocalAuthentication.hasHardwareAsync()
      && await LocalAuthentication.isEnrolledAsync());
    setLock(await biometricLockOn());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleLock(next: boolean) {
    if (next) {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Turn on unlock for Sterncut',
      });
      if (!res.success) return;
    }
    setLock(next);
    await AsyncStorage.setItem(LOCK_KEY, next ? '1' : '0');
  }

  // the provider you signed in with cannot be the one you unlink
  const primary = identities[0]?.provider;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable onPress={onBack} hitSlop={8}
            style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={16} color={colors.text} />
          </Pressable>
          <Display size={18} style={s.headerTitle}>Linked accounts</Display>
          <View style={s.puckGhost} />
        </View>

        <Text style={s.section}>SIGN-IN METHODS</Text>
        <View style={s.card}>
          {identities.map((id, i) => {
            const look = LOOK[id.provider] ?? { label: id.provider, icon: 'key-outline' as const };
            return (
              <View key={id.provider} style={[s.row, i < identities.length - 1 && s.rowBorder]}>
                <View style={s.rowIcon}>
                  <Ionicons name={look.icon} size={17} color={colors.text} />
                </View>
                <View style={s.grow}>
                  <Text style={s.rowLabel}>{look.label}</Text>
                  <Text style={s.rowHint}>{id.email ?? email ?? 'Connected'}</Text>
                </View>
                {id.provider === primary
                  ? <View style={s.chip}><Text style={s.chipText}>SIGN-IN</Text></View>
                  : (
                    <Pressable onPress={() => Alert.alert('Unlink',
                      'Unlinking a provider needs a second sign-in method — set a password first.')}>
                      <Text style={s.unlink}>Unlink</Text>
                    </Pressable>
                  )}
              </View>
            );
          })}
          {identities.length === 0 && <Text style={s.empty}>No sign-in methods to show.</Text>}
        </View>

        {/* Google and Apple are drawn in 21a but no OAuth provider is configured
            on the Supabase project, so offering them would be a dead button. */}
        <View style={s.noteCard}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary}
            style={s.noteIcon} />
          <Text style={s.noteText}>
            Google and Apple sign-in aren't switched on for Sterncut yet. When they are, they'll
            appear here to link.
          </Text>
        </View>

        <Text style={s.section}>PASSWORD</Text>
        <View style={s.card}>
          <Pressable onPress={onSetPassword} style={({ pressed }) => [s.row, pressed && s.pressed]}>
            <View style={s.rowIcon}>
              <Ionicons name="lock-closed-outline" size={17} color={colors.text} />
            </View>
            <View style={s.grow}>
              <Text style={s.rowLabel}>Set a password</Text>
              <Text style={s.rowHint}>A second way in, and what you'd use to unlink</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
          </Pressable>
        </View>

        <Text style={s.section}>DEVICE</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowIcon}>
              <Ionicons name="finger-print-outline" size={17} color={colors.text} />
            </View>
            <View style={s.grow}>
              <Text style={s.rowLabel}>Unlock with Face ID</Text>
              <Text style={s.rowHint}>
                {hasBiometrics
                  ? 'Protects your wallet, deposits and bookings'
                  : 'No biometrics enrolled on this phone'}
              </Text>
            </View>
            <Switch value={lock} onValueChange={toggleLock} disabled={!hasBiometrics}
              trackColor={{ false: '#DDD9CF', true: colors.accent }} thumbColor="#fff" />
          </View>
        </View>

        {!!sessionSince && (
          <View style={s.sessionCard}>
            <Text style={s.sessionLabel}>THIS DEVICE</Text>
            <Text style={s.sessionValue}>
              Signed in {new Date(sessionSince).toLocaleDateString('en-US',
                { month: 'short', day: 'numeric' })}
            </Text>
            <Text style={s.link} onPress={() => supabase.auth.signOut()}>Sign out everywhere</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ---- 24b -----------------------------------------------------------------
export function LockScreen({ ticketLine, onUnlocked, onPassword }: {
  ticketLine?: string | null; onUnlocked: () => void; onPassword: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Sterncut', fallbackLabel: 'Enter password',
    });
    setBusy(false);
    if (res.success) onUnlocked();
  }, [onUnlocked]);

  useEffect(() => { tryUnlock(); }, [tryUnlock]);

  return (
    <View style={s.lock}>
      <Text style={s.wordmark}>STERNCUT</Text>
      <View style={s.lockMiddle}>
        <View style={s.faceBox}>
          <Ionicons name="scan-outline" size={40} color="#fff" />
        </View>
        <View>
          <Display size={26} style={s.lockTitle}>Unlock Sterncut</Display>
          <Text style={s.lockSub}>Face ID protects your wallet, deposits and bookings.</Text>
        </View>
        {!!ticketLine && (
          <View style={s.lockTicket}>
            <View style={s.lockDot} />
            <Text style={s.lockTicketText}>{ticketLine}</Text>
          </View>
        )}
      </View>
      <View style={s.lockFoot}>
        <Pressable onPress={tryUnlock} disabled={busy}
          style={({ pressed }) => [s.unlockBtn, pressed && s.pressed]}>
          <Text style={s.unlockText}>UNLOCK WITH FACE ID</Text>
        </Pressable>
        <Text style={s.lockLink} onPress={onPassword}>Enter password instead</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 66, paddingHorizontal: 20, paddingBottom: 40, gap: 13 },
  grow: { flex: 1 },
  pressed: { opacity: 0.75 },
  link: { fontSize: font.small, fontWeight: '600', color: colors.accent },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  puckGhost: { width: 40 },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.72 },

  section: {
    fontSize: 11, letterSpacing: 1.65, fontWeight: '700', color: colors.textSecondary, marginTop: 2,
  },
  card: { backgroundColor: colors.bg, borderRadius: 24, paddingHorizontal: 18, ...shadow },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#EFECE4' },
  rowIcon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowHint: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  chip: {
    backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9,
  },
  chipText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textSecondary },
  unlink: { fontSize: 12, fontWeight: '600', color: colors.accent },
  empty: { fontSize: 12, color: colors.textSecondary, paddingVertical: 14 },

  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  noteIcon: { marginTop: 1 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },

  sessionCard: {
    backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18,
    gap: 4, marginTop: 2, ...shadow,
  },
  sessionLabel: { fontSize: 10, letterSpacing: 1, fontWeight: '600', color: colors.textTertiary },
  sessionValue: { fontSize: font.small, fontWeight: '700', color: colors.text },

  // 24b
  lock: { flex: 1, backgroundColor: colors.ink },
  wordmark: {
    position: 'absolute', top: 70, left: 0, right: 0, textAlign: 'center',
    fontFamily: serif, fontSize: 18, letterSpacing: 3.96, color: '#fff',
  },
  lockMiddle: {
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: 18, paddingHorizontal: 26,
  },
  faceBox: {
    width: 88, height: 88, borderRadius: 24, borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  lockTitle: { textAlign: 'center', color: '#fff' },
  lockSub: {
    fontSize: font.small, color: 'rgba(255,255,255,0.6)', marginTop: 9, lineHeight: 20,
    maxWidth: 260, textAlign: 'center',
  },
  lockTicket: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999,
    paddingVertical: 9, paddingHorizontal: 15,
  },
  lockDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
  lockTicketText: { fontSize: font.tiny, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  lockFoot: { position: 'absolute', left: 26, right: 26, bottom: 44, gap: 11 },
  unlockBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  unlockText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: colors.text },
  lockLink: { textAlign: 'center', fontSize: font.small, color: 'rgba(255,255,255,0.6)' },
});
