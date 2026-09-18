import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { dark as D } from '../theme';
import { Ico, Serif, Sheet, T } from './dark';
import { tr } from '../lib/i18n';

// The only two questions a queue asks the barber (ADDENDUM-app-first, turn B10).
// Nothing is decided for him on a clock he cannot see: each sheet is a decision,
// its default keeps the shop moving, and closing it leaves the line as it was.

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const minsSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
/** "+212 6 12 34 56 78" */
const spaced = (phone: string) => {
  const d = phone.replace(/\D/g, '').slice(-9);
  return `+212 ${d[0]} ${d.slice(1, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
};

export type AskedRow = {
  no: number; name: string; service: string;
  /** a number to reach him on: a web guest's, or one the barber typed */
  phone: string | null;
};

// ---- BTD-15 · called, held eight minutes, he isn't there -------------------------------
export function CalledSheet({ visible, row, calledAt, nextNo, onClose, onNext, onHere, onTakeOff }: {
  visible: boolean; row: AskedRow | null; calledAt: string | null;
  /** who is up once he drops to the end; null when nobody else is waiting */
  nextNo: number | null;
  onClose: () => void; onNext: () => void; onHere: () => void; onTakeOff: () => void;
}) {
  if (!row || !calledAt) return null;
  const held = Math.min(minsSince(calledAt), 99);
  return (
    <Sheet visible={visible} onClose={onClose} gap={15} deep>
      <View style={s.head}>
        <View style={[s.headIco, { backgroundColor: 'rgba(248,113,113,0.12)' }]}>
          <Ico name="clock" size={23} color={D.red} />
        </View>
        <View style={s.grow}>
          <Serif size={21} ls={0} style={s.title}>{tr('Nº {no} didn\'t come', { no: pad(row.no) })}</Serif>
          <T size={12} c={D.sub}>{tr('Called {calledAt} · held the chair {held} min', { calledAt: hhmm(calledAt), held })}</T>
        </View>
      </View>

      <View style={s.rowCard}>
        <View style={s.ticket}><T w="b" size={12} c={D.sub}>{pad(row.no)}</T></View>
        <View style={s.grow}>
          <T w="b" size={14}>{row.name}</T>
          <T size={11} c={D.sub} style={{ marginTop: 2 }}>
            {row.service} · {row.phone ? spaced(row.phone) : tr('no number to text')}
          </T>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Pressable onPress={onNext} accessibilityRole="button"
          style={({ pressed }) => [s.primary, pressed && s.pressed]}>
          <T w="b" size={13} c="#fff" ls={0.65}>{tr('CALL THE NEXT MAN')}</T>
          <T size={10.5} c="rgba(255,255,255,0.75)">
            {tr('Nº {no} drops to the end · {x}', { no: pad(row.no), x: nextNo ? tr('Nº {nextNo} is up', { nextNo: pad(nextNo) }) : tr('nobody else is waiting') })}
          </T>
        </Pressable>
        <View style={s.pair}>
          <Pressable onPress={onHere} accessibilityRole="button"
            style={({ pressed }) => [s.secondary, pressed && s.pressed]}>
            <T w="b" size={12.5} c={D.textDim}>{tr('He\'s here')}</T>
          </Pressable>
          <Pressable onPress={onTakeOff} accessibilityRole="button"
            style={({ pressed }) => [s.secondary, pressed && s.pressed]}>
            <T w="b" size={12.5} c={D.red}>{tr('Take him off')}</T>
          </Pressable>
        </View>
      </View>

      <T size={11} c={D.faint} style={s.foot}>
        {tr('Dropping him to the end keeps him in the shop\'s line but stops him counting toward anyone\'s wait. Nothing is recorded against him — a walk-in with no account has no no-show history to hold.')}
      </T>
    </Sheet>
  );
}

// ---- BTD-17 · the unconfirmed man reached the front ---------------------------------------
export function FrontSheet({ visible, row, textedAt, onClose, onCall, onDrop }: {
  visible: boolean; row: AskedRow | null; textedAt: string | null;
  onClose: () => void; onCall: () => void; onDrop: () => void;
}) {
  if (!row) return null;
  return (
    <Sheet visible={visible} onClose={onClose} gap={15} deep>
      <View style={s.head}>
        <View style={[s.headIco, { backgroundColor: D.amberSoft12 }]}>
          <Ico name="message-square" size={23} color={D.amber} />
        </View>
        <View style={s.grow}>
          <Serif size={21} ls={0} style={s.title}>{tr('{name} never tapped', { name: row.name })}</Serif>
          <T size={12} c={D.sub}>
            {tr('Nº {no}{x} · he\'s next', { no: pad(row.no), x: textedAt ? tr(' · texted {textedAt} min ago', { textedAt: minsSince(textedAt) }) : '' })}
          </T>
        </View>
      </View>

      <View style={s.factCard}>
        <T size={12} c={D.textDim} style={{ lineHeight: 18.5 }}>
          {tr('He put his name in from the web and we couldn\'t verify his number. He may be outside, or he may have forgotten.')}
        </T>
        {row.phone && (
          <View style={s.phoneRow}>
            <Ico name="phone" size={13} color={D.sub} />
            <T w="b" size={12} style={s.tnum}>{spaced(row.phone)}</T>
            <View style={s.grow} />
            <T size={10.5} c={D.faint}>{tr('unverified')}</T>
          </View>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Pressable onPress={onCall} accessibilityRole="button"
          style={({ pressed }) => [s.primary, pressed && s.pressed]}>
          <T w="b" size={13} c="#fff" ls={0.65}>{tr('CALL HIM ANYWAY')}</T>
          <T size={10.5} c="rgba(255,255,255,0.75)">{tr('Shout the name · 8-minute hold as usual')}</T>
        </Pressable>
        <View style={s.pair}>
          {row.phone && (
            <Pressable onPress={() => Linking.openURL(`tel:${row.phone}`)} accessibilityRole="button"
              style={({ pressed }) => [s.secondary, pressed && s.pressed]}>
              <T w="b" size={12.5} c={D.textDim}>{tr('Ring him')}</T>
            </Pressable>
          )}
          <Pressable onPress={onDrop} accessibilityRole="button"
            style={({ pressed }) => [s.secondary, pressed && s.pressed]}>
            <T w="b" size={12.5} c={D.red}>{tr('Drop him')}</T>
          </Pressable>
        </View>
      </View>

      <T size={11} c={D.faint} style={s.foot}>
        {tr('Asked once, here, and never again — there is no timer quietly deleting people from your line behind your back.')}
      </T>
    </Sheet>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  tnum: { fontVariant: ['tabular-nums'] },
  head: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  headIco: { width: 52, height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  title: { textTransform: 'none', lineHeight: 25, marginBottom: 3 },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 15,
  },
  ticket: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  factCard: { backgroundColor: D.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 15, gap: 9 },
  phoneRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: D.seam, paddingTop: 9,
  },
  primary: {
    height: 54, borderRadius: 16, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  pair: { flexDirection: 'row', gap: 8 },
  secondary: {
    flex: 1, height: 46, borderRadius: 16, backgroundColor: D.card, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },
  foot: { textAlign: 'center', lineHeight: 16.5, paddingHorizontal: 6 },
});
