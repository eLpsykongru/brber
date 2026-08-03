import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Display } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, shadowLg } from '../theme';

// Turn 17 (17a report, 17b filed) and 18b (the case thread).
//
// ponytail: there is no in-app support console — replies and the resolution
// come from the service role in the Supabase dashboard. The customer half is
// real: filing, the thread, the refund card. Build the agent side when the
// volume justifies a second app.

const REASONS: { key: string; label: string; hint?: string }[] = [
  { key: 'no_show', label: "The barber didn't show up" },
  { key: 'wrong_amount', label: 'I was charged the wrong amount',
    hint: "Deposit or shop payment doesn't match" },
  { key: 'wrong_service', label: "Service wasn't what I booked" },
  { key: 'hygiene', label: 'Hygiene or safety concern' },
  { key: 'other', label: 'Something else' },
];

const REASON_LABEL: Record<string, string> = {
  no_show: 'Barber did not show up',
  wrong_amount: 'Wrong amount charged',
  wrong_service: 'Wrong service',
  hygiene: 'Hygiene or safety',
  other: 'Something else',
};

type Visit = {
  id: string;
  starts_at: string;
  price_cents: number;
  deposit_cents: number;
  services: { name: string } | null;
  barbers: { id: string; salon: { name: string } | null } | null;
};

export type CaseRow = {
  id: string; case_no: string; booking_id: string | null; reason: string;
  detail: string | null; amount_cents: number | null; status: string;
  refund_cents: number | null; created_at: string; resolved_at: string | null;
};

const dh = (c: number) => (c / 100).toFixed(0);
const stamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, `
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

// ---- 17a / 17b -----------------------------------------------------------
export default function ReportProblemScreen({ bookingId, onBack, onOpenCase }: {
  bookingId?: string; onBack: () => void; onOpenCase: (c: CaseRow) => void;
}) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitId, setVisitId] = useState<string | undefined>(bookingId);
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<CaseRow | null>(null);

  useEffect(() => {
    supabase.from('bookings')
      .select('id, starts_at, price_cents, deposit_cents, services(name),'
        + ' barbers(id, salon:salons!salon_id(name))')
      .not('completed_at', 'is', null)
      .order('starts_at', { ascending: false }).limit(20)
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as Visit[];
        setVisits(rows);
        if (!visitId && rows.length) setVisitId(rows[0].id);
      });
  }, []);

  const visit = visits.find((v) => v.id === visitId) ?? null;

  async function addPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (!res.canceled) setPhoto(res.assets[0].uri);
  }

  async function submit() {
    if (!reason) return Alert.alert('Pick a reason', 'Tell us what went wrong first.');
    setBusy(true);
    let path: string | null = null;
    if (photo) {
      const body = await (await fetch(photo)).arrayBuffer();
      path = `support/${Date.now()}.jpg`;
      const up = await supabase.storage.from('chat-images').upload(path, body, { contentType: 'image/jpeg' });
      if (up.error) path = null; // ponytail: a lost photo must not lose the report
    }
    const { data, error } = await supabase.rpc('file_support_case', {
      p_booking: visitId ?? null,
      p_reason: reason,
      p_detail: detail,
      p_photo: path,
      p_amount_cents: reason === 'wrong_amount' && visit ? visit.deposit_cents || visit.price_cents : null,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not file the report', error.message);
    setFiled((data as CaseRow[])[0]);
  }

  // 17b
  if (filed) {
    return (
      <View style={s.screen}>
        <View style={s.outcome}>
          <View style={s.outcomeIcon}>
            <Ionicons name="flag-outline" size={30} color={colors.accent} />
          </View>
          <View>
            <Display size={28} style={s.center}>Report filed</Display>
            <Text style={s.outcomeSub}>
              Support is looking into {REASON_LABEL[filed.reason].toLowerCase()}
              {visit?.barbers?.salon?.name ? ` at ${visit.barbers.salon.name}` : ''}.
              You'll hear back within 24 hours.
            </Text>
          </View>

          <View style={s.outcomeCard}>
            <Line k="Case number" v={`#${filed.case_no}`} />
            {!!filed.booking_id && (
              <Line k="Booking" v={`#${filed.booking_id.replace(/-/g, '').slice(0, 8).toUpperCase()}`} />
            )}
            <Line k="Issue" v={REASON_LABEL[filed.reason]} />
            <Line k="Filed" v={stamp(filed.created_at)} />
            {filed.amount_cents != null && filed.amount_cents > 0 && (
              <>
                <View style={s.hr} />
                <View style={s.disputeRow}>
                  <Text style={s.disputeKey}>Amount in dispute</Text>
                  <Text style={s.disputeVal}>{dh(filed.amount_cents)} DH</Text>
                </View>
              </>
            )}
          </View>

          <View style={s.chatCard}>
            <View style={s.chatIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={17} color="#fff" />
            </View>
            <View style={s.grow}>
              <Text style={s.chatTitle}>Support chat opened</Text>
              <Text style={s.chatSub}>Updates arrive in your Chat tab</Text>
            </View>
          </View>

          <Pressable onPress={onBack} style={({ pressed }) => [s.wideDark, pressed && s.pressed]}>
            <Text style={s.wideDarkText}>DONE</Text>
          </Pressable>
          <Text style={s.link} onPress={() => onOpenCase(filed)}>View case</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable onPress={onBack} hitSlop={8}
            style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={16} color={colors.text} />
          </Pressable>
          <Display size={18} style={s.headerTitle}>Report a problem</Display>
          <View style={s.puckGhost} />
        </View>

        {visit && (
          <Pressable onPress={() => setPicking((v) => !v)}
            style={({ pressed }) => [s.visitCard, pressed && s.pressed]}>
            <View style={s.visitThumb}>
              <Ionicons name="storefront-outline" size={20} color={colors.accent} />
            </View>
            <View style={s.grow}>
              <Text style={s.visitName}>{visit.barbers?.salon?.name ?? 'Salon'}</Text>
              <Text style={s.visitMeta}>
                {visit.services?.name ?? 'Service'} ·{' '}
                {new Date(visit.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })},{' '}
                {new Date(visit.starts_at).toTimeString().slice(0, 5)} · {dh(visit.price_cents)} DH
              </Text>
            </View>
            <Text style={s.change}>Change</Text>
          </Pressable>
        )}
        {picking && visits.map((v) => (
          <Pressable key={v.id} onPress={() => { setVisitId(v.id); setPicking(false); }}
            style={({ pressed }) => [s.visitPick, v.id === visitId && s.visitPickOn, pressed && s.pressed]}>
            <Text style={s.visitPickText}>
              {v.barbers?.salon?.name ?? 'Salon'} · {v.services?.name ?? 'Service'} ·{' '}
              {new Date(v.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          </Pressable>
        ))}

        <Text style={s.eyebrow}>WHAT WENT WRONG?</Text>
        <View style={s.optionList}>
          {REASONS.map((r) => {
            const on = reason === r.key;
            return (
              <Pressable key={r.key} onPress={() => setReason(r.key)}
                accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={({ pressed }) => [s.option, on && s.optionOn, pressed && s.pressed]}>
                <View style={s.grow}>
                  <Text style={[s.optionLabel, on && s.optionLabelOn]}>{r.label}</Text>
                  {on && !!r.hint && <Text style={s.optionHint}>{r.hint}</Text>}
                </View>
                <View style={[s.radio, on && s.radioOn]}>
                  {on && <Ionicons name="checkmark" size={11} color="#fff" />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <TextInput style={s.detail} multiline value={detail} onChangeText={setDetail}
          placeholder="Tell us what happened" placeholderTextColor={colors.textTertiary} />

        <View style={s.photoRow}>
          <Pressable onPress={addPhoto} accessibilityLabel="Add a photo"
            style={({ pressed }) => [s.photoAdd, pressed && s.pressed]}>
            <Ionicons name="camera-outline" size={18} color={colors.textSecondary} />
          </Pressable>
          {!!photo && <Image source={{ uri: photo }} style={s.photoThumb} />}
          <Text style={s.photoHint}>
            Add a photo or receipt · support reviews reports within 24 h
          </Text>
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Pressable onPress={submit} disabled={busy}
          style={({ pressed }) => [s.wideDark, (pressed || busy) && s.pressed]}>
          <Text style={s.wideDarkText}>SUBMIT REPORT</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.lineRow}>
      <Text style={s.lineKey}>{k}</Text>
      <Text style={s.lineVal}>{v}</Text>
    </View>
  );
}

// ---- 18b -----------------------------------------------------------------
type Msg = {
  id: string; sender_id: string | null; author_name: string | null;
  body: string; created_at: string;
};

export function SupportCaseScreen({ caseRow, myId, onBack }: {
  caseRow: CaseRow; myId: string; onBack: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('support_messages')
      .select('id, sender_id, author_name, body, created_at')
      .eq('case_id', caseRow.id).order('created_at');
    setMsgs((data ?? []) as Msg[]);
  }, [caseRow.id]);

  useEffect(() => {
    load();
    if (caseRow.refund_cents) supabase.rpc('wallet_balance').then(({ data }) => setBalance(data ?? 0));
  }, [load, caseRow.refund_cents]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    const { error } = await supabase.from('support_messages')
      .insert({ case_id: caseRow.id, sender_id: myId, body });
    if (error) return Alert.alert('Could not send', error.message);
    load();
  }

  const resolved = caseRow.status === 'resolved';

  return (
    <KeyboardAvoidingView style={s.caseScreen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.caseHead}>
        <Pressable onPress={onBack} hitSlop={8} style={s.caseBack} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={17} color="#fff" />
        </Pressable>
        <View style={s.caseAvatar}><Text style={s.caseAvatarText}>S</Text></View>
        <View style={s.grow}>
          <Text style={s.caseName}>Sterncut Support</Text>
          <Text style={s.caseSub}>
            Case #{caseRow.case_no} · {REASON_LABEL[caseRow.reason].toLowerCase()}
          </Text>
        </View>
        <View style={[s.caseChip, resolved && s.caseChipOk]}>
          <Text style={[s.caseChipText, resolved && s.caseChipTextOk]}>
            {resolved ? 'RESOLVED' : 'OPEN'}
          </Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.thread}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={
          <Text style={s.dayLabel}>
            {new Date(caseRow.created_at).toLocaleDateString('en-US',
              { month: 'short', day: 'numeric' }).toUpperCase()}
          </Text>
        }
        renderItem={({ item }) => {
          const mine = item.sender_id === myId;
          return (
            <View>
              <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleThem]}>
                <Text style={[s.bubbleText, mine && s.bubbleTextMine]}>{item.body}</Text>
              </View>
              <View style={[s.metaRow, mine && s.metaRowMine]}>
                {!mine && <View style={s.metaAvatar}><Text style={s.metaAvatarText}>S</Text></View>}
                <Text style={s.metaText}>
                  {mine ? 'You' : `${item.author_name ?? 'Support'} · Support`} ·{' '}
                  {new Date(item.created_at).toLocaleTimeString('en-US',
                    { hour: 'numeric', minute: '2-digit' }).toLowerCase()}
                </Text>
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <>
            {!!caseRow.refund_cents && (
              <View style={s.refundCard}>
                <View style={s.refundHead}>
                  <Ionicons name="checkmark" size={15} color="#16A34A" />
                  <Text style={s.refundTitle}>Refund issued</Text>
                </View>
                <View style={s.lineRow}>
                  <Text style={s.lineKey}>To wallet</Text>
                  <Text style={s.refundAmount}>+{dh(caseRow.refund_cents)} DH</Text>
                </View>
                {balance != null && (
                  <View style={s.lineRow}>
                    <Text style={s.lineKey}>New balance</Text>
                    <Text style={s.lineVal}>{dh(balance)} DH</Text>
                  </View>
                )}
              </View>
            )}
            {resolved && (
              <Text style={s.closed}>Case closed. Reply here if anything's still off.</Text>
            )}
          </>
        }
      />

      <View style={s.composer}>
        <TextInput style={s.input} value={text} onChangeText={setText}
          placeholder="Reply to support…" placeholderTextColor={colors.textTertiary} />
        <Pressable onPress={send} disabled={!text.trim()}
          style={({ pressed }) => [s.send, (pressed || !text.trim()) && s.pressed]}>
          <Ionicons name="arrow-up" size={17} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 66, paddingHorizontal: 20, paddingBottom: 110, gap: 14 },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.75 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  puckGhost: { width: 40 },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.72 },

  visitCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, ...shadow,
  },
  visitThumb: {
    width: 52, height: 52, borderRadius: 14, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  visitName: { fontSize: 14, fontWeight: '700', color: colors.text },
  visitMeta: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  change: { fontSize: 12, fontWeight: '600', color: colors.accent },
  visitPick: {
    backgroundColor: colors.bg, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  visitPickOn: { borderColor: colors.ink },
  visitPickText: { fontSize: 12, color: colors.text },

  eyebrow: {
    fontSize: 11, letterSpacing: 1.65, fontWeight: '700', color: colors.textSecondary, marginTop: 2,
  },
  optionList: { gap: 9 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16, ...shadow,
  },
  optionOn: { borderWidth: 2, borderColor: colors.ink },
  optionLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  optionLabelOn: { fontWeight: '700' },
  optionHint: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  radio: {
    width: 22, height: 22, borderRadius: 999, borderWidth: 1.5, borderColor: '#D8D4CA',
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.ink, borderColor: colors.ink },

  detail: {
    backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16,
    minHeight: 62, fontSize: 14, lineHeight: 21, color: colors.text,
    textAlignVertical: 'top', ...shadow,
  },
  photoRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  photoAdd: {
    width: 58, height: 58, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: '#C9C5BB', alignItems: 'center', justifyContent: 'center',
  },
  photoThumb: { width: 58, height: 58, borderRadius: 14, backgroundColor: colors.surface },
  photoHint: { flex: 1, fontSize: font.tiny, lineHeight: 16, color: colors.textTertiary },

  footer: { position: 'absolute', left: 20, right: 20, bottom: 26 },
  wideDark: {
    width: '100%', height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  wideDarkText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: '#fff' },
  link: { fontSize: font.small, fontWeight: '600', color: colors.accent },

  // 17b
  outcome: { flex: 1, paddingTop: 96, paddingHorizontal: 26, gap: 18, alignItems: 'center' },
  outcomeIcon: {
    width: 68, height: 68, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  outcomeSub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 8, lineHeight: 20,
    maxWidth: 290, textAlign: 'center',
  },
  outcomeCard: {
    width: '100%', backgroundColor: colors.bg, borderRadius: 24, padding: 20, gap: 11, ...shadowLg,
  },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  lineKey: { fontSize: font.small, color: colors.textSecondary },
  lineVal: { fontSize: font.small, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  disputeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  disputeKey: { fontSize: font.small, fontWeight: '700', color: colors.text },
  disputeVal: {
    fontSize: 18, fontWeight: '800', color: colors.accent, fontVariant: ['tabular-nums'],
  },
  chatCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.ink, borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18,
  },
  chatIcon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  chatTitle: { fontSize: font.small, fontWeight: '700', color: '#fff' },
  chatSub: { fontSize: font.tiny, color: 'rgba(255,255,255,0.55)', marginTop: 2 },

  // 18b
  caseScreen: { flex: 1, backgroundColor: colors.surface },
  caseHead: {
    backgroundColor: colors.ink, borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    paddingTop: 62, paddingBottom: 14, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  caseBack: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  caseAvatar: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  caseAvatarText: { fontFamily: serif, fontSize: 14, color: '#fff' },
  caseName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  caseSub: { fontSize: font.tiny, color: 'rgba(255,255,255,0.55)' },
  caseChip: {
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9,
  },
  caseChipOk: { backgroundColor: 'rgba(74,222,128,0.20)' },
  caseChipText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  caseChipTextOk: { color: '#15803D' },

  thread: { padding: 16, paddingBottom: 8 },
  dayLabel: {
    alignSelf: 'center', textAlign: 'center', fontSize: 10, letterSpacing: 2,
    fontWeight: '700', color: colors.textTertiary, marginBottom: 10,
  },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.ink, borderBottomRightRadius: 4 },
  bubbleThem: {
    alignSelf: 'flex-start', backgroundColor: colors.bg, borderBottomLeftRadius: 4, ...shadow,
  },
  bubbleText: { fontSize: 14, lineHeight: 20, color: colors.text },
  bubbleTextMine: { color: '#fff' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 10 },
  metaRowMine: { justifyContent: 'flex-end' },
  metaAvatar: {
    width: 18, height: 18, borderRadius: 999, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  metaAvatarText: { fontSize: 8, fontWeight: '800', color: '#fff' },
  metaText: { fontSize: 10, color: colors.textTertiary },
  refundCard: {
    alignSelf: 'flex-start', width: '80%', backgroundColor: colors.bg, borderRadius: 18,
    paddingVertical: 14, paddingHorizontal: 16, gap: 9, marginTop: 8, ...shadow,
  },
  refundHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  refundTitle: { fontSize: 12, fontWeight: '700', color: '#15803D' },
  refundAmount: { fontSize: 12, fontWeight: '800', color: '#16A34A', fontVariant: ['tabular-nums'] },
  closed: {
    alignSelf: 'center', textAlign: 'center', fontSize: font.tiny, lineHeight: 16,
    color: colors.textTertiary, paddingHorizontal: 20, paddingVertical: 8,
  },
  composer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 34,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  input: {
    flex: 1, height: 46, borderRadius: radius.pill, backgroundColor: colors.bg,
    paddingHorizontal: 16, fontSize: font.small, color: colors.text,
  },
  send: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
});
