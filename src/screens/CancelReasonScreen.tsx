import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Field, PillButton, ScreenHeader } from '../components/ui';
import { colors, font, radius, sp } from '../theme';

const REASONS = [
  'Prefer a different specialist',
  "Running late, can't make it",
  'Service no longer needed',
  'Emergency came up',
  'Found another appointment',
  'Other',
];

// UI shell — on submit returns the chosen reason. TODO(backlog): persist reason
// (add bookings.cancel_reason and pass it through cancel_booking()).
export default function CancelReasonScreen({ onBack, onSubmit }: {
  onBack: () => void; onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState('');

  return (
    <View style={s.screen}>
      <ScreenHeader title="Cancel Booking" onBack={onBack} />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.prompt}>Please select the reason for cancellation:</Text>
        {REASONS.map((r) => (
          <Pressable key={r} style={s.row} onPress={() => setReason(r)}>
            <Ionicons name={reason === r ? 'radio-button-on' : 'radio-button-off'} size={22}
              color={reason === r ? colors.accent : colors.textTertiary} />
            <Text style={s.rowText}>{r}</Text>
          </Pressable>
        ))}
        {reason === 'Other' && (
          <>
            <Text style={s.otherLabel}>Other</Text>
            <Field placeholder="Enter your reason" multiline value={other} onChangeText={setOther}
              style={s.otherField} />
          </>
        )}
      </ScrollView>
      <View style={s.cta}>
        <PillButton title="Cancel Booking" variant="danger"
          onPress={() => onSubmit(reason === 'Other' ? other.trim() || 'Other' : reason)} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), backgroundColor: colors.bg },
  content: { paddingBottom: 100, gap: sp(1) },
  prompt: { fontSize: font.body, color: colors.textSecondary, marginBottom: sp(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(3), paddingVertical: sp(3) },
  rowText: { fontSize: font.body, color: colors.text },
  otherLabel: { fontSize: font.body, fontWeight: '700', color: colors.text, marginTop: sp(3), marginBottom: sp(2) },
  otherField: { minHeight: 120, textAlignVertical: 'top', paddingTop: sp(3) },
  cta: { position: 'absolute', left: sp(5), right: sp(5), bottom: sp(8) },
});
