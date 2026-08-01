import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, inter, radius, shadow, sp } from '../theme';

type Msg = {
  id: string;
  sender_id: string;
  body: string | null;
  image_path: string | null;
  created_at: string;
};

type Props = {
  bookingId: string; myId: string; title: string;
  subtitle?: string; avatarUrl?: string; onBack: () => void;
  dark?: boolean;   // 1m — the barber's thread sits on the dark canvas
};

// the three taps a barber actually makes mid-cut (1m)
const QUICK = ['Running 10 min late', "You're next", 'See you soon'];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }).toLowerCase();
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yst = new Date(); yst.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'TODAY';
  if (d.toDateString() === yst.toDateString()) return 'YESTERDAY';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toUpperCase();
}

function initialsOf(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function ChatScreen({ bookingId, myId, title, subtitle, avatarUrl, onBack, dark }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]); // ascending (oldest → newest)
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(imageUrls);
  urlsRef.current = imageUrls;
  const listRef = useRef<FlatList<Msg>>(null);

  useEffect(() => {
    supabase.from('messages')
      .select('id, sender_id, body, image_path, created_at')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true }).limit(200)
      .then(({ data, error }) => {
        if (error) Alert.alert('Could not load chat', error.message);
        else setMsgs(data);
      });

    const ch = supabase.channel(`chat-${bookingId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [bookingId]);

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
    if (error) Alert.alert('Could not send', error.message);
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
      Alert.alert('Could not send photo', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const k = dark ? d : st;

  return (
    <KeyboardAvoidingView style={k.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={k.header}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Back" style={st.backBtn}>
          <Ionicons name="arrow-back" size={dark ? 17 : 20} color={colors.onAccent} />
        </Pressable>
        {avatarUrl
          ? <Image source={{ uri: avatarUrl }} style={k.headerAvatar} />
          : <View style={[k.headerAvatar, k.headerAvatarFallback]}>
              <Text style={k.headerInitials}>{initialsOf(title)}</Text>
            </View>}
        <View style={st.headerText}>
          <Text style={k.headerName} numberOfLines={1}>{title}</Text>
          <Text style={k.headerStatus} numberOfLines={1}>{subtitle ?? 'Booking chat'}</Text>
        </View>
        <Pressable onPress={() => Alert.alert('Options', 'Coming soon — see BACKLOG.md')} hitSlop={8}
          accessibilityLabel="More options" style={dark ? d.headerPuck : st.backBtn}>
          <Ionicons name={dark ? 'call-outline' : 'ellipsis-vertical'} size={dark ? 15 : 18}
            color={colors.onAccent} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={k.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
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
              <View style={[k.bubble, mine ? k.mine : k.theirs]}>
                {item.image_path && (
                  imageUrls[item.image_path]
                    ? <Image source={{ uri: imageUrls[item.image_path] }} style={st.photo} />
                    : <Text style={k.loading}>Loading photo…</Text>
                )}
                {!!item.body && <Text style={mine ? k.mineText : k.theirsText}>{item.body}</Text>}
              </View>
              <View style={[st.metaRow, mine ? st.metaRight : st.metaLeft]}>
                {!mine && !dark && (
                  <View style={st.metaAvatar}><Text style={st.metaAvatarText}>{initialsOf(title)}</Text></View>
                )}
                <Text style={k.metaText}>{mine ? 'You' : title.split(' ')[0]} · {fmtTime(item.created_at)}</Text>
              </View>
            </>
          );
        }}
      />

      <View style={k.inputRow}>
        {!dark && (
          <Pressable hitSlop={6} accessibilityLabel="Emoji"
            onPress={() => Alert.alert('Emoji', 'Use your keyboard’s emoji key — picker coming soon')}>
            <Ionicons name="happy-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        )}
        <TextInput style={k.input}
          placeholder={dark ? `Message ${title.split(' ')[0]}…` : 'Type a message here…'}
          placeholderTextColor={dark ? D.sub : colors.textTertiary}
          value={text} onChangeText={setText} onSubmitEditing={() => send()} returnKeyType="send" multiline />
        <Pressable onPress={sendPhoto} disabled={busy} hitSlop={6} accessibilityLabel="Attach photo"
          style={({ pressed }) => pressed && st.pressed}>
          <Ionicons name="attach" size={dark ? 20 : 24} color={dark ? D.sub : colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => text.trim() ? send() : Alert.alert('Voice notes', 'Coming soon — see BACKLOG.md')}
          hitSlop={6} accessibilityLabel={text.trim() ? 'Send' : 'Record voice note'}
          style={({ pressed }) => [k.sendBtn, pressed && st.pressed]}>
          <Ionicons name={text.trim() ? 'arrow-up' : 'mic'} size={dark ? 17 : 20} color={colors.onAccent} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
});

// 1m — same layout, barber palette. Square header, coral for what you said.
const d = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.card,
    borderBottomWidth: 1, borderBottomColor: D.border,
    paddingTop: 58, paddingBottom: 14, paddingHorizontal: 16,
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
