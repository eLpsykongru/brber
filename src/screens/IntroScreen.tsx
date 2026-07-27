import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AuthView } from './AuthScreen';
import { colors, font, radius, serif, serifBlack, shadow, sp } from '../theme';

// First-run onboarding trio (design 2a → 2b → 3a). Shown once, then straight to auth.
// ponytail: state-based slides, no paging ScrollView — swipe animation when someone misses it.
export default function IntroScreen({ onDone }: { onDone: (next: AuthView) => void }) {
  const [slide, setSlide] = useState(0);
  const next = () => (slide < 2 ? setSlide(slide + 1) : onDone('welcome'));

  if (slide === 0) {
    return (
      <View style={s.dark}>
        <Text style={s.logoDark}>Sterncut</Text>
        <View style={s.bottom}>
          <Text style={s.displayDark}>Your chair{'\n'}is waiting.</Text>
          <Text style={s.subDark}>
            Find the best barbers in Tangier, book a slot or take a queue ticket — no bench time.
          </Text>
          <Dots active={0} onDark />
          <Pressable onPress={next} style={({ pressed }) => [s.cta, s.ctaLight, pressed && s.pressed]}>
            <Text style={s.ctaTextDarkOnLight}>Get started</Text>
          </Pressable>
          <Text style={s.footerDark}>
            Already have an account?{' '}
            <Text style={s.footerDarkStrong} onPress={() => onDone('signin')}>Sign in</Text>
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.light}>
      <View style={s.lightHeader}>
        <Text style={s.logoLight}>Sterncut</Text>
        <Pressable onPress={() => onDone('welcome')} hitSlop={8}>
          <Text style={s.skip}>Skip</Text>
        </Pressable>
      </View>

      {slide === 1 ? <QueueIllustration /> : <BookingIllustration />}

      <View style={s.bottom}>
        <Text style={s.displayLight}>
          {slide === 1 ? 'Skip the bench,\nkeep your spot.' : 'Book in three\ntaps. Pay at\nthe shop.'}
        </Text>
        <Text style={s.subLight}>
          {slide === 1
            ? "Take a virtual ticket, see exactly who's ahead, and get a ping when you're next."
            : 'Pick a service, a specialist and a time — no card needed, cash at the counter.'}
        </Text>
        <Dots active={slide} />
        <Pressable onPress={next} style={({ pressed }) => [s.cta, s.ctaInk, pressed && s.pressed]}>
          <Text style={s.ctaTextLightOnInk}>{slide === 1 ? 'Next' : 'Get started'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Dots({ active, onDark }: { active: number; onDark?: boolean }) {
  return (
    <View style={s.dots}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[
          s.dot, onDark && s.dotOnDark,
          i === active && s.dotActive,
        ]} />
      ))}
    </View>
  );
}

// static mock of the live-queue card (2b) — marketing illustration, not real data
function QueueIllustration() {
  return (
    <View style={s.illustration}>
      <View style={s.queueCard}>
        <View style={s.rowBetween}>
          <View style={s.liveRow}>
            <View style={s.liveDot} />
            <Text style={s.liveLabel}>LIVE QUEUE</Text>
          </View>
          <View style={s.ticketBadge}><Text style={s.ticketBadgeText}>TICKET Nº 07</Text></View>
        </View>
        <Text style={s.queueBig}>3 ahead</Text>
        <Text style={s.queueSub}>Estimated wait ~40 min</Text>
        <View style={s.progressRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[s.progressSeg, i === 0 && s.progressSegOn]} />
          ))}
        </View>
      </View>
      <View style={s.nowCard}>
        <View style={s.nowNum}><Text style={s.nowNumText}>04</Text></View>
        <View style={s.grow}>
          <Text style={s.nowName}>Mehdi K.</Text>
          <Text style={s.nowMeta}>In the chair</Text>
        </View>
        <View style={s.nowBadge}><Text style={s.nowBadgeText}>NOW</Text></View>
      </View>
    </View>
  );
}

// static mock of the 3-tap booking card (3a)
function BookingIllustration() {
  const days: [string, string, boolean][] = [
    ['We', '22', false], ['Th', '23', true], ['Fr', '24', false], ['Sa', '25', false], ['Su', '26', false],
  ];
  return (
    <View style={s.illustration}>
      <View style={s.bookCard}>
        <View style={s.bookBarber}>
          <View style={s.bookAvatar}><Text style={s.bookAvatarText}>YE</Text></View>
          <View style={s.grow}>
            <Text style={s.nowName}>Youssef El Amrani</Text>
            <Text style={s.nowMeta}>Classic Haircut · 60 DH</Text>
          </View>
          <Text style={s.bookRating}>4.9 ★</Text>
        </View>
        <View style={s.rowBetween}>
          {days.map(([d, n, on]) => (
            <View key={n} style={s.dayCol}>
              <Text style={s.dayLabel}>{d}</Text>
              <View style={[s.dayNum, on && s.dayNumOn]}>
                <Text style={[s.dayNumText, on && s.dayNumTextOn]}>{n}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={s.slotRow}>
          {['10:30', '11:00', '11:30'].map((t, i) => (
            <View key={t} style={[s.slot, i === 1 && s.slotOn]}>
              <Text style={[s.slotText, i === 1 && s.slotTextOn]}>{t}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={s.bookedPill}>
        <Ionicons name="checkmark" size={14} color="#4ADE80" />
        <Text style={s.bookedPillText}>Booked — pay at the shop</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.85 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  dark: { flex: 1, backgroundColor: colors.ink, paddingHorizontal: sp(6.5) },
  light: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: sp(6.5) },
  logoDark: {
    fontFamily: serifBlack, fontSize: 20, letterSpacing: 4.4, textTransform: 'uppercase',
    color: colors.onAccent, textAlign: 'center', marginTop: sp(16),
  },
  lightHeader: {
    marginTop: sp(16), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  logoLight: {
    fontFamily: serifBlack, fontSize: 16, letterSpacing: 3.5, textTransform: 'uppercase', color: colors.text,
  },
  skip: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },

  bottom: { marginTop: 'auto', marginBottom: sp(11), gap: sp(4.5) },
  displayDark: {
    fontFamily: serif, fontSize: 38, lineHeight: 42, letterSpacing: 0.8,
    textTransform: 'uppercase', color: colors.onAccent,
  },
  displayLight: {
    fontFamily: serif, fontSize: 30, lineHeight: 34, letterSpacing: 0.6,
    textTransform: 'uppercase', color: colors.text,
  },
  subDark: { fontSize: 14, lineHeight: 21, color: 'rgba(255,255,255,0.65)', maxWidth: 300 },
  subLight: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, maxWidth: 300 },

  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#C9C5BB' },
  dotOnDark: { backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { width: 22, backgroundColor: colors.accent },

  cta: { height: 54, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ctaLight: { backgroundColor: colors.onAccent },
  ctaInk: { backgroundColor: colors.ink },
  ctaTextDarkOnLight: {
    color: colors.text, fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase',
  },
  ctaTextLightOnInk: {
    color: colors.onAccent, fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase',
  },
  footerDark: { textAlign: 'center', fontSize: font.small, color: 'rgba(255,255,255,0.6)' },
  footerDarkStrong: { color: colors.onAccent, fontWeight: '700' },

  illustration: { marginTop: sp(8), gap: sp(3.5) },

  queueCard: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: sp(5.5), gap: sp(3.5) },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
  liveLabel: { fontSize: 10, letterSpacing: 1.8, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  ticketBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.pill,
    paddingVertical: 5, paddingHorizontal: 10,
  },
  ticketBadgeText: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: colors.onAccent },
  queueBig: {
    fontFamily: serif, fontSize: 38, lineHeight: 40, color: colors.onAccent,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  queueSub: { fontSize: font.small, color: 'rgba(255,255,255,0.6)' },
  progressRow: { flexDirection: 'row', gap: 5 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  progressSegOn: { backgroundColor: colors.accent },

  nowCard: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: colors.bg, borderRadius: radius.lg, padding: sp(4), ...shadow,
  },
  nowNum: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  nowNumText: { fontSize: 12, fontWeight: '700', color: colors.accent },
  nowName: { fontSize: 14, fontWeight: '700', color: colors.text },
  nowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  nowBadge: {
    backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 10,
  },
  nowBadgeText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.onAccent },

  bookCard: {
    backgroundColor: colors.bg, borderRadius: radius.xl, padding: sp(5), gap: sp(3.5), ...shadow,
  },
  bookBarber: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  bookAvatar: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  bookAvatarText: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  bookRating: { fontSize: 12, fontWeight: '700', color: colors.text },
  dayCol: { alignItems: 'center', gap: 5 },
  dayLabel: { fontSize: 10, color: colors.textSecondary },
  dayNum: {
    width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
  },
  dayNumOn: { backgroundColor: colors.ink },
  dayNumText: { fontSize: font.small, fontWeight: '700', color: colors.text },
  dayNumTextOn: { color: colors.onAccent },
  slotRow: { flexDirection: 'row', gap: sp(2) },
  slot: {
    flex: 1, height: 40, borderRadius: 12, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  slotOn: { backgroundColor: colors.ink },
  slotText: { fontSize: 12, fontWeight: '600', color: colors.text },
  slotTextOn: { color: colors.onAccent, fontWeight: '700' },

  bookedPill: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.ink, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 18,
  },
  bookedPillText: { fontSize: 12, fontWeight: '700', color: colors.onAccent },
});
