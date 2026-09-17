import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { dark as D } from '../theme';
import { Avatar, Btn, Ico, IconName, Note, Sheet, T } from './dark';

// BTD-13 — somebody in the line with no account: a guest from the web page, or a
// walk-in the barber wrote down himself. With no account there is no chat thread
// (BookingPanels' Chat tile) and nobody to rate (RateClientSheet); both are said as
// facts, and the number he gave — if he gave one — is what is left.
// Not drawn: "If he installs the app with this number, today's cut joins his
// history" — nothing joins a guest to an account yet (README §9).
//
// B10 adds BTD-16's way in, "give him another day". It needs a number to text the
// offer to, so on a nameless walk-in it is shown greyed with the reason, not hidden.

export type Guest = {
  firstName: string; phone: string | null;
  /** 'hand' — the barber added him at BTD-02 */
  source: 'code' | 'link' | 'hand';
  joinedAt: string; confirmed: boolean;
  no: number; service: string; durationMin: number | null; priceCents: number;
  startsAt: string; after: string | null;
};

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
/** "0661 34 12 90" */
const local = (phone: string) => {
  const d = phone.replace(/\D/g, '').slice(-9);
  return `0${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
};

export default function GuestSheet({ visible, guest, onClose, onCallUp, onTakeOff, anotherDay }: {
  visible: boolean; guest: Guest | null; onClose: () => void; onCallUp: () => void; onTakeOff: () => void;
  /** BTD-16: what to open, or why it cannot be offered */
  anotherDay: (() => void) | string;
}) {
  if (!guest) return null;
  const g = guest;
  // ADDENDUM-app-first: a web name is unconfirmed until he taps the link in his text
  const joined = g.source === 'hand'
    ? `You wrote him down at ${hhmm(g.joinedAt)} · no account`
    : g.confirmed
      ? `Joined ${g.source === 'link' ? 'from your link ' : ''}at ${hhmm(g.joinedAt)} · no account`
      : `Put on from the web at ${hhmm(g.joinedAt)} · hasn't tapped his text`;

  return (
    <Sheet visible={visible} onClose={onClose} gap={13}>
      <View style={s.head}>
        <Avatar size={50} icon="user" />
        <View style={s.grow}>
          <T w="b" size={16}>{g.firstName} · Nº {String(g.no).padStart(2, '0')}</T>
          <T size={11.5} c={D.sub} style={{ marginTop: 3 }}>{joined}</T>
        </View>
        {g.source === 'link' && (
          <View style={s.badge}><T w="eb" size={9} c={D.green} ls={0.7}>BY LINK</T></View>
        )}
      </View>

      <View style={s.stats}>
        <Stat label="SERVICE" value={g.service} sub={g.durationMin ? `${g.durationMin} min` : ' '} />
        <Stat label="IN CASH" value={`${Math.round(g.priceCents / 100)} DH`} sub="no deposit" subColor={D.amber} />
        <Stat label="DUE UP" value={hhmm(g.startsAt)} sub={g.after ? `after ${g.after}` : ' '} />
      </View>

      <View style={s.list}>
        {g.phone
          ? <Line icon="phone" iconColor={D.green} title={local(g.phone)}
              sub={g.source === 'hand' ? "You typed it · one text when he's next" : "He gave it to get the you're-next text"}
              action={{ label: 'Call', onPress: () => Linking.openURL(`tel:${g.phone}`) }} />
          : <Line icon="phone" title="No number" sub="You'll call his name" dim />}
        <Line icon="message-circle" title="No chat with a guest"
          sub="There's no account to message. Use the phone." dim rule />
        <Line icon="star" title="Nothing to rate him on"
          sub="Reliability starts when he makes an account" dim rule />
      </View>

      <Note>
        {g.confirmed
          ? 'He is a named walk-in in your day, the same as anyone off the street.'
          : 'Until he taps the link in his text his number is greyed, and you may call past it.'}
      </Note>

      <Btn title="CALL HIM UP NEXT" height={54} onPress={onCallUp} />
      {typeof anotherDay === 'function'
        ? (
          <Pressable onPress={anotherDay} accessibilityRole="button"
            style={({ pressed }) => [s.another, pressed && s.pressed]}>
            <Ico name="calendar" size={15} color={D.textDim} />
            <T w="b" size={12.5} c={D.textDim}>Give him another day</T>
          </Pressable>
        )
        : (
          <View style={[s.another, s.dim]} accessible
            accessibilityLabel={`Give him another day, not available: ${anotherDay}`}>
            <Ico name="calendar" size={15} color={D.sub} />
            <View style={{ alignItems: 'center' }}>
              <T w="b" size={12.5} c={D.sub}>Give him another day</T>
              <T size={10.5} c={D.faint}>{anotherDay}</T>
            </View>
          </View>
        )}
      <Pressable onPress={onTakeOff} hitSlop={8} accessibilityRole="button" style={s.takeOff}>
        <T w="sb" size={12} c={D.sub}>Take him off the line</T>
      </Pressable>
    </Sheet>
  );
}

function Stat({ label, value, sub, subColor }: { label: string; value: string; sub: string; subColor?: string }) {
  return (
    <View style={s.stat}>
      <T w="b" size={9.5} c={D.sub} ls={1}>{label}</T>
      <T w="b" size={13.5} numberOfLines={1} style={s.tnum}>{value}</T>
      <T size={10.5} c={subColor ?? D.sub} numberOfLines={1}>{sub}</T>
    </View>
  );
}

function Line({ icon, iconColor, title, sub, action, dim, rule }: {
  icon: IconName; iconColor?: string; title: string; sub: string;
  action?: { label: string; onPress: () => void }; dim?: boolean; rule?: boolean;
}) {
  return (
    <View style={[s.line, rule && s.lineRule, dim && s.dim]}>
      <Ico name={icon} size={15} color={iconColor ?? D.sub} />
      <View style={s.grow}>
        <T w={dim ? 'sb' : 'b'} size={12.5} c={dim ? D.sub : D.text}>{title}</T>
        <T size={10.5} c={dim ? D.faint : D.sub} style={{ marginTop: 2 }}>{sub}</T>
      </View>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button">
          <T w="b" size={11} c={D.green}>{action.label}</T>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  tnum: { fontVariant: ['tabular-nums'] },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { backgroundColor: D.greenSoft, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 7 },
  stats: { flexDirection: 'row', gap: 9 },
  stat: { flex: 1, backgroundColor: D.card, borderRadius: 16, padding: 13, gap: 3 },
  list: { backgroundColor: D.card, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 15 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13 },
  lineRule: { borderTopWidth: 1, borderTopColor: D.border },
  dim: { opacity: 0.5 },
  another: {
    minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: D.border, paddingVertical: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  takeOff: { alignSelf: 'center', paddingVertical: 2 },
});
