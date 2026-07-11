import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Field, ScreenHeader } from '../components/ui';
import { colors, font, radius, sp } from '../theme';

// TODO(backlog): static shell — fill FAQ content + real contact links.
const FAQ = [
  { q: 'How do I book an appointment?', a: 'Open a salon, tap Book Appointment, pick a service, a barber, and a time.' },
  { q: 'Can I cancel my appointment?', a: 'Yes — go to My Bookings and cancel any upcoming booking.' },
  { q: 'How do I pay?', a: 'For now you pay at the shop. In-app payment is coming later.' },
  { q: 'How do I contact support?', a: 'Use the Contact Us tab in this Help Center.' },
];
const CONTACT = [
  { icon: 'headset-outline' as const, label: 'Customer Service', detail: 'support@brber.app' },
  { icon: 'logo-whatsapp' as const, label: 'WhatsApp', detail: '+212 6 00 00 00 00' },
  { icon: 'globe-outline' as const, label: 'Website', detail: 'brber.app' },
  { icon: 'logo-instagram' as const, label: 'Instagram', detail: '@brber' },
];

export default function HelpCenterScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'faq' | 'contact'>('faq');
  const [open, setOpen] = useState<number | null>(0);
  const [query, setQuery] = useState('');

  const faq = FAQ.filter((f) => !query.trim() || f.q.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <View style={s.screen}>
      <ScreenHeader title="Help Center" onBack={onBack} />
      <Field placeholder="Search" value={query} onChangeText={setQuery} />
      <View style={s.tabs}>
        {(['faq', 'contact'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={s.tabBtn}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>{t === 'faq' ? 'FAQ' : 'Contact Us'}</Text>
            {tab === t && <View style={s.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {tab === 'faq'
          ? faq.map((f, i) => (
            <Pressable key={f.q} style={s.item} onPress={() => setOpen(open === i ? null : i)}>
              <View style={s.itemHead}>
                <Text style={s.itemTitle}>{f.q}</Text>
                <Ionicons name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
              </View>
              {open === i && <Text style={s.itemBody}>{f.a}</Text>}
            </Pressable>
          ))
          : CONTACT.map((c) => (
            <View key={c.label} style={s.item}>
              <View style={s.itemHead}>
                <View style={s.contactLeft}>
                  <View style={s.contactIcon}><Ionicons name={c.icon} size={18} color={colors.text} /></View>
                  <Text style={s.itemTitle}>{c.label}</Text>
                </View>
              </View>
              <Text style={s.itemBody}>{c.detail}</Text>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), backgroundColor: colors.bg, gap: sp(3) },
  tabs: { flexDirection: 'row', gap: sp(6), borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBtn: { paddingVertical: sp(2.5) },
  tabText: { fontSize: font.body, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  tabUnderline: { position: 'absolute', bottom: -1, left: 0, right: 0, height: 3, backgroundColor: colors.accent, borderRadius: 2 },
  content: { gap: sp(2), paddingBottom: sp(10) },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: sp(4), gap: sp(2) },
  itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemTitle: { fontSize: font.body, fontWeight: '600', color: colors.text, flex: 1 },
  itemBody: { fontSize: font.small, color: colors.textSecondary, lineHeight: 20 },
  contactLeft: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  contactIcon: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
});
