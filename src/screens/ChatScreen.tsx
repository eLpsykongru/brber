import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { useBack } from '../components/motion';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, inter, radius, shadow, sp, TOP_INSET } from '../theme';
import { loc, tr } from '../lib/i18n';
import { useHideTabBar } from '../components/TabBar';

type Msg = {
  id: string;
  sender_id: string;
  body: string | null;
  image_path: string | null;
  created_at: string;
};

type Props = {
  /** what a new message attaches to — always exactly one booking */
  bookingId: string;
  /**
   * The other person's user id. Messages are keyed on a booking, but you have
   * one conversation with your barber, not one per haircut — given this, the
   * thread reads every booking the two of you have ever shared. Omitted, or
   * equal to `myId` (a walk-in books under the barber's own id), and it reads
   * `bookingId` alone, which is what a caller with one booking in hand wants.
   */
  threadWith?: string;
  myId: string; title: string;
  subtitle?: string; avatarUrl?: string; onBack: () => void;
  dark?: boolean;   // 1m — the barber's thread sits on the dark canvas
  // the options sheet (MSG-03 barber, MSG-08 customer). A row with nothing
  // behind it is not drawn, and with no rows there is no ⋮.
  onOpenBooking?: () => void;
  /** "{day} {date} · {time} · {service}" under Open the booking */
  bookingLine?: string;
  onReport?: () => void;
  /** the barber's Call, drawn only when the client has a phone */
  peerPhone?: string | null;
};

// the three taps a barber actually makes mid-cut (1m)
const QUICK = [tr('Running 10 min late'), tr("You're next"), tr('See you soon')];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(loc('en-US'), { hour: '2-digit', minute: '2-digit' }).toLowerCase();
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yst = new Date(); yst.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return tr('TODAY');
  if (d.toDateString() === yst.toDateString()) return tr('YESTERDAY');
  return d.toLocaleDateString(loc('en-US'), { month: 'long', day: 'numeric' }).toUpperCase();
}

function initialsOf(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function ChatScreen({
  bookingId, threadWith, myId, title, subtitle, avatarUrl, onBack, dark,
  onOpenBooking, bookingLine, onReport, peerPhone,
}: Props) {
  useHideTabBar();
  const [options, setOptions] = useState(false);
  // MSG-02/07 — unread is the only status there is. The NEW divider sits where the
  // read mark was when the thread opened and stays until it is left; the mark
  // moves on open, and again on the way out for whatever arrived meanwhile (0131).
  const peer = threadWith && threadWith !== myId ? threadWith : null;
  const [readMark, setReadMark] = useState<Date | 'never' | null>(null);
  useEffect(() => {
    if (!peer) return;
    const mark = () => { supabase.rpc('mark_chat_read', { p_peer: peer }).then(() => {}); };
    supabase.rpc('chat_unread').then(({ data }) => {
      const row = ((data ?? []) as { peer_id: string; unread: number; last_read_at: string | null }[])
        .find((r) => r.peer_id === peer);
      if (row?.unread) setReadMark(row.last_read_at ? new Date(row.last_read_at) : 'never');
      mark();
    });
    return mark;
  }, [peer]);
  const [msgs, setMsgs] = useState<Msg[]>([]); // ascending (oldest → newest)
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(imageUrls);
  urlsRef.current = imageUrls;
  const listRef = useRef<FlatList<Msg>>(null);
  const back = useBack(onBack);
  // Resolved here rather than by each caller: the barber's list holds only a
  // date window of live bookings, so he could not work this out from memory.
  // A string, not an array: a fresh array literal every render would tear the
  // subscriptions down and rebuild them forever.
  const [scope, setScope] = useState(bookingId);

  useEffect(() => {
    if (!threadWith || threadWith === myId) { setScope(bookingId); return; }
    let live = true;
    supabase.from('bookings').select('id')
      // RLS already limits this to bookings you are party to; naming both
      // directions keeps it true read from either side of the chair
      .or(`and(customer_id.eq.${myId},barber_id.eq.${threadWith}),`
        + `and(customer_id.eq.${threadWith},barber_id.eq.${myId})`)
      .order('starts_at', { ascending: false }).limit(100)
      .then(({ data }) => {
        if (!live) return;
        // the booking we were opened on always counts, even if a hundred
        // newer ones pushed it past the limit
        const ids = [...new Set([bookingId, ...(data ?? []).map((b) => b.id)])];
        setScope(ids.join(','));
      });
    return () => { live = false; };
  }, [threadWith, myId, bookingId]);

  useEffect(() => {
    const ids = scope.split(',');
    supabase.from('messages')
      .select('id, sender_id, body, image_path, created_at')
      .in('booking_id', ids)
      .order('created_at', { ascending: true }).limit(200)
      .then(({ data, error }) => {
        if (error) Alert.alert(tr('Could not load chat'), error.message);
        else setMsgs(data);
      });

    // postgres_changes filters cannot express `in`, so one subscription each.
    // ponytail: only the newest few, or a regular of three years would open
    // sixty sockets to hear about a message nobody sends on a haircut he had
    // in 2024. Raise it if anyone ever replies on an old visit.
    const chans = ids.slice(0, 6).map((id) => supabase.channel(`chat-${id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${id}` },
        (payload) => {
          const m = payload.new as Msg;
          // always the newest, whichever booking it arrived on, so appending
          // keeps the merged list in order
          setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        })
      .subscribe());
    return () => { chans.forEach((c) => supabase.removeChannel(c)); };
  }, [scope]);

  // private bucket → images need short-lived signed URLs
  useEffect(() => {
    const missing = msgs.filter((m) => m.image_path && !urlsRef.current[m.image_path]);
    missing.forEach(async (m) => {
      const { data } = await supabase.storage.from('chat-images').createSignedUrl(m.image_path!, 3600);
      if (data) setImageUrls((prev) => ({ ...prev, [m.image_path!]: data.signedUrl }));
    });
  }, [msgs]);

  async function send(override?: string) {
    const body = (override ?? text).trim();
    if (!body) return;
    if (!override) setText('');
    const { error } = await supabase.from('messages')
      .insert({ booking_id: bookingId, sender_id: myId, body });
    if (error) Alert.alert(tr('Could not send'), error.message);
  }

  async function sendPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return;
    setBusy(true);
    try {
      const path = `${bookingId}/${Date.now()}.jpg`;
      const buf = await fetch(res.assets[0].uri).then((r) => r.arrayBuffer());
      const up = await supabase.storage.from('chat-images').upload(path, buf, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const { error } = await supabase.from('messages')
        .insert({ booking_id: bookingId, sender_id: myId, image_path: path });
      if (error) throw error;
    } catch (e: any) {
      Alert.alert(tr('Could not send photo'), e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const k = dark ? d : st;
  const firstNew = readMark === null ? -1 : msgs.findIndex((m) => m.sender_id !== myId
    && (readMark === 'never' || new Date(m.created_at) > readMark));
  // open on the divider when there is one; after that, follow new messages down
  const placed = useRef(false);
  const count = useRef(0);
  function place() {
    if (!placed.current && firstNew >= 0) {
      placed.current = true;
      count.current = msgs.length;
      listRef.current?.scrollToIndex({ index: firstNew, viewPosition: 0.15, animated: false });
    } else if (firstNew < 0 || msgs.length > count.current) {
      count.current = msgs.length;
      listRef.current?.scrollToEnd({ animated: false });
    }
  }
  const first = title.split(' ')[0];
  const call = peerPhone ? () => Linking.openURL(`tel:${peerPhone}`).catch(() => {}) : undefined;
  const rows = [
    onOpenBooking && { icon: 'calendar-outline' as const, label: tr('Open the booking'), sub: bookingLine, onPress: onOpenBooking },
    dark && call && { icon: 'call-outline' as const, label: tr('Call {name}', { name: first }), sub: peerPhone ?? undefined, onPress: call },
    onReport && { icon: 'flag-outline' as const, label: dark ? tr('Report to ops') : tr('Report a problem'), onPress: onReport, danger: !!dark },
  ].filter(Boolean) as OptionRow[];

  return (
    <KeyboardAvoidingView style={k.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={k.header}>
        <Pressable onPress={back} hitSlop={8} accessibilityLabel={tr('Back')} style={st.backBtn}>
          <Ionicons name="arrow-back" size={dark ? 17 : 20} color={colors.onAccent} />
        </Pressable>
        {avatarUrl
          ? <Image source={{ uri: avatarUrl }} style={k.headerAvatar} />
          : <View style={[k.headerAvatar, k.headerAvatarFallback]}>
              <Text style={k.headerInitials}>{initialsOf(title)}</Text>
            </View>}
        <View style={st.headerText}>
          <Text style={k.headerName} numberOfLines={1}>{title}</Text>
          <Text style={k.headerStatus} numberOfLines={1}>{subtitle ?? tr('Booking chat')}</Text>
        </View>
        {/* MSG-02: Call only when there is a phone to call; options take its place otherwise */}
        {dark && call && (
          <Pressable onPress={call} accessibilityLabel={tr('Call {name}', { name: first })} style={d.headerPuck}>
            <Ionicons name="call-outline" size={15} color={colors.onAccent} />
          </Pressable>
        )}
        {rows.length > 0 && (
          <Pressable onPress={() => setOptions(true)} accessibilityLabel={tr('Options')}
            style={dark ? d.headerPuck : st.backBtn}>
            <Ionicons name={dark ? 'ellipsis-horizontal' : 'ellipsis-vertical'} size={dark ? 15 : 18}
              color={colors.onAccent} />
          </Pressable>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={k.list}
        onContentSizeChange={place}
        onScrollToIndexFailed={() => listRef.current?.scrollToEnd({ animated: false })}
        ListFooterComponent={dark ? (
          <View style={d.quickRow}>
            {QUICK.map((q) => (
              <Pressable key={q} onPress={() => send(q)} accessibilityRole="button"
                style={({ pressed }) => [d.quickChip, pressed && st.pressed]}>
                <Text style={d.quickText}>{q}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        renderItem={({ item, index }) => {
          const mine = item.sender_id === myId;
          const showDay = index === 0
            || new Date(item.created_at).toDateString() !== new Date(msgs[index - 1].created_at).toDateString();
          return (
            <>
              {showDay && (
                <View style={st.daySep}><Text style={k.dayText}>{dayLabel(item.created_at)}</Text></View>
              )}
              {index === firstNew && (
                <View style={st.newRow}>
                  <View style={st.newLine} />
                  <Text style={st.newText}>{tr('NEW')}</Text>
                  <View style={st.newLine} />
                </View>
              )}
              <View style={[k.bubble, mine ? k.mine : k.theirs]}>
                {item.image_path && (
                  imageUrls[item.image_path]
                    ? <Image source={{ uri: imageUrls[item.image_path] }} style={st.photo} />
                    : <Text style={k.loading}>{tr('Loading photo…')}</Text>
                )}
                {!!item.body && <Text style={mine ? k.mineText : k.theirsText}>{item.body}</Text>}
              </View>
              <View style={[st.metaRow, mine ? st.metaRight : st.metaLeft]}>
                {!mine && !dark && (
                  <View style={st.metaAvatar}><Text style={st.metaAvatarText}>{initialsOf(title)}</Text></View>
                )}
                <Text style={k.metaText}>{mine ? tr('You') : title.split(' ')[0]} · {fmtTime(item.created_at)}</Text>
              </View>
            </>
          );
        }}
      />

      <View style={k.inputRow}>
        {/* photo · text · send — no emoji, paperclip or mic (the handoff removes all three) */}
        <Pressable onPress={sendPhoto} disabled={busy} hitSlop={10} accessibilityLabel={tr('Add a photo')}
          style={({ pressed }) => pressed && st.pressed}>
          <Ionicons name="image-outline" size={dark ? 20 : 23} color={dark ? D.sub : colors.textSecondary} />
        </Pressable>
        <TextInput style={k.input}
          placeholder={dark ? tr('Message {name}', { name: first }) : tr('Type a message here…')}
          placeholderTextColor={dark ? D.sub : colors.textTertiary}
          value={text} onChangeText={setText} onSubmitEditing={() => send()} returnKeyType="send" multiline />
        {/* voice notes are not built (BACKLOG, Chat) — the button is send, and waits for text */}
        <Pressable onPress={() => send()} disabled={!text.trim()}
          hitSlop={6} accessibilityLabel={tr('Send')}
          style={({ pressed }) => [k.sendBtn, !text.trim() && st.sendIdle, pressed && st.pressed]}>
          <Ionicons name="arrow-up" size={dark ? 17 : 20} color={colors.onAccent} />
        </Pressable>
      </View>

      <OptionsSheet visible={options} dark={dark} title={title} sub={dark ? undefined : subtitle}
        rows={rows} onClose={() => setOptions(false)} />
    </KeyboardAvoidingView>
  );
}

type OptionRow = {
  icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; onPress: () => void; danger?: boolean;
};

// MSG-03 (barber, dark) and MSG-08 (customer, light): the same few rows, each kit's sheet
function OptionsSheet({ visible, dark, title, sub, rows, onClose }: {
  visible: boolean; dark?: boolean; title: string; sub?: string; rows: OptionRow[]; onClose: () => void;
}) {
  const c = dark
    ? { sheet: D.sheet, card: D.card, line: D.border, text: D.text, sub: D.sub, bubble: D.card2, grab: D.hairline }
    : { sheet: colors.surface, card: colors.bg, line: colors.border, text: colors.text, sub: colors.textSecondary, bubble: colors.surface, grab: colors.line };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.sheetWrap}>
        <Pressable style={[st.scrim, { backgroundColor: dark ? D.scrim : 'rgba(0,0,0,.52)' }]} onPress={onClose} />
        <View style={[st.sheet, { backgroundColor: c.sheet, borderTopLeftRadius: dark ? 26 : 28, borderTopRightRadius: dark ? 26 : 28 }]}>
          <View style={[st.grabber, { backgroundColor: c.grab }]} />
          <View>
            <Text style={[st.sheetTitle, { color: c.text, fontSize: dark ? 18 : 17 }]}>{title}</Text>
            {!!sub && <Text style={[st.sheetSub, { color: c.sub }]}>{sub}</Text>}
          </View>
          <View style={[st.optCard, { backgroundColor: c.card }, !dark && shadow]}>
            {rows.map((r, i) => (
              <Pressable key={r.label} onPress={() => { onClose(); r.onPress(); }} accessibilityRole="button"
                style={({ pressed }) => [st.optRow, i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }, pressed && st.pressed]}>
                <View style={[st.optIcon, { backgroundColor: r.danger ? 'rgba(248,113,113,.14)' : c.bubble }]}>
                  <Ionicons name={r.icon} size={16} color={r.danger ? D.red : c.text} />
                </View>
                <View style={st.optBody}>
                  <Text style={[st.optLabel, { color: r.danger ? D.red : c.text }]}>{r.label}</Text>
                  {!!r.sub && <Text style={[st.optSub, { color: c.sub }]}>{r.sub}</Text>}
                </View>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onClose} accessibilityRole="button"
            style={({ pressed }) => [st.cancel, dark ? { borderColor: D.border } : { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1.5 }, pressed && st.pressed]}>
            <Text style={[st.cancelText, { color: c.text }]}>{dark ? tr('Cancel') : tr('CANCEL')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: colors.tabBg,
    paddingTop: sp(13), paddingBottom: sp(3), paddingHorizontal: sp(4),
    borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20 },
  headerAvatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  headerInitials: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  headerText: { flex: 1 },
  headerName: { fontSize: font.body, fontWeight: '700', color: colors.onAccent },
  headerStatus: { fontSize: font.tiny, color: colors.tabInactiveText },

  list: { padding: sp(4), gap: sp(1) },
  daySep: { alignItems: 'center', marginVertical: sp(3) },
  dayText: { fontSize: font.tiny, fontWeight: '700', color: colors.textTertiary, letterSpacing: 1 },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, padding: sp(3), marginTop: sp(1) },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.ink, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.bg, borderBottomLeftRadius: 4, ...shadow },
  mineText: { color: colors.onAccent, fontSize: font.body },
  theirsText: { color: colors.text, fontSize: font.body },
  loading: { color: colors.textTertiary, fontSize: font.small },
  photo: { width: 190, height: 190, borderRadius: radius.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5), marginBottom: sp(2) },
  metaLeft: { alignSelf: 'flex-start' },
  metaRight: { alignSelf: 'flex-end' },
  metaAvatar: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  metaAvatarText: { fontSize: 8, fontWeight: '700', color: colors.accent },
  metaText: { fontSize: font.tiny, color: colors.textTertiary },

  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2),
    paddingHorizontal: sp(3), paddingVertical: sp(2.5), paddingBottom: sp(6),
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  input: {
    flex: 1, borderRadius: radius.pill,
    paddingHorizontal: sp(4), paddingTop: Platform.OS === 'ios' ? sp(3) : sp(2),
    paddingBottom: Platform.OS === 'ios' ? sp(3) : sp(2), maxHeight: 110,
    fontSize: font.body, color: colors.text, backgroundColor: colors.bg, ...shadow,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  sendIdle: { opacity: 0.4 },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: sp(2) },
  newLine: { flex: 1, height: 1, backgroundColor: colors.accent },
  newText: { fontFamily: inter.b, fontSize: 10.5, letterSpacing: 1.4, color: colors.accent },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject },
  sheet: { paddingTop: 12, paddingHorizontal: 20, paddingBottom: 34, gap: 13 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2 },
  sheetTitle: { fontFamily: inter.b },
  sheetSub: { fontFamily: inter.r, fontSize: 12.5, marginTop: 3 },
  optCard: { borderRadius: 20, paddingHorizontal: 16 },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 64 },
  optIcon: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  optBody: { flex: 1, minWidth: 0 },
  optLabel: { fontFamily: inter.sb, fontSize: 15 },
  optSub: { fontFamily: inter.r, fontSize: 12, marginTop: 3 },
  cancel: { height: 52, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: inter.b, fontSize: 13.5, letterSpacing: 0.8 },
});

// 1m — same layout, barber palette. Square header, coral for what you said.
const d = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.card,
    borderBottomWidth: 1, borderBottomColor: D.border,
    paddingTop: TOP_INSET, paddingBottom: 14, paddingHorizontal: 16,
  },
  headerPuck: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  headerAvatar: { width: 40, height: 40, borderRadius: 999 },
  headerAvatarFallback: { backgroundColor: D.accentSoft, alignItems: 'center', justifyContent: 'center' },
  headerInitials: { fontFamily: inter.b, fontSize: 12, color: D.accent },
  headerName: { fontFamily: inter.b, fontSize: 14, color: D.text },
  headerStatus: { fontFamily: inter.r, fontSize: 11, color: D.sub },

  list: { paddingHorizontal: 16, paddingVertical: 18, gap: 4 },
  dayText: { fontFamily: inter.b, fontSize: 10, color: D.sub, letterSpacing: 2 },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, marginTop: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: D.accent, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: D.card, borderBottomLeftRadius: 4 },
  mineText: { color: '#fff', fontFamily: inter.r, fontSize: 14, lineHeight: 20 },
  theirsText: { color: D.text, fontFamily: inter.r, fontSize: 14, lineHeight: 20 },
  loading: { color: D.sub, fontFamily: inter.r, fontSize: 12 },
  metaText: { fontFamily: inter.r, fontSize: 10, color: D.sub },

  quickRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 14,
  },
  quickChip: {
    borderWidth: 1, borderColor: D.hairline, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13,
  },
  quickText: { fontFamily: inter.sb, fontSize: 11, color: D.sub },

  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.bg,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40,
    borderTopWidth: 1, borderTopColor: D.border,
  },
  input: {
    flex: 1, borderRadius: 999, backgroundColor: D.card, paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 13 : 8, paddingBottom: Platform.OS === 'ios' ? 13 : 8,
    maxHeight: 110, fontFamily: inter.r, fontSize: 13, color: D.text,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
});
