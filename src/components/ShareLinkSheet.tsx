import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { queueUrl } from '../lib/qr';
import { shareMessage, smsLength } from '../lib/shareText';
import { supabase } from '../lib/supabase';
import { dark as D, inter } from '../theme';
import { Btn, Eyebrow, Ico, IconName, Sheet, T } from './dark';
import { tr } from '../lib/i18n';

// BTD-11 — send the line link. It replaces the Alert that sent a barber with a
// client on the phone off to find the poster.
//   · Where it points is picked first, and starts on his own chair: somebody
//     asked him how long.
//   · The channel is a cost, said out loud. WhatsApp is free; an SMS goes from his
//     phone on his plan, and the counter is what a carrier really counts.
//   · The warning under it is the README's sentence: a link is not a held place.
// Not here, because nothing in the app knows it: who asked about today (the
// design's prefilled recipient — he types it), and a fallback for a phone without
// WhatsApp (not designed; wa.me opens WhatsApp's own web page).

type Chair = {
  code: string; name: string; waiting: number; next_no: number; state: string;
  services: { wait_min: number | null }[];
};
type Queue = { found: boolean; name: string; open: boolean; chosen: string | null; chairs: Chair[] };

export type LinkSend = {
  id: string; sent_at: string; points_at: 'chair' | 'shop'; channel: 'whatsapp' | 'sms' | 'copy';
  to_name: string | null; to_phone: string | null;
  /** 0114 — a ticket joined today, after the send, on the number it went to */
  taken: { booking_id: string; at: string } | null;
};

const CHANNELS: { key: LinkSend['channel']; label: string; icon: IconName; cost: string; costColor: string }[] = [
  { key: 'whatsapp', label: tr('WhatsApp'), icon: 'message-circle', cost: tr('Free'), costColor: D.green },
  { key: 'sms', label: tr('SMS'), icon: 'mail', cost: tr('Metered'), costColor: D.amber },
  { key: 'copy', label: tr('Copy'), icon: 'copy', cost: tr('Paste it'), costColor: D.faint },
];

const waitOf = (c: Chair) => Math.min(...c.services.map((v) => v.wait_min ?? Infinity));
const firstName = (n: string) => n.split(' ')[0];
const pad = (n: number) => String(n).padStart(2, '0');

export default function ShareLinkSheet({ visible, barberId, onClose, onSent }: {
  visible: boolean; barberId: string; onClose: () => void; onSent: (send: LinkSend) => void;
}) {
  const [codes, setCodes] = useState<{ shop: string; barber: string } | null>(null);
  const [q, setQ] = useState<Queue | null>(null);
  const [points, setPoints] = useState<LinkSend['points_at']>('chair');
  const [channel, setChannel] = useState<LinkSend['channel']>('whatsapp');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.from('barbers')
        .select('short_code, salon:salons!salon_id(short_code)').eq('id', barberId).single();
      const me = data as unknown as { short_code: string | null; salon: { short_code: string } | null } | null;
      if (!alive || !me?.short_code || !me.salon?.short_code) return;
      setCodes({ shop: me.salon.short_code, barber: me.short_code });
      // 0110's page read: the same numbers the person will see when the link opens
      const { data: page } = await supabase.rpc('public_queue',
        { p_shop: me.salon.short_code, p_barber: me.short_code });
      if (alive) setQ((page as Queue | null)?.found ? (page as Queue) : null);
    })();
    return () => { alive = false; };
  }, [visible, barberId]);

  const mine = q?.chairs.find((c) => c.code === q.chosen) ?? null;
  const taking = (q?.open ? q.chairs : []).filter((c) => c.state === 'taking' && waitOf(c) < Infinity);
  const mineTaking = !!mine && taking.includes(mine);
  const soonest = [...taking].sort((a, b) => waitOf(a) - waitOf(b))[0] ?? null;
  const info = (c: Chair) => ({ name: c.name, waiting: c.waiting, waitMin: waitOf(c) });

  const url = codes ? queueUrl(codes.shop, points === 'chair' ? codes.barber : null) : '';
  const message = codes && q ? shareMessage({
    shop: q.name, url,
    chair: points === 'chair' && mineTaking ? info(mine!) : null,
    soonest: points === 'shop' && soonest ? info(soonest) : null,
  }) : '';
  const length = smsLength(message);
  const no = points === 'chair' ? mine?.next_no : soonest?.next_no;

  const to = name.trim() ? firstName(name.trim()).toUpperCase() : '';
  const cta = channel === 'copy' ? tr('COPY THE MESSAGE')
    : channel === 'whatsapp'
      ? (to ? tr('SEND TO {to} ON WHATSAPP', { to }) : tr('SEND ON WHATSAPP'))
      : (to ? tr('SEND TO {to} BY SMS', { to }) : tr('SEND BY SMS'));

  async function send() {
    if (!message || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('record_link_send', {
      p_points_at: points, p_channel: channel,
      p_to_name: name.trim() || null, p_to_phone: phone.trim() || null,
    });
    setBusy(false);
    if (error) return Alert.alert(tr('Could not send the link'), error.message);

    const text = encodeURIComponent(message);
    const nine = phone.replace(/\D/g, '').slice(-9);
    if (channel === 'copy') {
      await Clipboard.setStringAsync(message);
    } else {
      const target = channel === 'whatsapp'
        ? (nine.length === 9 ? `https://wa.me/212${nine}?text=${text}` : `https://wa.me/?text=${text}`)
        : `sms:${phone.trim()}${Platform.OS === 'ios' ? '&' : '?'}body=${text}`;
      await Linking.openURL(target).catch(() =>
        Alert.alert(tr('Could not open it'), channel === 'sms' ? tr('This phone has no messages app.') : tr('WhatsApp did not open.')));
    }
    const sent = data as { id: string; sent_at: string };
    onSent({
      id: sent.id, sent_at: sent.sent_at, points_at: points, channel,
      to_name: name.trim() || null, to_phone: phone.trim() || null, taken: null,
    });
    setName('');
    setPhone('');
    onClose();
  }

  const chairSub = !q ? ' '
    : mineTaking ? tr('Your chair · {waiting} waiting · ~{wait} min', { waiting: mine!.waiting, wait: waitOf(mine!) })
      : tr('Your chair · not taking anyone right now');

  return (
    <Sheet visible={visible} onClose={onClose} gap={12}>
      <View style={s.head}>
        <View style={s.grow}>
          <T w="b" size={17}>{tr('Send the line link')}</T>
          <T size={11} c={D.sub} style={{ marginTop: 2 }}>{chairSub}</T>
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('Close')}
          style={({ pressed }) => [s.close, pressed && s.pressed]}>
          <Ico name="x" size={16} />
        </Pressable>
      </View>

      <Eyebrow ls={1.4}>{tr('WHERE IT POINTS')}</Eyebrow>
      <View style={{ gap: 8 }}>
        <Option on={points === 'chair'} onPress={() => setPoints('chair')} title={tr('My chair')}
          mono={codes ? `/q/${codes.shop}?b=${codes.barber}` : ' '}
          right={mine ? `Nº ${pad(mine.next_no)}` : null} />
        <Option on={points === 'shop'} onPress={() => setPoints('shop')} title={tr('The whole shop')}
          sub={soonest ? tr('They pick a chair · {name} is free in ~{soonest} min', { name: firstName(soonest.name), soonest: waitOf(soonest) }) : tr('They pick a chair')} />
      </View>

      <Eyebrow ls={1.4}>{tr('WHAT THEY GET')}</Eyebrow>
      <View style={s.message}>
        <View style={s.bubble}>
          <T size={12.5} style={{ lineHeight: 19 }}>{message || ' '}</T>
        </View>
        <View style={s.countRow}>
          <T size={10.5} c={D.faint} style={s.grow}>{tr('The wait is written into the text, not only the preview card')}</T>
          <T w="b" size={10.5} c={length.sends === 1 ? D.green : D.amber} style={s.tnum}>
            {length.chars}/{length.limit}{length.sends > 1 ? tr(' · {sends} sends', { sends: length.sends }) : ''}
          </T>
        </View>
      </View>

      <Eyebrow ls={1.4}>{tr('SEND IT BY')}</Eyebrow>
      <View style={s.channels}>
        {CHANNELS.map((c) => {
          const on = channel === c.key;
          return (
            <Pressable key={c.key} onPress={() => setChannel(c.key)} accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [s.channel, on && s.channelOn, pressed && s.pressed]}>
              <Ico name={c.icon} size={18} color={on ? D.green : D.sub} />
              <T w={on ? 'b' : 'sb'} size={11.5} c={on ? D.text : D.textDim}>{c.label}</T>
              <T w="sb" size={9.5} c={c.costColor}>{c.cost}</T>
            </Pressable>
          );
        })}
      </View>

      <View style={s.recipient}>
        <TextInput value={name} onChangeText={setName} placeholder={tr('Their name')}
          placeholderTextColor={D.faint} style={s.input} maxLength={40} autoCapitalize="words" />
        <View style={s.inputRule} />
        <TextInput value={phone} onChangeText={setPhone} placeholder={tr('Their phone')}
          placeholderTextColor={D.faint} style={s.input} keyboardType="phone-pad" autoComplete="tel" />
      </View>

      <View style={s.warn}>
        <Ico name="info" size={14} color={D.sub} />
        <T size={11.5} c={D.sub} style={[s.grow, { lineHeight: 17 }]}>
          {no != null
            ? tr('A link is not a held place. Whoever takes a ticket first gets Nº {no} — including someone who walks in off the street.', { no: pad(no) })
            : tr('A link is not a held place.')}
        </T>
      </View>

      <Btn title={busy ? tr('SENDING…') : cta} height={54} onPress={message && !busy ? send : undefined} />
    </Sheet>
  );
}

function Option({ on, onPress, title, mono, sub, right }: {
  on: boolean; onPress: () => void; title: string; mono?: string; sub?: string; right?: string | null;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}
      style={({ pressed }) => [s.option, on && s.optionOn, pressed && s.pressed]}>
      {on
        ? <View style={s.radioOn}><Ico name="check" size={11} color="#fff" /></View>
        : <View style={s.radioOff} />}
      <View style={s.grow}>
        <T w={on ? 'b' : 'sb'} size={13}>{title}</T>
        {mono ? <T size={10.5} c={D.sub} style={s.mono}>{mono}</T> : null}
        {sub ? <T size={10.5} c={D.sub} style={{ marginTop: 2 }}>{sub}</T> : null}
      </View>
      {right ? <T w="b" size={11} c={D.sub}>{right}</T> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  tnum: { fontVariant: ['tabular-nums'] },
  head: { flexDirection: 'row', alignItems: 'center' },
  close: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  optionOn: { borderWidth: 2, borderColor: D.accent },
  radioOn: {
    width: 20, height: 20, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOff: { width: 20, height: 20, borderRadius: 999, borderWidth: 1.5, borderColor: D.muted },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), marginTop: 2 },
  message: { backgroundColor: D.card, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 15, gap: 9 },
  bubble: {
    backgroundColor: D.card2, borderTopLeftRadius: 14, borderTopRightRadius: 14,
    borderBottomRightRadius: 14, borderBottomLeftRadius: 5, paddingVertical: 12, paddingHorizontal: 14,
  },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  channels: { flexDirection: 'row', gap: 8 },
  channel: {
    flex: 1, backgroundColor: D.card, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 10,
    alignItems: 'center', gap: 5,
  },
  channelOn: { borderWidth: 2, borderColor: D.green },
  recipient: { backgroundColor: D.card, borderRadius: 16, paddingHorizontal: 14 },
  input: { fontFamily: inter.sb, fontSize: 13, color: D.text, height: 46 },
  inputRule: { height: 1, backgroundColor: D.border },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
});
