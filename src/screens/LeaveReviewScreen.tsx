import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Field, PillButton, ScreenHeader } from '../components/ui';
import { colors, font, radius, sp } from '../theme';

// Richer review form (UI shell). Real submit currently lives in My Bookings → Rate.
// TODO(backlog): wire submit to reviews insert + a specialist picker + photo attach.
export default function LeaveReviewScreen({ salonName, address, specialists, onBack, onSubmit }: {
  salonName: string; address: string | null; specialists: string[];
  onBack: () => void; onSubmit: (r: { rating: number; specialist: string; comment: string }) => void;
}) {
  const [rating, setRating] = useState(0);
  const [specialist, setSpecialist] = useState(specialists[0] ?? '');
  const [comment, setComment] = useState('');

  return (
    <View style={s.screen}>
      <ScreenHeader title="Leave Review" onBack={onBack} />
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.salonRow}>
          <View style={s.salonThumb}><Ionicons name="storefront-outline" size={22} color={colors.accent} /></View>
          <View style={s.grow}>
            <Text style={s.salonName}>{salonName}</Text>
            <Text style={s.meta}>{address ?? 'Tangier, Morocco'}</Text>
          </View>
        </View>

        <Text style={s.shareTitle}>Share your service experience</Text>
        <View style={s.ratingCard}>
          <Text style={s.ratingLabel}>Your overall rating</Text>
          <View style={s.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
                <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={38}
                  color={n <= rating ? colors.star : colors.textTertiary} />
              </Pressable>
            ))}
          </View>
        </View>

        {specialists.length > 0 && (
          <>
            <Text style={s.label}>Specialist</Text>
            <View style={s.chips}>
              {specialists.map((sp2) => (
                <Pressable key={sp2} onPress={() => setSpecialist(sp2)}
                  style={[s.chip, specialist === sp2 && s.chipActive]}>
                  <Text style={[s.chipText, specialist === sp2 && s.chipTextActive]}>{sp2}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={s.label}>Add detailed review</Text>
        <Field placeholder="Enter here" multiline value={comment} onChangeText={setComment} style={s.comment} />
        {/* TODO(backlog): photo attach to reviews */}
        <Pressable style={s.addPhoto} onPress={() => {}}>
          <Ionicons name="image-outline" size={18} color={colors.textSecondary} />
          <Text style={s.meta}>add photo</Text>
        </Pressable>
      </ScrollView>
      <View style={s.cta}>
        <PillButton title="Submit" disabled={rating === 0}
          onPress={() => onSubmit({ rating, specialist, comment: comment.trim() })} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), backgroundColor: colors.bg },
  content: { paddingBottom: 100, gap: sp(3) },
  grow: { flex: 1 },
  salonRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3), marginTop: sp(2) },
  salonThumb: {
    width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  salonName: { fontSize: font.body, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.small, color: colors.textSecondary },
  shareTitle: { fontSize: font.h2, fontWeight: '700', color: colors.text, textAlign: 'center', marginTop: sp(2) },
  ratingCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: sp(5),
    alignItems: 'center', gap: sp(3),
  },
  ratingLabel: { fontSize: font.small, color: colors.textSecondary },
  stars: { flexDirection: 'row', gap: sp(2) },
  label: { fontSize: font.small, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingVertical: sp(2), paddingHorizontal: sp(4) },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { fontSize: font.small, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.accent },
  comment: { minHeight: 110, textAlignVertical: 'top', paddingTop: sp(3) },
  addPhoto: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  cta: { position: 'absolute', left: sp(5), right: sp(5), bottom: sp(8) },
});
