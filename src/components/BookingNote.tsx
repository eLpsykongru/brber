import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { PillButton } from './ui';
import { colors, inter, radius, sp } from '../theme';

// 39d of "Customer App 3.dc.html" — "anything he should know?"
//
// BACKLOG has wanted `bookings.notes` since the Calendar sheet was built ("the
// mockup's per-appointment note … part of the client-book bet"). 0065 adds the
// column; this writes it.
//
// The four chips are the whole point. A free-text box asks someone standing in
// the street to compose a sentence; a chip is one tap and covers the four things
// people actually say. The box is there for the fifth thing.

const QUICK = ['Same as last time', 'Shorter than usual', 'Beard too', 'Bringing my son'];
const MAX = 280;   // matches the column's own check constraint

export default function BookingNoteSheet({ visible, onClose, onSend, who, when, service, skipLabel }: {
  visible: boolean;
  onClose: () => void;
  onSend: (note: string | null) => void;
  who: string;
  when: string;
  service: string;
  skipLabel?: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState('');

  // a chip and a written note are one note, not two — the chip seeds the box so
  // "Same as last time but leave the top longer" is a single sentence
  const note = (text.trim() || picked || '').slice(0, MAX);

  function choose(q: string) {
    if (picked === q) { setPicked(null); return; }
    setPicked(q);
    if (!text.trim()) setText(q);
  }

  function close() { setPicked(null); setText(''); onClose(); }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={s.wrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={s.scrim} onPress={close} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.head}>
            <View style={s.headSide} />
            <Text style={s.title}>Anything he should know?</Text>
            <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close"
              style={({ pressed }) => [s.headSide, s.headRight, pressed && s.pressed]}>
              <Ionicons name="close" size={16} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={s.booking}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>
                  {who.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                </Text>
              </View>
              <View style={s.grow}>
                <Text style={s.bookingWho}>{who} · {when}</Text>
                <Text style={s.bookingWhat}>{service}</Text>
              </View>
            </View>

            <Text style={s.label}>QUICK ONES</Text>
            <View style={s.chips}>
              {QUICK.map((q) => (
                <Pressable key={q} onPress={() => choose(q)}
                  accessibilityState={{ selected: picked === q }} accessibilityLabel={q}
                  style={({ pressed }) => [s.chip, picked === q && s.chipOn, pressed && s.pressed]}>
                  <Text style={[s.chipText, picked === q && s.chipTextOn]}>{q}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>OR WRITE IT</Text>
            <TextInput value={text} onChangeText={(t) => setText(t.slice(0, MAX))}
              multiline placeholder="Same as last time but leave the top a bit longer"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Note for your barber" style={s.input} />
            {text.length > MAX - 60 && (
              <Text style={s.counter}>{MAX - text.length} left</Text>
            )}

            <View style={s.hint}>
              <View style={s.hintChip}>
                <Ionicons name="information-circle-outline" size={13} color={colors.textSecondary} />
              </View>
              <Text style={s.hintText}>
                He reads this when you're in the chair. For anything urgent, message him instead.
              </Text>
            </View>
          </ScrollView>

          <View style={s.actions}>
            <View style={s.grow}>
              <PillButton title={skipLabel ?? 'SKIP'} variant="secondary"
                onPress={() => { onSend(null); close(); }} />
            </View>
            <View style={s.sendCol}>
              <PillButton title="SEND WITH BOOKING"
                onPress={() => { onSend(note || null); close(); }} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 22, paddingBottom: 30, gap: 12, maxHeight: '88%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  head: { flexDirection: 'row', alignItems: 'center' },
  headSide: { width: 32, height: 32, justifyContent: 'center' },
  headRight: { alignItems: 'flex-end' },
  title: {
    flex: 1, textAlign: 'center', fontFamily: inter.b, fontSize: 15,
    color: colors.text, letterSpacing: 0.4, textTransform: 'uppercase',
  },
  body: { gap: 12, paddingBottom: 4 },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },

  booking: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: colors.bg, borderRadius: 18, padding: 13, paddingHorizontal: 15,
  },
  avatar: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: inter.b, fontSize: 11, color: colors.accent },
  bookingWho: { fontFamily: inter.b, fontSize: 12.5, color: colors.text },
  bookingWhat: { fontFamily: inter.r, fontSize: 11, color: colors.textSecondary, marginTop: 2 },

  label: { fontFamily: inter.b, fontSize: 10, letterSpacing: 1.4, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border, paddingVertical: 9, paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: inter.sb, fontSize: 11.5, color: '#5c5c58' },
  chipTextOn: { fontFamily: inter.b, color: '#FFFFFF' },

  input: {
    backgroundColor: colors.bg, borderRadius: 18, minHeight: 74,
    padding: 14, paddingHorizontal: 16, textAlignVertical: 'top',
    fontFamily: inter.r, fontSize: 14, lineHeight: 21, color: colors.text,
  },
  counter: { fontFamily: inter.r, fontSize: 11, color: colors.textTertiary, textAlign: 'right' },

  hint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: colors.bg, borderRadius: 18, padding: 13, paddingHorizontal: 15,
  },
  hintChip: {
    width: 26, height: 26, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  hintText: { flex: 1, fontFamily: inter.r, fontSize: 11.5, lineHeight: 17, color: '#5c5c58' },

  actions: { flexDirection: 'row', gap: 10, paddingTop: sp(1) },
  sendCol: { flex: 1.4 },
});
