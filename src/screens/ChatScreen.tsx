import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';

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
};

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

export default function ChatScreen({ bookingId, myId, title, subtitle, avatarUrl, onBack }: Props) {
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

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
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

  return (
    <KeyboardAvoidingView style={st.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* dark header */}
      <View style={st.header}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Back" style={st.backBtn}>
          <Ionicons name="arrow-back" size={20} color={colors.onAccent} />
        </Pressable>
        {avatarUrl
          ? <Image source={{ uri: avatarUrl }} style={st.headerAvatar} />
          : <View style={[st.headerAvatar, st.headerAvatarFallback]}><Text style={st.headerInitials}>{initialsOf(title)}</Text></View>}
        <View style={st.headerText}>
          <Text style={st.headerName} numberOfLines={1}>{title}</Text>
          {/* TODO(backlog): "Online" is real presence later; show booking context for now */}
          <Text style={st.headerStatus} numberOfLines={1}>{subtitle ?? 'Booking chat'}</Text>
        </View>
        <Pressable onPress={() => Alert.alert('Options', 'Coming soon — see BACKLOG.md')} hitSlop={8}
          accessibilityLabel="More options" style={st.backBtn}>
          <Ionicons name="ellipsis-vertical" size={18} color={colors.onAccent} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={st.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item, index }) => {
          const mine = item.sender_id === myId;
          const showDay = index === 0
            || new Date(item.created_at).toDateString() !== new Date(msgs[index - 1].created_at).toDateString();
          return (
            <>
              {showDay && (
                <View style={st.daySep}><Text style={st.dayText}>{dayLabel(item.created_at)}</Text></View>
              )}
              <View style={[st.bubble, mine ? st.mine : st.theirs]}>
                {item.image_path && (
                  imageUrls[item.image_path]
                    ? <Image source={{ uri: imageUrls[item.image_path] }} style={st.photo} />
                    : <Text style={st.loading}>Loading photo…</Text>
                )}
                {!!item.body && <Text style={mine ? st.mineText : st.theirsText}>{item.body}</Text>}
              </View>
              <View style={[st.metaRow, mine ? st.metaRight : st.metaLeft]}>
                {!mine && <View style={st.metaAvatar}><Text style={st.metaAvatarText}>{initialsOf(title)}</Text></View>}
                <Text style={st.metaText}>{mine ? 'You' : title.split(' ')[0]} · {fmtTime(item.created_at)}</Text>
              </View>
            </>
          );
        }}
      />

      {/* composer */}
      <View style={st.inputRow}>
        {/* TODO(backlog): emoji picker (system keyboard has emoji for now) */}
        <Pressable hitSlop={6} accessibilityLabel="Emoji"
          onPress={() => Alert.alert('Emoji', 'Use your keyboard’s emoji key — picker coming soon')}>
          <Ionicons name="happy-outline" size={22} color={colors.textSecondary} />
        </Pressable>
        <TextInput style={st.input} placeholder="Type a message here…" placeholderTextColor={colors.textTertiary}
          value={text} onChangeText={setText} onSubmitEditing={send} returnKeyType="send" multiline />
        <Pressable onPress={sendPhoto} disabled={busy} hitSlop={6} accessibilityLabel="Attach photo"
          style={({ pressed }) => pressed && st.pressed}>
          <Ionicons name="attach" size={24} color={colors.textSecondary} />
        </Pressable>
        {text.trim() ? (
          <Pressable onPress={send} hitSlop={6} accessibilityLabel="Send"
            style={({ pressed }) => [st.sendBtn, pressed && st.pressed]}>
            <Ionicons name="arrow-up" size={20} color={colors.onAccent} />
          </Pressable>
        ) : (
          // TODO(backlog): voice notes (expo-av record → upload → waveform playback)
          <Pressable onPress={() => Alert.alert('Voice notes', 'Coming soon — see BACKLOG.md')} hitSlop={6}
            accessibilityLabel="Record voice note"
            style={({ pressed }) => [st.sendBtn, pressed && st.pressed]}>
            <Ionicons name="mic" size={20} color={colors.onAccent} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: colors.tabBg,
    paddingTop: sp(13), paddingBottom: sp(3), paddingHorizontal: sp(4),
    borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg,
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
  mine: { alignSelf: 'flex-end', backgroundColor: colors.tabBg, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
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
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: sp(4), paddingTop: Platform.OS === 'ios' ? sp(3) : sp(2),
    paddingBottom: Platform.OS === 'ios' ? sp(3) : sp(2), maxHeight: 110,
    fontSize: font.body, color: colors.text, backgroundColor: colors.surface,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
