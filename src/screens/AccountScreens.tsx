import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Display } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, shadow } from '../theme';

// 22a set a password · 23a/b/c forgot password · 24a session expired.
//
// The strength meter is shared by 22a and 23c, and the three rules it checks are
// the three the design lists — no library, because "8 chars, a number, a
// capital" is the whole spec and a zxcvbn would be 400 KB to say the same thing.

const RULES = [
  { key: 'len', label: 'At least 8 characters', ok: (p: string) => p.length >= 8 },
  { key: 'num', label: 'One number', ok: (p: string) => /\d/.test(p) },
  { key: 'cap', label: 'One capital letter', ok: (p: string) => /[A-Z]/.test(p) },
];

function strengthOf(p: string) {
  const score = RULES.filter((r) => r.ok(p)).length;
  return {
    score,
    label: score <= 1 ? 'Weak' : score === 2 ? 'Fair' : 'Strong',
    colour: score <= 1 ? colors.textTertiary : score === 2 ? colors.accent : '#16A34A',
    valid: score === 3,
  };
}

function Meter({ password }: { password: string }) {
  const st = strengthOf(password);
  return (
    <View style={s.meterRow}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[s.meterBar, i < st.score && { backgroundColor: st.colour }]} />
      ))}
      <Text style={[s.meterLabel, { color: st.colour }]}>{st.label}</Text>
    </View>
  );
}

function Rules({ password }: { password: string }) {
  return (
    <View style={s.rulesCard}>
      {RULES.map((r) => {
        const ok = r.ok(password);
        return (
          <View key={r.key} style={s.ruleRow}>
            <View style={[s.ruleDot, ok && s.ruleDotOn]}>
              {ok && <Ionicons name="checkmark" size={10} color="#16A34A" />}
            </View>
            <Text style={[s.ruleText, !ok && s.ruleTextOff]}>{r.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Secret({ label, value, onChange, focused, trailing }: {
  label: string; value: string; onChange: (v: string) => void;
  focused?: boolean; trailing?: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  return (
    <View style={[s.field, focused && s.fieldFocus]}>
      <View style={s.grow}>
        <Text style={s.fieldLabel}>{label}</Text>
        <TextInput style={s.fieldInput} value={value} onChangeText={onChange}
          secureTextEntry={!show} autoCapitalize="none" autoComplete="off"
          placeholder="••••••••" placeholderTextColor={colors.textTertiary} />
      </View>
      {trailing ?? (
        <Pressable onPress={() => setShow((v) => !v)} hitSlop={8}
          accessibilityLabel={show ? 'Hide password' : 'Show password'}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={17}
            color={colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

function BackPuck({ onPress, icon }: { onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel="Go back"
      style={({ pressed }) => [s.puck, pressed && s.pressed]}>
      <Ionicons name={icon ?? 'arrow-back'} size={16} color={colors.text} />
    </Pressable>
  );
}

// ---- 22a / 23c -----------------------------------------------------------
// One screen, two doorways: setting a first password from Settings, and
// finishing a reset after the emailed link. The only difference is the copy and
// what happens after — the rules and the meter are identical, so they should
// not be two components that drift.
export function SetPasswordScreen({ mode, email, onBack, onDone }: {
  mode: 'set' | 'reset'; email?: string | null; onBack: () => void; onDone: () => void;
}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const st = strengthOf(pw);
  const matches = confirm.length > 0 && confirm === pw;
  const armed = st.valid && matches && !busy;

  async function save() {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return Alert.alert('Could not save the password', error.message);
    onDone();
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.authContent} showsVerticalScrollIndicator={false}>
        <BackPuck onPress={onBack} icon={mode === 'reset' ? 'lock-closed-outline' : 'arrow-back'} />

        <View style={s.head}>
          <Display size={mode === 'reset' ? 30 : 30} style={s.headTitle}>
            {mode === 'reset' ? 'Choose a new\npassword.' : 'Set a\npassword.'}
          </Display>
          <Text style={s.headSub}>
            {mode === 'reset'
              ? <>Resetting for <Text style={s.strong}>{email ?? 'your account'}</Text>.
                {' '}You'll be signed out on other devices.</>
              : 'So you can sign in with your email as well as the link we send you.'}
          </Text>
        </View>

        <View style={s.fieldList}>
          <Secret label="NEW PASSWORD" value={pw} onChange={setPw} focused={!pw || !st.valid} />
          <Secret label="CONFIRM PASSWORD" value={confirm} onChange={setConfirm}
            focused={st.valid && !matches}
            trailing={matches ? (
              <View style={s.tick}><Ionicons name="checkmark" size={11} color="#16A34A" /></View>
            ) : undefined} />
        </View>

        <Meter password={pw} />
        <Rules password={pw} />

        <Pressable onPress={save} disabled={!armed}
          style={({ pressed }) => [s.wideDark, !armed && s.disabled, pressed && s.pressed]}>
          <Text style={s.wideDarkText}>
            {mode === 'reset' ? 'RESET & SIGN IN' : 'SAVE PASSWORD'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ---- 23a / 23b -----------------------------------------------------------
export function ForgotPasswordScreen({ initialEmail, onBack }: {
  initialEmail?: string; onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail ?? '');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function countdown() {
    setWait(60);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setWait((w) => {
        if (w <= 1 && timer.current) clearInterval(timer.current);
        return Math.max(0, w - 1);
      });
    }, 1000);
  }

  async function send() {
    const to = email.trim();
    if (!to.includes('@')) return Alert.alert('Check the email', 'That does not look like an email.');
    setBusy(true);
    // the link lands back in the app via the scheme in app.json; PASSWORD_RECOVERY
    // then routes to SetPasswordScreen in reset mode
    const { error } = await supabase.auth.resetPasswordForEmail(to, { redirectTo: 'brber://reset' });
    setBusy(false);
    if (error) return Alert.alert('Could not send the link', error.message);
    setSent(true);
    countdown();
  }

  // 23b
  if (sent) {
    return (
      <View style={s.screen}>
        <View style={s.inbox}>
          <View style={s.inboxIcon}>
            <Ionicons name="mail-outline" size={30} color={colors.accent} />
          </View>
          <View>
            <Display size={28} style={s.center}>Check your{'\n'}inbox</Display>
            <Text style={s.inboxSub}>
              We sent a reset link to <Text style={s.strong}>{email.trim()}</Text>.
              {' '}It expires in 30 minutes.
            </Text>
          </View>

          <View style={s.stepsCard}>
            {['Open the mail from Sterncut', 'Tap the reset link', 'Choose a new password']
              .map((step, i) => (
                <View key={step} style={s.stepRow}>
                  <View style={s.stepNo}><Text style={s.stepNoText}>{i + 1}</Text></View>
                  <Text style={s.stepText}>{step}</Text>
                </View>
              ))}
          </View>

          <Pressable onPress={() => Linking.openURL('message://').catch(() => {})}
            style={({ pressed }) => [s.wideDark, pressed && s.pressed]}>
            <Text style={s.wideDarkText}>OPEN MAIL APP</Text>
          </Pressable>

          <Text style={s.resend}>
            Didn't get it?{' '}
            {wait > 0
              ? <Text style={s.resendWait}>Resend in 0:{String(wait).padStart(2, '0')}</Text>
              : <Text style={s.link} onPress={send}>Resend</Text>}
          </Text>
          <Text style={s.link} onPress={() => setSent(false)}>Use a different email</Text>
        </View>
      </View>
    );
  }

  // 23a
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.authContent} showsVerticalScrollIndicator={false}>
        <BackPuck onPress={onBack} />
        <View style={s.head}>
          <Display size={32} style={s.headTitle}>Forgot your{'\n'}password?</Display>
          <Text style={s.headSub}>
            Enter the email on your Sterncut account and we'll send a reset link.
          </Text>
        </View>

        <View style={[s.field, s.fieldFocus]}>
          <View style={s.grow}>
            <Text style={s.fieldLabel}>EMAIL</Text>
            <TextInput style={s.fieldInput} value={email} onChangeText={setEmail}
              autoCapitalize="none" keyboardType="email-address" autoComplete="email"
              placeholder="you@example.com" placeholderTextColor={colors.textTertiary} />
          </View>
        </View>

        <Pressable onPress={send} disabled={busy}
          style={({ pressed }) => [s.wideDark, busy && s.disabled, pressed && s.pressed]}>
          <Text style={s.wideDarkText}>SEND RESET LINK</Text>
        </Pressable>

        <View style={s.orRow}>
          <View style={s.orLine} /><Text style={s.orText}>OR</Text><View style={s.orLine} />
        </View>

        {/* the mock offers Google here; social sign-in is not configured yet, so
            the honest fallback is the route that does exist */}
        <View style={s.noteCard}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary}
            style={s.noteIcon} />
          <Text style={s.noteText}>
            No email on your account? Sign in with your phone number instead, or report a problem
            and support will verify you by phone.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ---- 24a -----------------------------------------------------------------
// Blocking, because everything behind it will 401 anyway. The two green ticks
// are the point of the screen: nothing was lost, so signing back in is safe.
export function SessionExpiredSheet({ visible, name, email, onSignIn, onNotYou }: {
  visible: boolean; name: string | null; email: string | null;
  onSignIn: () => void; onNotYou: () => void;
}) {
  const initials = (name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={s.blockScrim} />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <View style={s.centerBlock}>
          <View style={s.warnCircle}>
            <Ionicons name="time-outline" size={26} color={colors.accent} />
          </View>
          <Display size={24} style={s.sheetTitle}>Session expired</Display>
          <Text style={s.sheetSub}>
            You've been signed out for security. Sign back in to pick up where you left off.
          </Text>
        </View>

        <View style={s.safeCard}>
          {['Your ticket is still holding your place', 'Wallet balance and deposits are safe']
            .map((line) => (
              <View key={line} style={s.safeRow}>
                <View style={s.tick}><Ionicons name="checkmark" size={11} color="#16A34A" /></View>
                <Text style={s.safeText}>{line}</Text>
              </View>
            ))}
        </View>

        {!!email && (
          <View style={s.whoRow}>
            <View style={s.whoAvatar}><Text style={s.whoAvatarText}>{initials}</Text></View>
            <View style={s.grow}>
              <Text style={s.whoName}>{name ?? 'Your account'}</Text>
              <Text style={s.whoEmail}>{email}</Text>
            </View>
            <Text style={s.link} onPress={onNotYou}>Not you?</Text>
          </View>
        )}

        <Pressable onPress={onSignIn} style={({ pressed }) => [s.wideDark, pressed && s.pressed]}>
          <Text style={s.wideDarkText}>SIGN IN AGAIN</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  authContent: { paddingTop: 66, paddingHorizontal: 24, paddingBottom: 40, gap: 15 },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  strong: { color: colors.text, fontWeight: '600' },
  link: { fontSize: font.small, fontWeight: '600', color: colors.accent },

  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  head: { marginTop: 8 },
  headTitle: { lineHeight: 34 },
  headSub: { fontSize: font.small, color: colors.textSecondary, marginTop: 10, lineHeight: 20 },

  fieldList: { gap: 11, marginTop: 4 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 11, paddingHorizontal: 18, ...shadow,
  },
  fieldFocus: { borderWidth: 2, borderColor: colors.ink },
  fieldLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: colors.textTertiary },
  fieldInput: { fontSize: 14, fontWeight: '500', color: colors.text, marginTop: 3, padding: 0 },
  tick: {
    width: 22, height: 22, borderRadius: 999, backgroundColor: 'rgba(74,222,128,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },

  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meterBar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#DDD9CF' },
  meterLabel: { fontSize: 11, fontWeight: '700' },
  rulesCard: {
    backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 15, paddingHorizontal: 18,
    gap: 10, ...shadow,
  },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  ruleDot: {
    width: 18, height: 18, borderRadius: 999, borderWidth: 1.5, borderColor: '#D8D4CA',
    alignItems: 'center', justifyContent: 'center',
  },
  ruleDotOn: { backgroundColor: 'rgba(74,222,128,0.20)', borderWidth: 0 },
  ruleText: { fontSize: 12, color: '#5C5C58' },
  ruleTextOff: { color: colors.textTertiary },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 2 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { fontSize: 11, letterSpacing: 1.65, fontWeight: '600', color: colors.textTertiary },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  noteIcon: { marginTop: 1 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },

  // 23b
  inbox: {
    flex: 1, paddingHorizontal: 26, justifyContent: 'center', alignItems: 'center', gap: 18,
  },
  inboxIcon: {
    width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  inboxSub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 10, lineHeight: 20,
    maxWidth: 280, textAlign: 'center',
  },
  stepsCard: {
    width: '100%', backgroundColor: colors.bg, borderRadius: 20,
    paddingVertical: 16, paddingHorizontal: 18, gap: 11, ...shadow,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNo: {
    width: 22, height: 22, borderRadius: 999, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNoText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  stepText: { flex: 1, fontSize: 12, color: '#5C5C58' },
  resend: { fontSize: font.small, color: colors.textSecondary },
  resendWait: { color: colors.textTertiary, fontWeight: '600' },

  // 24a
  blockScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24, paddingBottom: 34, gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  centerBlock: { alignItems: 'center', paddingTop: 6 },
  warnCircle: {
    width: 60, height: 60, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetTitle: { marginTop: 14, textAlign: 'center' },
  sheetSub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 8, lineHeight: 20,
    textAlign: 'center',
  },
  safeCard: {
    backgroundColor: colors.bg, borderRadius: 20, padding: 16, gap: 11, ...shadow,
  },
  safeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  safeText: { flex: 1, fontSize: 12, color: '#5C5C58' },
  whoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 18, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  whoAvatar: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  whoAvatarText: { fontSize: 12, fontWeight: '700', color: colors.accent },
  whoName: { fontSize: font.small, fontWeight: '700', color: colors.text },
  whoEmail: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },

  wideDark: {
    width: '100%', height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  wideDarkText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: '#fff' },
});
