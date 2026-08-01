import { Feather } from '@expo/vector-icons';
import { ComponentProps, ReactNode } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextProps, TextStyle, View, ViewStyle,
} from 'react-native';
import { dark as d, inter, serif } from '../theme';

// The barber side's shared vocabulary, transcribed from "Barber App.dc.html" turn 1.
// Every screen there repeats the same six shapes — screen frame, sheet, top bar,
// stat tile, toggle, avatar — so they live here once and the numbers stay honest.

export type IconName = ComponentProps<typeof Feather>['name'];

export function Ico({ name, size = 16, color = d.text }: {
  name: IconName; size?: number; color?: string;
}) {
  return <Feather name={name} size={size} color={color} />;
}

// --- text -------------------------------------------------------------------

type TProps = TextProps & { children: ReactNode };

/** Inter body text. Weight picks the right family (RN can't synthesise weights). */
export function T({ w = 'r', size = 13, c = d.text, ls, style, ...rest }: TProps & {
  w?: keyof typeof inter; size?: number; c?: string; ls?: number;
}) {
  return (
    <Text {...rest} style={[
      { fontFamily: inter[w], fontSize: size, color: c },
      ls != null && { letterSpacing: ls },
      style,
    ]} />
  );
}

/** Playfair, the display face — always uppercase on this side. */
export function Serif({ size = 17, c = d.text, ls = 0.14, style, ...rest }: TProps & {
  size?: number; c?: string; ls?: number;
}) {
  return (
    <Text {...rest} style={[
      { fontFamily: serif, fontSize: size, color: c, letterSpacing: size * ls, textTransform: 'uppercase' },
      style,
    ]} />
  );
}

/** 10px / .16em uppercase eyebrow — the label above every number in the mock. */
export function Eyebrow({ children, c = d.sub, ls = 1.6, style }: {
  children: ReactNode; c?: string; ls?: number; style?: TextStyle;
}) {
  return <T w="b" size={10} c={c} ls={ls} style={style}>{children}</T>;
}

/** ★★★★★ with the unearned tail dimmed, as the mock draws it. */
export function Stars({ n, size = 10 }: { n: number; size?: number }) {
  return (
    <Text style={{ fontSize: size, color: d.amber }}>
      {'★'.repeat(n)}<Text style={{ color: d.muted }}>{'★'.repeat(5 - n)}</Text>
    </Text>
  );
}

// --- frames -----------------------------------------------------------------

/** Full dark canvas. `scroll` for the taller screens; `gap` matches the mock's column gap. */
export function Screen({ children, gap = 14, scroll = true, pad = true, bottom = 40 }: {
  children: ReactNode; gap?: number; scroll?: boolean; pad?: boolean; bottom?: number;
}) {
  const inner = [s.screenPad, pad ? null : { paddingHorizontal: 0 }, { gap }];
  if (!scroll) return <View style={s.screen}><View style={inner}>{children}</View></View>;
  return (
    <View style={s.screen}>
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={[inner, { paddingBottom: bottom }]}>
        {children}
      </ScrollView>
    </View>
  );
}

/** Bottom sheet over a scrim — 1c, 1d, 1h, 1k, 1r, 3a–3e all use this exact shell. */
export function Sheet({ visible, onClose, children, gap = 14, deep }: {
  visible: boolean; onClose: () => void; children: ReactNode; gap?: number; deep?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetWrap}>
        <Pressable style={[s.scrim, deep && { backgroundColor: d.scrimDeep }]} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}
            contentContainerStyle={{ gap }}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Sheet title row: optional back chevron on the left, close puck on the right. */
export function SheetHead({ title, onClose, onBack, left }: {
  title: string; onClose?: () => void; onBack?: () => void; left?: boolean;
}) {
  return (
    <View style={s.sheetHead}>
      {onBack
        ? <Pressable onPress={onBack} hitSlop={8} style={s.sheetHeadSide}><Ico name="chevron-left" /></Pressable>
        : !left && <View style={s.sheetHeadSide} />}
      <T w="b" size={17} style={left ? { flex: 1 } : s.sheetTitle}>{title}</T>
      {onClose
        ? <Pressable onPress={onClose} hitSlop={8} style={s.puck}><Ico name="x" /></Pressable>
        : <View style={s.sheetHeadSide} />}
    </View>
  );
}

/** Screen top bar: 38px round back puck, centred title, optional right puck. */
export function TopBar({ title, onBack, backIcon = 'arrow-left', right, onRight, plain }: {
  title: string; onBack?: () => void; backIcon?: IconName;
  right?: IconName; onRight?: () => void; plain?: boolean;
}) {
  return (
    <View style={s.topBar}>
      {onBack
        ? <Pressable onPress={onBack} hitSlop={8} style={s.puck38}><Ico name={backIcon} /></Pressable>
        : <View style={s.puck38Ghost} />}
      {plain
        ? <T w="b" size={17} style={s.topTitle}>{title}</T>
        : <Serif size={17} style={s.topTitle}>{title}</Serif>}
      {right
        ? <Pressable onPress={onRight} hitSlop={8} style={s.puck38}><Ico name={right} size={16} /></Pressable>
        : <View style={s.puck38Ghost} />}
    </View>
  );
}

// --- pieces -----------------------------------------------------------------

export function Card({ children, style, onPress, ring }: {
  children: ReactNode; style?: ViewStyle | ViewStyle[]; onPress?: () => void; ring?: string;
}) {
  const st = [s.card, ring ? { borderWidth: 2, borderColor: ring } : null, style];
  if (!onPress) return <View style={st}>{children}</View>;
  return <Pressable onPress={onPress} style={({ pressed }) => [st, pressed && s.pressed]}>{children}</Pressable>;
}

/** One of the three-up tiles: 10px eyebrow over a tabular number. */
export function Stat({ label, value, sub, unit, valueColor, radius = 20 }: {
  label: string; value: string; sub?: string; unit?: string; valueColor?: string; radius?: number;
}) {
  return (
    <View style={[s.stat, { borderRadius: radius }]}>
      <Eyebrow ls={0.8}>{label}</Eyebrow>
      <T w="b" size={22} c={valueColor ?? d.text} style={s.tnum}>
        {value}{unit ? <T w="r" size={12} c={d.sub}>{` ${unit}`}</T> : null}
      </T>
      {sub ? <T size={11} c={d.sub}>{sub}</T> : null}
    </View>
  );
}

export function Toggle({ on, onPress, color = d.green, small }: {
  on: boolean; onPress?: () => void; color?: string; small?: boolean;
}) {
  const w = small ? 38 : 42, h = small ? 22 : 24, k = small ? 16 : 18;
  return (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={8} style={[
      { width: w, height: h, borderRadius: 999, padding: 3, flexDirection: 'row' },
      { backgroundColor: on ? color : d.muted, justifyContent: on ? 'flex-end' : 'flex-start' },
    ]}>
      <View style={{
        width: k, height: k, borderRadius: 999,
        backgroundColor: on ? (color === d.green ? d.bg : '#fff') : d.sub,
      }} />
    </Pressable>
  );
}

/** Initials puck. `warm` = the coral treatment the mock gives known/booked clients. */
export function Avatar({ initials, size = 44, warm, dot, icon }: {
  initials?: string; size?: number; warm?: boolean; dot?: string; icon?: IconName;
}) {
  return (
    <View style={[s.avatar, { width: size, height: size },
      warm ? { backgroundColor: d.accentSoft } : { backgroundColor: d.card2 }]}>
      {icon
        ? <Ico name={icon} size={size * 0.4} color={d.sub} />
        : <T w="b" size={Math.round(size * 0.28)} c={warm ? d.accent : d.sub}>{initials}</T>}
      {dot ? <View style={[s.avatarDot, { backgroundColor: dot }]} /> : null}
    </View>
  );
}

/** Full-width pill CTA. */
export function Btn({ title, onPress, bg = d.accent, fg = '#fff', height = 52, icon, style, ls = 0.8 }: {
  title: string; onPress?: () => void; bg?: string; fg?: string; height?: number;
  icon?: IconName; style?: ViewStyle; ls?: number;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [
      s.btn, { height, backgroundColor: bg }, style, pressed && s.pressed,
    ]}>
      {icon ? <Ico name={icon} size={16} color={fg} /> : null}
      <T w={fg === d.bg ? 'eb' : 'b'} size={13} c={fg} ls={ls}>{title}</T>
    </Pressable>
  );
}

/** Outlined pill — RESCHEDULE / KEEP THE BOOKING / DECLINE. */
export function GhostBtn({ title, onPress, color = d.sub, border = d.border, height = 50, style }: {
  title: string; onPress?: () => void; color?: string; border?: string; height?: number; style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [
      s.btn, { height, borderWidth: 1, borderColor: border }, style, pressed && s.pressed,
    ]}>
      <T w="b" size={12} c={color} ls={0.6}>{title}</T>
    </Pressable>
  );
}

/** Segmented control on a #212125 track (1c, 1i, 1k). */
export function Segmented({ items, active, onChange, track = d.card2, height = 40 }: {
  items: { key: string; label: string; icon?: IconName }[];
  active: string; onChange?: (k: string) => void; track?: string; height?: number;
}) {
  return (
    <View style={[s.segTrack, { backgroundColor: track }]}>
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Pressable key={it.key} onPress={() => onChange?.(it.key)} style={[
            s.segItem, { height }, on && { backgroundColor: d.accent },
          ]}>
            {it.icon ? <Ico name={it.icon} size={15} color={on ? '#fff' : d.sub} /> : null}
            <T w="b" size={13} c={on ? '#fff' : d.sub}>{it.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The grey (i) footnote that closes half the screens in the mock. */
export function Note({ children, bg = d.card, radius = 16 }: {
  children: ReactNode; bg?: string; radius?: number;
}) {
  return (
    <View style={[s.note, { backgroundColor: bg, borderRadius: radius }]}>
      <Ico name="info" size={14} color={d.sub} />
      <T size={12} c={d.sub} style={{ flex: 1, lineHeight: 18 }}>{children}</T>
    </View>
  );
}

/** Radio row used by 1r's reasons and 3b's complaints. */
export function RadioRow({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.radioRow, on && { borderWidth: 2, borderColor: d.accent }]}>
      <T w={on ? 'b' : 'sb'} size={13} style={{ flex: 1 }}>{label}</T>
      {on
        ? <View style={s.radioOn}><Ico name="check" size={10} color="#fff" /></View>
        : <View style={s.radioOff} />}
    </Pressable>
  );
}

export const TAB_INSET = 104;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: d.bg },
  screenPad: { paddingTop: 62, paddingHorizontal: 20 },

  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: d.scrim },
  sheet: {
    backgroundColor: d.sheet, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingTop: 12, paddingHorizontal: 22, paddingBottom: 34, maxHeight: '92%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: d.hairline, marginBottom: 14 },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  sheetHeadSide: { width: 32, height: 32, justifyContent: 'center' },
  sheetTitle: { flex: 1, textAlign: 'center' },
  puck: { width: 32, height: 32, borderRadius: 999, backgroundColor: d.card2, alignItems: 'center', justifyContent: 'center' },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck38: { width: 38, height: 38, borderRadius: 999, backgroundColor: d.card2, alignItems: 'center', justifyContent: 'center' },
  puck38Ghost: { width: 38, height: 38 },
  topTitle: { flex: 1, textAlign: 'center' },

  card: { backgroundColor: d.card, borderRadius: 20, padding: 16 },
  stat: { flex: 1, backgroundColor: d.card, padding: 14, gap: 3 },
  tnum: { fontVariant: ['tabular-nums'] },

  avatar: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  avatarDot: {
    position: 'absolute', right: 0, bottom: 0, width: 11, height: 11, borderRadius: 999,
    borderWidth: 2, borderColor: d.card,
  },

  btn: { borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  segTrack: { flexDirection: 'row', borderRadius: 999, padding: 4, gap: 4 },
  segItem: { flex: 1, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 13, paddingHorizontal: 15 },

  radioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: d.card,
    borderRadius: 14, padding: 14, paddingHorizontal: 15,
  },
  radioOn: { width: 20, height: 20, borderRadius: 999, backgroundColor: d.accent, alignItems: 'center', justifyContent: 'center' },
  radioOff: { width: 20, height: 20, borderRadius: 999, borderWidth: 1.5, borderColor: d.muted },

  pressed: { opacity: 0.75 },
});
