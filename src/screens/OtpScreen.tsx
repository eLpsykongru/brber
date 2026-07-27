import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius, serif, shadow, sp } from '../theme';

// Phone OTP verification (design 3b). UI shell — NOT wired into the register flow yet:
// Supabase phone OTP needs an SMS provider (Twilio) configured first. See BACKLOG.md.
// Wire by passing verify = supabase.auth.verifyOtp and calling signInWithOtp on mount/resend.
export default function OtpScreen({ phone, onBack, onVerify, onResend }: {
  phone: string;
  onBack: () => void;
  onVerify: (code: string) => Promise<string | null>; // returns error message or null
  onResend: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(45);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function verify() {
    if (code.length < 4 || busy) return;
    setBusy(true);
    const err = await onVerify(code);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <View style={s.screen}>
      <View style={s.headRow}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Go back"
          style={({ pressed }) => [s.backBtn, pressed && s.pressed]}>
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </Pressable>
        <Text style={s.step}>STEP 3 OF 3</Text>
      </View>
      <View style={s.progress}>
        {[0, 1, 2].map((i) => <View key={i} style={s.progressSegOn} />)}
      </View>

      <View style={s.headBlock}>
        <Text style={s.display}>Check your{'\n'}phone.</Text>
        <Text style={s.sub}>
          We sent a 4-digit code to <Text style={s.subStrong}>{phone}</Text>{' '}
          <Text style={s.edit} onPress={onBack}>Edit</Text>
        </Text>
      </View>

      <Pressable style={s.boxRow} onPress={() => input.current?.focus()}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[s.box, i === code.length && s.boxActive]}>
            <Text style={s.boxDigit}>{code[i] ?? ''}</Text>
          </View>
        ))}
      </Pressable>
      <TextInput ref={input} value={code} style={s.hiddenInput} autoFocus
        keyboardType="number-pad" maxLength={4}
        onChangeText={(v) => { setError(null); setCode(v.replace(/\D/g, '')); }} />

      {error
        ? <Text style={s.error}>{error}</Text>
        : (
          <Text style={s.resend}>
            {countdown > 0
              ? <>Resend code in <Text style={s.subStrong}>0:{String(countdown).padStart(2, '0')}</Text></>
              : <Text style={s.edit} onPress={() => { setCountdown(45); onResend(); }}>Resend code</Text>}
          </Text>
        )}

      <Pressable onPress={verify} disabled={code.length < 4 || busy}
        style={({ pressed }) => [s.cta, (code.length < 4 || busy || pressed) && s.ctaDim]}>
        <Text style={s.ctaText}>{busy ? '…' : 'Verify'}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.8 },
  screen: { flex: 1, backgroundColor: colors.surface, padding: sp(6.5), paddingTop: sp(16), gap: sp(4) },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  step: { fontSize: 11, letterSpacing: 1.6, fontWeight: '700', color: colors.textSecondary },
  progress: { flexDirection: 'row', gap: 6 },
  progressSegOn: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  headBlock: { marginTop: sp(1.5), gap: sp(2.5) },
  display: {
    fontFamily: serif, fontSize: 32, lineHeight: 36, letterSpacing: 0.6,
    textTransform: 'uppercase', color: colors.text,
  },
  sub: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  subStrong: { color: colors.text, fontWeight: '600' },
  edit: { color: colors.accent, fontWeight: '600' },

  boxRow: { flexDirection: 'row', gap: sp(3), justifyContent: 'center', marginTop: sp(2.5) },
  box: {
    width: 64, height: 72, borderRadius: 18, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  boxActive: { borderWidth: 2, borderColor: colors.ink },
  boxDigit: { fontSize: 26, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },

  resend: { textAlign: 'center', fontSize: font.small, color: colors.textSecondary },
  error: { textAlign: 'center', fontSize: font.small, color: colors.danger, fontWeight: '600' },

  cta: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', marginTop: sp(1.5),
  },
  ctaDim: { opacity: 0.45 },
  ctaText: {
    color: colors.onAccent, fontSize: font.small, fontWeight: '700',
    letterSpacing: 1.3, textTransform: 'uppercase',
  },
});
