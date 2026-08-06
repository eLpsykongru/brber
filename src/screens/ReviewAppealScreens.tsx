import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Display } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, shadow, shadowLg } from '../theme';

// Customer turn 31 of "Customer App 3.dc.html" — what Anas gets after ops clicks
// REMOVE & NOTIFY BOTH in the admin desk (0042), the one appeal he is allowed
// (0045), and the two ways it ends.
//
// The tone is the whole point: it leads with the reason and the check-in log
// rather than a policy code, and it doesn't pretend the decision was neutral.

export type RemovedReview = {
  id: string; ref: string; rating: number; comment: string | null; state: string;
  created_at: string; moderated_at: string | null; removal_reason: string | null;
  note: string | null; barber: string; salon: string | null;
  visit: {
    service: string | null; starts_at: string; checked_in_at: string | null;
    started_at: string | null; price_cents: number;
  } | null;
  late_cleared: boolean | null;   // 0046 — null when the visit never earned a mark
  appeal: {
    id: string; reason: string; note: string | null; created_at: string;
    decided_at: string | null; upheld: boolean | null;
    decision_note: string | null; decided_by: string | null;
  } | null;
};

const REASON_TEXT: Record<string, string> = {
  no_visit: 'We could not find a visit behind this review.',
  abusive: 'The language broke our review rules.',
  personal_details: 'It named someone or carried contact details.',
  off_service: "The complaint was about something outside the barber's control.",
  spam: 'It read as advertising rather than a review.',
  duplicate: 'The same visit was already reviewed.',
};

const APPEAL_REASONS = [
  { key: 'log_wrong', label: 'I was on time — the log is wrong' },
  { key: 'not_only', label: "My review wasn't only about that" },
  { key: 'other', label: 'Something else is missing' },
];

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function useRemovedReviews() {
  const [rows, setRows] = useState<RemovedReview[] | null>(null);
  const reload = () => supabase.rpc('my_removed_reviews')
    .then(({ data }) => setRows((data ?? []) as RemovedReview[]));
  useEffect(() => { reload(); }, []);
  return { rows, reload };
}

// ---- 31a / 31c / 31d — one screen, three states --------------------------
export default function ReviewTakedownScreen({ item, onBack, onAppeal, onViewReview }: {
  item: RemovedReview; onBack: () => void; onAppeal: () => void; onViewReview?: () => void;
}) {
  const a = item.appeal;
  if (a?.decided_at && a.upheld) return <Upheld item={item} onBack={onBack} onViewReview={onViewReview} />;
  if (a) return <Waiting item={item} onBack={onBack} />;
  return <Notice item={item} onBack={onBack} onAppeal={onAppeal} />;
}

function Head({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={8}
        style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel="Go back">
        <Ionicons name="arrow-back" size={16} color={colors.text} />
      </Pressable>
      <Text style={s.headEyebrow}>{label}</Text>
      <View style={s.puckGhost} />
    </View>
  );
}

function Stars({ n, size = 15 }: { n: number; size?: number }) {
  return (
    <View style={s.stars}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= n ? 'star' : 'star-outline'} size={size}
          color={i <= n ? colors.star : '#D8D4CA'} />
      ))}
    </View>
  );
}

// 31a
function Notice({ item, onBack, onAppeal }: {
  item: RemovedReview; onBack: () => void; onAppeal: () => void;
}) {
  const v = item.visit;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Head label="YOUR REVIEW" onBack={onBack} />

        <View>
          <Display size={27} style={s.title}>Your review{'\n'}was taken down</Display>
          <Text style={s.sub}>
            Reviewed by our team{item.moderated_at ? ` on ${day(item.moderated_at)}` : ''} ·
            you can appeal once.
          </Text>
        </View>

        <View style={s.card}>
          <View style={s.rowMid}>
            <Stars n={item.rating} />
            <Text style={s.cardMeta}>{item.barber} · {day(item.created_at)}</Text>
            <View style={s.tag}><Text style={s.tagText}>HIDDEN</Text></View>
          </View>
          <Text style={s.struck}>
            {item.comment ? `"${item.comment}"` : 'A rating with no words.'}
          </Text>
        </View>

        <View style={s.inkCard}>
          <Text style={s.inkEyebrow}>WHY</Text>
          <Text style={s.inkBody}>
            {item.note ?? REASON_TEXT[item.removal_reason ?? ''] ?? 'It broke our review policy.'}
          </Text>
          {!!v && (
            <View style={s.logRow}>
              <LogTile label="YOUR SLOT" value={hhmm(v.starts_at)} />
              {!!v.checked_in_at && (
                <LogTile label="YOU SCANNED IN" value={hhmm(v.checked_in_at)} warm />
              )}
              {!!v.started_at && <LogTile label="IN THE CHAIR" value={hhmm(v.started_at)} />}
            </View>
          )}
        </View>

        <View style={s.calmCard}>
          <View style={s.calmIcon}>
            <Ionicons name="checkmark" size={14} color="#16A34A" />
          </View>
          <View style={s.grow}>
            <Text style={s.calmTitle}>Nothing else changed</Text>
            <Text style={s.calmBody}>
              Your account is fine and you can still book {item.barber.split(' ')[0]} or anyone else.
            </Text>
          </View>
        </View>

        <View style={s.actions}>
          <Pressable onPress={() => Alert.alert('Review rules',
            'Reviews are about the service you received. We take one down only for a policy '
            + 'reason, and we tell you which one.')}
            style={({ pressed }) => [s.ghost, pressed && s.pressed]}>
            <Text style={s.ghostText}>READ THE RULES</Text>
          </Pressable>
          <Pressable onPress={onAppeal} style={({ pressed }) => [s.dark, pressed && s.pressed]}>
            <Text style={s.darkText}>APPEAL THIS</Text>
          </Pressable>
        </View>
        <Text style={s.foot}>One appeal per review · read by a different reviewer</Text>
      </ScrollView>
    </View>
  );
}

function LogTile({ label, value, warm }: { label: string; value: string; warm?: boolean }) {
  return (
    <View style={[s.logTile, warm && s.logTileWarm]}>
      <Text style={[s.logLabel, warm && s.logLabelWarm]}>{label}</Text>
      <Text style={[s.logValue, warm && s.logValueWarm]}>{value}</Text>
    </View>
  );
}

// 31b
export function AppealScreen({ item, onBack, onSent }: {
  item: RemovedReview; onBack: () => void; onSent: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!reason) return Alert.alert('Pick one', 'Tell us what we are missing.');
    setBusy(true);
    const { error } = await supabase.rpc('appeal_review', {
      p_review: item.id, p_reason: reason, p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not send the appeal', error.message);
    onSent();
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable onPress={onBack} hitSlop={8}
            style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={16} color={colors.text} />
          </Pressable>
          <Display size={18} style={s.headerTitle}>Appeal</Display>
          <View style={s.puckGhost} />
        </View>

        <Text style={s.eyebrow}>WHAT ARE WE MISSING?</Text>
        <View style={s.optionList}>
          {APPEAL_REASONS.map((r) => {
            const on = reason === r.key;
            return (
              <Pressable key={r.key} onPress={() => setReason(r.key)}
                accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={({ pressed }) => [s.option, on && s.optionOn, pressed && s.pressed]}>
                <Text style={[s.optionLabel, on && s.optionLabelOn]}>{r.label}</Text>
                <View style={[s.radio, on && s.radioOn]}>
                  {on && <Ionicons name="checkmark" size={11} color="#fff" />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.eyebrow}>IN YOUR WORDS</Text>
        <TextInput style={s.detail} multiline value={note} onChangeText={setNote}
          placeholder="What happened, in your words" placeholderTextColor={colors.textTertiary} />
        <Text style={s.hint}>
          {item.visit ? 'Booking and check-in log attached' : 'Your review is attached'} ·
          answered within 3 days
        </Text>

        <Pressable onPress={send} disabled={busy}
          style={({ pressed }) => [s.dark, s.wide, (pressed || busy) && s.pressed]}>
          <Text style={s.darkText}>SEND MY APPEAL</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// 31c
function Waiting({ item, onBack }: { item: RemovedReview; onBack: () => void }) {
  const a = item.appeal!;
  const due = new Date(new Date(a.created_at).getTime() + 3 * 86400000);
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Head label={`APPEAL · ${item.ref}`} onBack={onBack} />

        <View style={s.hero}>
          <View style={s.heroIcon}>
            <Ionicons name="time-outline" size={28} color={colors.text} />
          </View>
          <View>
            <Display size={24} style={s.center}>Appeal sent</Display>
            <Text style={[s.sub, s.center, { maxWidth: 270 }]}>
              A different reviewer will read it. We&apos;ll tell you either way by{' '}
              {due.toLocaleDateString('en-US', { weekday: 'long' })}.
            </Text>
          </View>
        </View>

        <View style={s.card}>
          <Step done title="Review taken down"
            meta={`${item.moderated_at ? day(item.moderated_at) : '—'} · ${
              (item.removal_reason ?? 'policy').replace(/_/g, ' ')}`} />
          <Step now title="You appealed"
            meta={`${day(a.created_at)} · with your note and the booking`} />
          <Step title="Second reviewer decides" last
            meta={`By ${due.toLocaleDateString('en-US',
              { weekday: 'short', month: 'short', day: 'numeric' })}`} />
        </View>

        {!!a.note && (
          <View style={s.card}>
            <Text style={s.eyebrowSmall}>WHAT YOU TOLD US</Text>
            <Text style={s.quote}>&quot;{a.note}&quot;</Text>
            {!!item.visit && (
              <View style={s.attachRow}>
                <Ionicons name="calendar-outline" size={13} color={colors.textTertiary} />
                <Text style={s.attachText}>
                  {item.visit.service ?? 'Service'} · {day(item.visit.starts_at)},{' '}
                  {hhmm(item.visit.starts_at)} · {Math.round(item.visit.price_cents / 100)} DH attached
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={s.calmCard}>
          <View style={[s.calmIcon, { backgroundColor: colors.surface }]}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
          </View>
          <View style={s.grow}>
            <Text style={s.calmTitle}>{item.barber.split(' ')[0]} can&apos;t see your appeal</Text>
            <Text style={s.calmBody}>He&apos;s only told the outcome. He won&apos;t know you appealed.</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Step({ title, meta, done, now, last }: {
  title: string; meta: string; done?: boolean; now?: boolean; last?: boolean;
}) {
  return (
    <View style={s.stepRow}>
      <View style={s.stepRail}>
        <View style={[s.stepDot, done && s.stepDotDone, now && s.stepDotNow,
          !done && !now && s.stepDotTodo]}>
          {done && <Ionicons name="checkmark" size={10} color="#fff" />}
          {now && <View style={s.stepDotInner} />}
        </View>
        {!last && <View style={s.stepLine} />}
      </View>
      <View style={[s.grow, !last && { paddingBottom: 16 }]}>
        <View style={s.rowMid}>
          <Text style={[s.stepTitle, !done && !now && s.stepTitleTodo]}>{title}</Text>
          {now && <View style={s.nowTag}><Text style={s.nowTagText}>NOW</Text></View>}
        </View>
        <Text style={[s.stepMeta, !done && !now && s.stepMetaTodo]}>{meta}</Text>
      </View>
    </View>
  );
}

// 31d
function Upheld({ item, onBack, onViewReview }: {
  item: RemovedReview; onBack: () => void; onViewReview?: () => void;
}) {
  const a = item.appeal!;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Head label={`APPEAL · ${item.ref}`} onBack={onBack} />

        <View style={s.hero}>
          <View style={[s.heroIcon, { backgroundColor: 'rgba(74,222,128,0.18)' }]}>
            <Ionicons name="checkmark" size={29} color="#16A34A" />
          </View>
          <View>
            <Display size={25} style={s.center}>You were right</Display>
            <Text style={[s.sub, s.center, { maxWidth: 280 }]}>
              Your review is back on {item.barber.split(' ')[0]}&apos;s page. Sorry for taking it down.
            </Text>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.rowMid}>
            <Stars n={item.rating} />
            <Text style={s.cardMeta}>{item.barber} · {day(item.created_at)}</Text>
            <View style={s.tagGreen}>
              <View style={s.dotGreen} />
              <Text style={s.tagGreenText}>PUBLIC AGAIN</Text>
            </View>
          </View>
          <Text style={s.body}>
            {item.comment ? `"${item.comment}"` : 'A rating with no words.'}
          </Text>
        </View>

        <View style={s.inkCard}>
          <Text style={s.inkEyebrow}>WHAT THE SECOND REVIEWER FOUND</Text>
          <Text style={s.inkBody}>{a.decision_note}</Text>
          <View style={s.inkFoot}>
            <View style={s.inkAvatar}>
              <Text style={s.inkAvatarText}>
                {(a.decided_by ?? 'Ops').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <Text style={s.inkFootText}>
              {a.decided_by ?? 'Ops'} · {a.decided_at
                ? new Date(a.decided_at).toLocaleDateString('en-US',
                  { weekday: 'short', month: 'short', day: 'numeric' })
                : ''}
            </Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.eyebrowSmall}>WHAT CHANGED</Text>
          <Changed>Your review is public on his page again</Changed>
          {item.late_cleared && (
            <Changed>Your late-arrival flag is cleared — deposits back to 40%</Changed>
          )}
          <Changed>The takedown reason has been withdrawn from your record</Changed>
          <Changed>Nothing was held against your account — appeals are free</Changed>
        </View>

        <View style={s.actions}>
          <Pressable onPress={onViewReview} disabled={!onViewReview}
            style={({ pressed }) => [s.ghost, pressed && s.pressed]}>
            <Text style={s.ghostText}>VIEW MY REVIEW</Text>
          </Pressable>
          <Pressable onPress={onBack} style={({ pressed }) => [s.dark, pressed && s.pressed]}>
            <Text style={s.darkText}>DONE</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Changed({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.changedRow}>
      <View style={s.changedTick}>
        <Ionicons name="checkmark" size={10} color="#16A34A" />
      </View>
      <Text style={s.changedText}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 62, paddingHorizontal: 20, paddingBottom: 40, gap: 13 },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.75 },
  rowMid: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 1.8 },
  headEyebrow: {
    flex: 1, textAlign: 'center', fontSize: 11, letterSpacing: 2,
    fontWeight: '700', color: colors.textSecondary,
  },
  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  puckGhost: { width: 40 },

  title: { letterSpacing: 0.5, lineHeight: 31 },
  sub: { fontSize: font.small, color: colors.textSecondary, marginTop: 9, lineHeight: 20 },
  eyebrow: {
    fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: colors.textSecondary,
  },
  eyebrowSmall: {
    fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: colors.textSecondary,
  },
  foot: { textAlign: 'center', fontSize: font.tiny, color: colors.textTertiary },
  hint: { fontSize: font.tiny, color: colors.textTertiary },

  card: { backgroundColor: colors.bg, borderRadius: 22, padding: 18, gap: 12, ...shadow },
  cardMeta: { flex: 1, fontSize: 12, color: colors.textSecondary },
  body: { fontSize: 14, lineHeight: 22, color: colors.text },
  struck: {
    fontSize: 14, lineHeight: 22, color: colors.textSecondary, textDecorationLine: 'line-through',
  },
  quote: { fontSize: 13, lineHeight: 20, color: '#5c5c58' },
  stars: { flexDirection: 'row', gap: 2 },
  tag: { backgroundColor: colors.surface, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8 },
  tagText: {
    fontSize: 10, letterSpacing: 0.8, fontWeight: '700', color: colors.textSecondary,
  },
  tagGreen: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(74,222,128,0.16)',
    borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8,
  },
  tagGreenText: { fontSize: 10, letterSpacing: 0.8, fontWeight: '700', color: '#16A34A' },
  dotGreen: { width: 5, height: 5, borderRadius: 999, backgroundColor: '#16A34A' },

  inkCard: { backgroundColor: colors.ink, borderRadius: 22, padding: 18, gap: 13 },
  inkEyebrow: {
    fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: 'rgba(255,255,255,0.5)',
  },
  inkBody: { fontSize: 14, lineHeight: 22, color: '#fff' },
  inkFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 13,
  },
  inkAvatar: {
    width: 28, height: 28, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  inkAvatarText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  inkFootText: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.7)' },

  logRow: {
    flexDirection: 'row', gap: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 13,
  },
  logTile: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 11,
    paddingVertical: 10, paddingHorizontal: 12, gap: 3,
  },
  logTileWarm: { backgroundColor: 'rgba(232,68,46,0.16)' },
  logLabel: {
    fontSize: 9, letterSpacing: 0.9, fontWeight: '700', color: 'rgba(255,255,255,0.45)',
  },
  logLabelWarm: { color: colors.accent },
  logValue: {
    fontSize: 15, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'],
  },
  logValueWarm: { color: colors.accent },

  calmCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.bg,
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, ...shadow,
  },
  calmIcon: {
    width: 28, height: 28, borderRadius: 999, backgroundColor: 'rgba(74,222,128,0.18)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  calmTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  calmBody: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 4 },

  actions: { flexDirection: 'row', gap: 10 },
  ghost: {
    flex: 1, height: 52, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  ghostText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#5c5c58' },
  dark: {
    flex: 1.2, height: 52, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  wide: { flex: 0, width: '100%' },
  darkText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.9, color: '#fff' },

  // 31b
  optionList: { gap: 8 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  optionOn: { borderWidth: 2, borderColor: colors.ink },
  optionLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  optionLabelOn: { fontWeight: '700' },
  radio: {
    width: 20, height: 20, borderRadius: 999, borderWidth: 1.5, borderColor: '#D8D4CA',
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  detail: {
    backgroundColor: colors.bg, borderRadius: 18, minHeight: 74, paddingVertical: 14,
    paddingHorizontal: 16, fontSize: 14, lineHeight: 21, color: colors.text,
    textAlignVertical: 'top', ...shadow,
  },

  // 31c
  hero: { alignItems: 'center', gap: 14, paddingTop: 8 },
  heroIcon: {
    width: 66, height: 66, borderRadius: 999, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadowLg,
  },
  stepRow: { flexDirection: 'row', gap: 13 },
  stepRail: { width: 20, alignItems: 'center' },
  stepDot: {
    width: 20, height: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: colors.ink },
  stepDotNow: { backgroundColor: colors.accent },
  stepDotTodo: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#D8D4CA' },
  stepDotInner: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#fff' },
  stepLine: { flex: 1, width: 2, backgroundColor: colors.border },
  stepTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  stepTitleTodo: { fontWeight: '600', color: colors.textTertiary },
  stepMeta: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 3 },
  stepMetaTodo: { color: colors.textTertiary },
  nowTag: {
    backgroundColor: 'rgba(232,68,46,0.1)', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7,
  },
  nowTagText: { fontSize: 10, letterSpacing: 0.8, fontWeight: '700', color: colors.accent },
  attachRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: '#EFECE4', paddingTop: 11,
  },
  attachText: { flex: 1, fontSize: font.tiny, color: colors.textSecondary },

  // 31d
  changedRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  changedTick: {
    width: 18, height: 18, borderRadius: 999, backgroundColor: 'rgba(74,222,128,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  changedText: { flex: 1, fontSize: 12.5, lineHeight: 19, color: '#3d3d3a' },
});
