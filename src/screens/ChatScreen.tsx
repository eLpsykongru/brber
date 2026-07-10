import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { ScreenHeader } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';

type Msg = {
  id: string;
  sender_id: string;
  body: string | null;
  image_path: string | null;
  created_at: string;
};

type Props = { bookingId: string; myId: string; title: string; onBack: () => void };

export default function ChatScreen({ bookingId, myId, title, onBack }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(imageUrls);
  urlsRef.current = imageUrls;

  useEffect(() => {
    supabase.from('messages')
      .select('id, sender_id, body, image_path, created_at')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (error) Alert.alert('Could not load chat', error.message);
        else setMsgs(data);
      });

    const ch = supabase.channel(`chat-${bookingId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [m, ...prev]));
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
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.headerWrap}>
        <ScreenHeader title={title} onBack={onBack} />
      </View>
      <FlatList
        inverted
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.list}
        renderItem={({ item }) => {
          const mine = item.sender_id === myId;
          return (
            <View style={[s.bubble, mine ? s.mine : s.theirs]}>
              {item.image_path && (
                imageUrls[item.image_path]
                  ? <Image source={{ uri: imageUrls[item.image_path] }} style={s.photo} />
                  : <Text style={s.loading}>Loading photo…</Text>
              )}
              {!!item.body && <Text style={mine ? s.mineText : s.theirsText}>{item.body}</Text>}
            </View>
          );
        }}
      />
      <View style={s.inputRow}>
        <Pressable onPress={sendPhoto} disabled={busy} hitSlop={8} accessibilityLabel="Send a photo"
          style={({ pressed }) => [s.iconBtn, pressed && s.pressed, busy && s.disabled]}>
          <Ionicons name="camera-outline" size={22} color={colors.text} />
        </Pressable>
        <TextInput style={s.input} placeholder="Message…" placeholderTextColor={colors.textTertiary}
          value={text} onChangeText={setText} onSubmitEditing={send} returnKeyType="send" />
        <Pressable onPress={send} hitSlop={8} accessibilityLabel="Send message"
          style={({ pressed }) => [s.sendBtn, pressed && s.pressed]}>
          <Ionicons name="arrow-up" size={20} color={colors.onAccent} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: sp(5) },
  list: { padding: sp(4), gap: sp(2) },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, padding: sp(3), marginVertical: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  mineText: { color: colors.onAccent, fontSize: font.body },
  theirsText: { color: colors.text, fontSize: font.body },
  loading: { color: colors.textTertiary, fontSize: font.small },
  photo: { width: 180, height: 180, borderRadius: radius.md },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2),
    padding: sp(3), paddingBottom: sp(6),
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: sp(4), minHeight: 44, fontSize: font.body, color: colors.text,
    backgroundColor: colors.surface,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
