import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView,
  StyleSheet, TextInput, View,
} from 'react-native';
import {
  Avatar, Btn, Card, Eyebrow, GhostBtn, Ico, IconName, Screen, Sheet, SheetHead, T, TopBar,
} from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as d, inter, radius, serif } from '../theme';

// Barber turns 5 (support console) and 6 (losing the dispute) of "Barber App.dc.html".
//
// Every case here has a counterpart in the admin desk (0042/0043): the barber's
// half of the same support_cases row. 6a/6b are what he is told when an appeal he
// never sees goes against him — see 0045 for why he is not told there was one.

export const OPS_PHONE = '+212522000000';   // TODO(backlog): a real ops line

type CaseRow = {
  id: string; case_no: string; reason: string; detail: string | null;
  amount_cents: number | null; refund_cents: number | null; status: string;
  created_at: string; resolved_at: string | null; booking_id: string | null;
  salon: string | null; other: string | null; unread: number;
};

type Msg = {
  id: string; sender_id: string | null; author_name: string | null;
  body: string; created_at: string;
};

const REASON: Record<string, { label: string; icon: IconName }> = {
  review: { label: 'A client disputed your rating', icon: 'star' },
  money: { label: 'Money or float', icon: 'credit-card' },
  booking: { label: 'A booking', icon: 'calendar' },
  client: { label: "A client's behaviour", icon: 'user' },
  app: { label: 'The app is broken', icon: 'alert-triangle' },
  no_show: { label: 'A no-show', icon: 'user-x' },
  wrong_amount: { label: 'Wrong amount', icon: 'credit-card' },
  wrong_service: { label: 'Wrong service', icon: 'scissors' },
  hygiene: { label: 'Hygiene or safety', icon: 'alert-triangle' },
  other: { label: 'Something else', icon: 'help-circle' },
};

const FAQ = [
  'When do I get the deposit money?',
  'Settling the cash float',
  'Marking a client as a no-show',
  'Asking a client to pay up front',
  'Adding a barber to my shop',
];

const ago = (iso: string) => {
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const at = (iso: string) => {
  const t = new Date(iso);
  return `${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, `
    + t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
};

// ---- 5a ------------------------------------------------------------------
export default function BarberSupportScreen({ onBack, onOpenCase }: {
  onBack: () => void; onOpenCase: (c: CaseRow) => void;
}) {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [q, setQ] = useState('');
  const [reporting, setReporting] = useState(false);
  // 6a — a review of his that came back. He is told the outcome, never that
  // anyone appealed (0045).
  const [restored, setRestored] = useState<Restored[]>([]);
  const [showing, setShowing] = useState<Restored | null>(null);
  const [replying, setReplying] = useState<Restored | null>(null);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      supabase.rpc('my_support_cases'),
      supabase.rpc('my_restored_reviews'),
    ]);
    setCases((c.data ?? []) as CaseRow[]);
    // it stays on the home screen until he has answered it and done whatever ops
    // asked for — a card that vanishes on the first tap is a card nobody acts on
    setRestored(((r.data ?? []) as Restored[])
      .filter((x) => !x.reply || (x.action && !x.action_done_at)));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (replying) {
    return (
      <PublicReplyScreen
        review={{ ...replying, customer: replying.customer }}
        onClose={() => setReplying(null)}
        onPosted={() => { setReplying(null); setShowing(null); load(); }} />
    );
  }
  if (showing) {
    return (
      <ReviewRestoredScreen item={showing} onDone={() => { setShowing(null); load(); }}
        onReply={() => { setReplying(showing); }} onActionDone={load} />
    );
  }

  const open = cases.filter((c) => c.status === 'open');
  const closed = cases.length - open.length;
  const shown = q
    ? cases.filter((c) => (REASON[c.reason]?.label ?? c.reason).toLowerCase().includes(q.toLowerCase())
        || c.case_no.toLowerCase().includes(q.toLowerCase()))
    : open;

  return (
    <>
      <Screen gap={13}>
        <TopBar title="Support" onBack={onBack} />

        <View style={s.search}>
          <Ico name="search" size={16} color={d.sub} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search help"
            placeholderTextColor={d.sub} style={s.searchInput} />
        </View>

        <Card style={s.rowCard}>
          <View style={s.onlineDot}><View style={s.onlineDotInner} /></View>
          <View style={s.grow}>
            <T w="b" size={13}>Ops is online</T>
            <T size={11} c={d.sub} style={{ marginTop: 2 }}>
              Replies in about 40 min · Arabic, Français, English
            </T>
          </View>
        </Card>

        {restored.map((r) => (
          <Card key={r.id} onPress={() => setShowing(r)} ring={d.amber} style={s.caseRow}>
            <View style={[s.caseIcon, { backgroundColor: d.amberSoft }]}>
              <Ico name="star" size={17} color={d.amber} />
            </View>
            <View style={s.grow}>
              <T w="b" size={13}>A review is back on your profile</T>
              <T size={11} c={d.sub} style={{ marginTop: 2 }}>
                {r.ref} · {r.customer} · reviewed twice
              </T>
            </View>
            <Ico name="chevron-right" size={15} color={d.muted} />
          </Card>
        ))}

        <View style={s.sectionHead}>
          <Eyebrow ls={1.65}>YOUR CASES</Eyebrow>
          {closed > 0 && <T w="sb" size={12} c={d.accent}>Closed ({closed})</T>}
        </View>

        <View style={{ gap: 9 }}>
          {shown.length === 0 && (
            <Card><T size={12} c={d.sub}>No open cases. Ops answers within the hour.</T></Card>
          )}
          {shown.map((c) => {
            const meta = REASON[c.reason] ?? REASON.other;
            const hot = c.unread > 0;
            return (
              <Card key={c.id} onPress={() => onOpenCase(c)} ring={hot ? d.accent : undefined}
                style={s.caseRow}>
                <View style={[s.caseIcon, hot && { backgroundColor: d.accentSoft }]}>
                  <Ico name={meta.icon} size={17} color={hot ? d.accent : d.sub} />
                </View>
                <View style={s.grow}>
                  <T w={hot ? 'b' : 'sb'} size={13}>{meta.label}</T>
                  <T size={11} c={d.sub} style={{ marginTop: 2 }}>
                    {c.case_no}{c.other ? ` · ${c.other}` : ''}
                    {hot ? ' · needs your reply' : ` · opened ${ago(c.created_at)}`}
                  </T>
                </View>
                {hot ? (
                  <View style={s.badge}><T w="b" size={11}>{c.unread}</T></View>
                ) : (
                  <View style={[s.chip, c.status === 'open' && s.chipWait]}>
                    <T w="b" size={10} ls={0.8} c={c.status === 'open' ? d.amber : d.sub}>
                      {c.status === 'open' ? 'WAITING' : 'CLOSED'}
                    </T>
                  </View>
                )}
              </Card>
            );
          })}
        </View>

        <Eyebrow ls={1.65} style={{ marginTop: 2 }}>COMMON FOR BARBERS</Eyebrow>
        <View style={s.faq}>
          {FAQ.map((f, i) => (
            <Pressable key={f} onPress={() => Alert.alert(f, 'Help article coming soon.')}
              style={[s.faqRow, i < FAQ.length - 1 && s.faqLine]}>
              <T w="sb" size={13} style={s.grow}>{f}</T>
              <Ico name="chevron-right" size={14} color={d.muted} />
            </Pressable>
          ))}
        </View>

        <View style={s.actions}>
          <GhostBtn title="CALL OPS" onPress={() => Linking.openURL(`tel:${OPS_PHONE}`)}
            color={d.text} border={d.card2} style={{ flex: 1, backgroundColor: d.card2 }} />
          <Btn title="NEW CASE" icon="plus" onPress={() => setReporting(true)}
            height={50} style={{ flex: 1.3 }} />
        </View>
      </Screen>

      <BarberReportSheet visible={reporting} onClose={() => setReporting(false)}
        onFiled={(c) => { setReporting(false); load(); onOpenCase(c); }} />
    </>
  );
}

// ---- 5c ------------------------------------------------------------------
const ABOUT: { key: string; label: string; icon: IconName }[] = [
  { key: 'booking', label: 'A booking', icon: 'calendar' },
  { key: 'money', label: 'Money or float', icon: 'credit-card' },
  { key: 'client', label: "A client's behaviour", icon: 'user' },
  { key: 'app', label: 'The app is broken', icon: 'alert-triangle' },
];

type Bk = {
  id: string; starts_at: string; price_cents: number; walk_in_name: string | null;
  services: { name: string } | null; profiles: { full_name: string | null } | null;
};

export function BarberReportSheet({ visible, onClose, onFiled }: {
  visible: boolean; onClose: () => void; onFiled: (c: CaseRow) => void;
}) {
  const [about, setAbout] = useState('booking');
  const [detail, setDetail] = useState('');
  const [bookings, setBookings] = useState<Bk[]>([]);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    supabase.from('bookings')
      .select('id, starts_at, price_cents, walk_in_name, services(name), profiles!customer_id(full_name)')
      .order('starts_at', { ascending: false }).limit(15)
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as Bk[];
        setBookings(rows);
        setBookingId((id) => id ?? rows[0]?.id ?? null);
      });
  }, [visible]);

  const bk = bookings.find((b) => b.id === bookingId) ?? null;
  const who = (b: Bk) => b.walk_in_name || b.profiles?.full_name || 'Client';

  async function send() {
    if (!detail.trim()) return Alert.alert('Tell ops what happened', 'A line or two is enough.');
    setBusy(true);
    const { data, error } = await supabase.rpc('file_support_case', {
      p_booking: about === 'booking' || about === 'client' ? bookingId : null,
      p_reason: about,
      p_detail: detail.trim(),
    });
    setBusy(false);
    if (error) return Alert.alert('Could not send', error.message);
    setDetail('');
    onFiled((data as CaseRow[])[0]);
  }

  const needsBooking = about === 'booking' || about === 'client';

  return (
    <Sheet visible={visible} onClose={onClose} gap={13} deep>
      <SheetHead title="Report a problem" onClose={onClose} left />

      <Eyebrow ls={1.4}>WHAT&apos;S IT ABOUT?</Eyebrow>
      <View style={{ gap: 8 }}>
        {ABOUT.map((a) => {
          const on = a.key === about;
          return (
            <Pressable key={a.key} onPress={() => setAbout(a.key)}
              accessibilityRole="radio" accessibilityState={{ selected: on }}
              style={[s.aboutRow, on && { borderWidth: 2, borderColor: d.accent }]}>
              <Ico name={a.icon} size={16} color={on ? d.accent : d.sub} />
              <T w={on ? 'b' : 'sb'} size={13} style={s.grow}>{a.label}</T>
              {on
                ? <View style={s.radioOn}><Ico name="check" size={10} color="#fff" /></View>
                : <View style={s.radioOff} />}
            </Pressable>
          );
        })}
      </View>

      {needsBooking && !!bk && (
        <>
          <Eyebrow ls={1.4}>WHICH BOOKING?</Eyebrow>
          <Pressable onPress={() => setPicking((v) => !v)} style={s.bkRow}>
            <Avatar initials={who(bk).slice(0, 2).toUpperCase()} size={38} />
            <View style={s.grow}>
              <T w="b" size={13}>
                {who(bk)} · {new Date(bk.starts_at).toTimeString().slice(0, 5)}
              </T>
              <T size={11} c={d.sub} style={{ marginTop: 2 }}>
                {bk.services?.name ?? 'Service'} · {Math.round(bk.price_cents / 100)} DH
              </T>
            </View>
            <T w="sb" size={12} c={d.accent}>Change</T>
          </Pressable>
          {picking && bookings.map((b) => (
            <Pressable key={b.id} onPress={() => { setBookingId(b.id); setPicking(false); }}
              style={[s.bkPick, b.id === bookingId && { borderColor: d.accent }]}>
              <T size={12} c={d.textDim}>
                {who(b)} · {new Date(b.starts_at).toLocaleDateString('en-US',
                  { month: 'short', day: 'numeric' })} · {b.services?.name ?? 'Service'}
              </T>
            </Pressable>
          ))}
        </>
      )}

      <Eyebrow ls={1.4}>TELL US WHAT HAPPENED</Eyebrow>
      <TextInput value={detail} onChangeText={setDetail} multiline
        placeholder="What went wrong?" placeholderTextColor={d.sub} style={s.textArea} />

      <View style={s.hintRow}>
        <View style={s.hintThumb}><Ico name="camera" size={16} color={d.sub} /></View>
        <T size={12} c={d.sub} style={[s.grow, { lineHeight: 17 }]}>
          {needsBooking
            ? 'The check-in log is attached automatically.'
            : 'Ops sees your shop and float from your account.'}
        </T>
      </View>

      <Btn title="SEND TO OPS" onPress={send} height={54} ls={0.9}
        bg={busy ? d.muted : d.accent} />
      <T size={11} c={d.sub} style={s.center}>
        Usually answered within an hour during shop hours
      </T>
    </Sheet>
  );
}

// ---- 5b / 6b -------------------------------------------------------------
export function BarberCaseScreen({ caseRow, myId, onBack, onReplyPublicly }: {
  caseRow: { id: string; case_no: string; reason: string; status: string };
  myId: string; onBack: () => void; onReplyPublicly?: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const listRef = useRef<FlatList<Msg>>(null);
  const closed = caseRow.status === 'resolved';

  const load = useCallback(async () => {
    const { data } = await supabase.from('support_messages')
      .select('id, sender_id, author_name, body, created_at')
      .eq('case_id', caseRow.id).order('created_at');
    setMsgs((data ?? []) as Msg[]);
  }, [caseRow.id]);

  useEffect(() => { load(); supabase.rpc('support_mark_read', { p_case: caseRow.id }); }, [load, caseRow.id]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    const { error } = await supabase.from('support_messages')
      .insert({ case_id: caseRow.id, sender_id: myId, body });
    if (error) return Alert.alert('Could not send', error.message);
    load();
  }

  return (
    <KeyboardAvoidingView style={s.caseScreen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.caseHead}>
        <Pressable onPress={onBack} hitSlop={8} style={s.caseBack} accessibilityLabel="Go back">
          <Ico name="arrow-left" size={17} />
        </Pressable>
        <View style={s.opsMark}><Ico name="scissors" size={19} color="#fff" /></View>
        <View style={s.grow}>
          <T w="b" size={14}>Sterncut Ops</T>
          <T size={11} c={d.sub}>
            {caseRow.case_no} · {(REASON[caseRow.reason]?.label ?? caseRow.reason).toLowerCase()}
          </T>
        </View>
        <View style={s.chip}>
          <T w="b" size={10} ls={0.8} c={closed ? d.sub : d.green}>
            {closed ? 'CLOSED' : 'OPEN'}
          </T>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.thread}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.sender_id === myId;
          return (
            <View>
              <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleThem]}>
                <T size={14} c={mine ? '#fff' : d.textDim} style={{ lineHeight: 20 }}>{item.body}</T>
              </View>
              <T size={10} c={d.sub} style={[s.stamp, mine && { textAlign: 'right' }]}>
                {mine ? 'You' : item.author_name ?? 'Ops'} · {at(item.created_at)}
              </T>
            </View>
          );
        }}
        ListFooterComponent={closed ? (
          <T size={11} c={d.sub} style={[s.center, { paddingVertical: 10 }]}>
            This case is closed. Reply to reopen it.
          </T>
        ) : null}
      />

      <View style={s.composerWrap}>
        <View style={s.composer}>
          <TextInput value={text} onChangeText={setText} placeholder="Reply to ops…"
            placeholderTextColor={d.sub} style={s.composerInput} />
          <Pressable onPress={send} disabled={!text.trim()}
            style={[s.sendBtn, !text.trim() && { opacity: 0.5 }]} accessibilityLabel="Send">
            <Ico name="arrow-up" size={17} color={text.trim() ? '#fff' : d.sub} />
          </Pressable>
        </View>
        {!!onReplyPublicly && caseRow.reason === 'review' && (
          <Pressable onPress={onReplyPublicly} style={s.publicBtn}>
            <Ico name="message-circle" size={14} />
            <T w="b" size={12} ls={0.6}>REPLY TO THE REVIEW IN PUBLIC</T>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ---- 6a ------------------------------------------------------------------
export type Restored = {
  id: string; appeal_id: string; ref: string; rating: number; comment: string | null;
  created_at: string; restored_at: string; customer: string; finding: string;
  by: string | null; action: string | null; action_due: string | null;
  action_done_at: string | null;
  rating_now: number | null; rating_count: number; reply: string | null;
};

export function ReviewRestoredScreen({ item, onDone, onReply, onActionDone }: {
  item: Restored; onDone: () => void; onReply: () => void; onActionDone?: () => void;
}) {
  const [doneAt, setDoneAt] = useState<string | null>(item.action_done_at);
  const overdue = !doneAt && !!item.action_due && new Date(item.action_due) < new Date();

  // 6a's card is an ask from ops, so it is the shop that closes it — one tap,
  // and the desk stops chasing.
  async function markDone() {
    const { error } = await supabase.rpc('complete_review_action', { p_appeal: item.appeal_id });
    if (error) return Alert.alert('Could not save', error.message);
    setDoneAt(new Date().toISOString());
    onActionDone?.();
  }

  return (
    <Screen gap={14} bottom={40}>
      <View style={s.topRow}>
        <Pressable onPress={onDone} hitSlop={8} style={s.puck38}><Ico name="arrow-left" /></Pressable>
        <T w="b" size={11} ls={2} c={d.sub} style={s.topRowTitle}>{item.ref} · RESTORED</T>
        <View style={{ width: 38 }} />
      </View>

      <View>
        <T style={s.serifTitle}>The review{'\n'}is back up</T>
        <T size={13} c={d.sub} style={{ marginTop: 9, lineHeight: 20 }}>
          We reviewed it twice. This time it stands.
        </T>
      </View>

      <Card style={{ gap: 12 }}>
        <View style={s.rowMid}>
          <StarRow n={item.rating} size={15} />
          <T size={12} c={d.sub} style={s.grow}>
            {item.customer} · {new Date(item.created_at).toLocaleDateString('en-US',
              { month: 'short', day: 'numeric' })}
          </T>
          <View style={s.pillGreen}>
            <View style={s.dotGreen} />
            <T w="b" size={10} ls={0.8} c={d.green}>PUBLIC</T>
          </View>
        </View>
        <T size={14} c={d.textDim} style={{ lineHeight: 22 }}>
          {item.comment ? `"${item.comment}"` : 'A rating with no words.'}
        </T>
      </Card>

      <View style={s.amberCard}>
        <View style={s.rowMid}>
          <Ico name="alert-triangle" size={15} color={d.amber} />
          <T w="b" size={11} ls={1.5} c={d.amber}>WHY IT STANDS</T>
        </View>
        <T size={14} c={d.textDim} style={{ lineHeight: 22 }}>{item.finding}</T>
        <View style={s.amberFoot}>
          <Avatar initials={(item.by ?? 'OPS').slice(0, 2).toUpperCase()} size={28} />
          <T size={12} c={d.sub} style={s.grow}>
            {item.by ?? 'Ops'} · {new Date(item.restored_at).toLocaleDateString('en-US',
              { weekday: 'short', month: 'short', day: 'numeric' })}
          </T>
        </View>
      </View>

      <Eyebrow ls={1.65} style={{ marginTop: 2 }}>WHAT THIS MEANS FOR YOU</Eyebrow>
      <Card style={{ gap: 11 }}>
        <Consequence>
          Your rating goes back to{' '}
          <T w="b" size={12.5} c={d.textDim}>{item.rating_now ?? '—'}</T>
          {' '}across {item.rating_count}
        </Consequence>
        <Consequence>The client keeps their side of it — nothing was held against them</Consequence>
        <Consequence green>No mark on your account — disputes are free</Consequence>
      </Card>

      {!!item.action && (
        <Card onPress={doneAt ? undefined : markDone}
          ring={doneAt ? undefined : overdue ? d.red : d.accent} style={s.actionCard}>
          <View style={[s.actionIcon, doneAt && { backgroundColor: d.greenSoft }]}>
            <Ico name={doneAt ? 'check' : 'grid'} size={17} color={doneAt ? d.green : d.accent} />
          </View>
          <View style={s.grow}>
            <T w="b" size={13} c={doneAt ? d.sub : d.text}>{item.action}</T>
            <T size={11} c={overdue ? d.red : d.sub} style={{ marginTop: 2 }}>
              {doneAt
                ? `Done ${new Date(doneAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : item.action_due
                  ? `${overdue ? 'Was due' : 'By'} ${new Date(item.action_due)
                    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · tap when it's done`
                  : "Tap when it's done"}
            </T>
          </View>
          {!doneAt && <Ico name="chevron-right" size={15} color={d.muted} />}
        </Card>
      )}

      <View style={s.actions}>
        <GhostBtn title="REPLY IN PUBLIC" onPress={onReply} color={d.sub}
          border={d.card2} style={{ flex: 1, backgroundColor: d.card2 }} height={52} />
        <Btn title="GOT IT" onPress={onDone} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}

function Consequence({ children, green }: { children: React.ReactNode; green?: boolean }) {
  return (
    <View style={s.rowMid}>
      <View style={[s.tick, green && { backgroundColor: d.greenSoft }]}>
        <Ico name="check" size={11} color={green ? d.green : d.sub} />
      </View>
      <T size={12.5} c={d.textDim} style={[s.grow, { lineHeight: 19 }]}>{children}</T>
    </View>
  );
}

function StarRow({ n, size = 12 }: { n: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ico key={i} name="star" size={size} color={i <= n ? d.amber : d.muted} />
      ))}
    </View>
  );
}

// ---- 6c ------------------------------------------------------------------
const STARTERS: { key: string; label: string; text: string }[] = [
  { key: 'own', label: 'Own the wait', text: "You did wait and I'm sorry for that — " },
  { key: 'explain', label: 'Explain calmly', text: 'Thanks for the feedback. What happened that day was ' },
  { key: 'invite', label: 'Invite him back', text: 'Come back and let me put it right — ' },
  { key: 'blank', label: 'Blank', text: '' },
];
const MAX = 400;

export function PublicReplyScreen({ review, onClose, onPosted }: {
  review: { id: string; rating: number; comment: string | null; created_at: string; customer: string };
  onClose: () => void; onPosted: () => void;
}) {
  const [text, setText] = useState('');
  const [starter, setStarter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean = text.trim();
  const ok = clean.length > 15 && !/\d{6,}/.test(clean);   // no phone numbers, not a one-word snap

  async function post() {
    if (!ok) return Alert.alert('Read it once more', 'A sentence or two, and no phone numbers.');
    setBusy(true);
    const { error } = await supabase.rpc('review_reply', { p_review: review.id, p_reply: clean });
    setBusy(false);
    if (error) return Alert.alert('Could not post', error.message);
    onPosted();
  }

  return (
    <Screen gap={12}>
      <View style={s.topRow}>
        <Pressable onPress={onClose} hitSlop={8} style={s.puck38}><Ico name="x" /></Pressable>
        <T w="b" size={11} ls={1.8} c={d.sub} style={s.topRowTitle}>REPLY IN PUBLIC</T>
        <Pressable onPress={post} hitSlop={8} disabled={!ok || busy}>
          <T w="b" size={12} c={ok ? d.accent : d.muted}>POST</T>
        </Pressable>
      </View>

      <Card style={{ borderRadius: 16, padding: 15, gap: 9 }}>
        <View style={s.rowMid}>
          <StarRow n={review.rating} />
          <T size={11} c={d.sub} style={s.grow}>
            {review.customer} · {new Date(review.created_at).toLocaleDateString('en-US',
              { month: 'short', day: 'numeric' })}
          </T>
        </View>
        <T size={12.5} c={d.sub} style={{ lineHeight: 19 }}>
          {review.comment ? `"${review.comment}"` : 'A rating with no words.'}
        </T>
      </Card>

      <Eyebrow ls={1.4}>START FROM</Eyebrow>
      <View style={s.starterRow}>
        {STARTERS.map((st) => {
          const on = starter === st.key;
          return (
            <Pressable key={st.key} onPress={() => { setStarter(st.key); setText(st.text); }}
              style={[s.starter, on && { backgroundColor: d.accent }]}>
              <T w={on ? 'b' : 'sb'} size={11} c={on ? '#fff' : d.sub}>{st.label}</T>
            </Pressable>
          );
        })}
      </View>

      <TextInput value={text} onChangeText={(v) => setText(v.slice(0, MAX))} multiline
        placeholder="Say it once, calmly." placeholderTextColor={d.sub}
        style={[s.textArea, { minHeight: 104 }]} />

      <View style={s.rowMid}>
        <T size={11} c={d.muted} style={s.grow}>{clean.length} / {MAX}</T>
        {ok && (
          <View style={s.rowMid}>
            <Ico name="check" size={12} color={d.green} />
            <T w="sb" size={11} c={d.green}>Reads well</T>
          </View>
        )}
      </View>

      <Card style={{ borderRadius: 16, padding: 15, gap: 10 }}>
        <Eyebrow ls={1.4}>BEFORE YOU POST</Eyebrow>
        <Consequence green>No accusation, no arguing the timeline</Consequence>
        <Consequence green>No phone numbers or personal details</Consequence>
        <View style={s.rowTop}>
          <Ico name="info" size={14} color={d.amber} />
          <T size={12} c={d.sub} style={[s.grow, { lineHeight: 18 }]}>
            One reply per review and you can&apos;t edit it later — read it once more.
          </T>
        </View>
      </Card>

      <Eyebrow ls={1.4}>HOW IT WILL LOOK</Eyebrow>
      <View style={s.preview}>
        <View style={s.rowMid}>
          <Avatar initials={review.customer.slice(0, 2).toUpperCase()} size={30} />
          <View style={s.grow}>
            <T w="b" size={12}>{review.customer}</T>
            <T size={10} c={d.muted} style={{ marginTop: 1 }}>
              {review.rating.toFixed(1)} ★ · {new Date(review.created_at)
                .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </T>
          </View>
        </View>
        <T size={12} c={d.sub} style={{ lineHeight: 18 }}>
          {review.comment ? `"${review.comment}"` : 'A rating with no words.'}
        </T>
        {!!clean && (
          <View style={s.quote}>
            <View style={s.rowMid}>
              <T w="b" size={11}>You</T>
              <View style={s.pillAccent}>
                <T w="b" size={9} ls={0.6} c={d.accent}>THE BARBER</T>
              </View>
            </View>
            <T size={12} c={d.textDim} style={{ marginTop: 6, lineHeight: 18 }}>{clean}</T>
          </View>
        )}
      </View>

      <Btn title="POST PUBLICLY" onPress={post} height={52} ls={0.9}
        bg={ok && !busy ? d.accent : d.muted} />
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  rowMid: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: 9, marginTop: 2 },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: d.card,
    borderRadius: 14, height: 46, paddingHorizontal: 16,
  },
  searchInput: { flex: 1, fontFamily: inter.r, fontSize: 14, color: d.text, padding: 0 },

  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, padding: 14 },
  onlineDot: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: d.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  onlineDotInner: { width: 9, height: 9, borderRadius: 999, backgroundColor: d.green },

  caseRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 13 },
  caseIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: d.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    width: 22, height: 22, borderRadius: 999, backgroundColor: d.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  chip: { backgroundColor: d.card2, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 7 },
  chipWait: { backgroundColor: d.amberSoft12 },

  faq: { backgroundColor: d.card, borderRadius: 20, paddingHorizontal: 16 },
  faqRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  faqLine: { borderBottomWidth: 1, borderBottomColor: d.border },

  // 5c
  aboutRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: d.card,
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 15,
  },
  radioOn: {
    width: 20, height: 20, borderRadius: 999, backgroundColor: d.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOff: { width: 20, height: 20, borderRadius: 999, borderWidth: 1.5, borderColor: d.muted },
  bkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: d.card,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  bkPick: {
    backgroundColor: d.card, borderRadius: 12, borderWidth: 1, borderColor: d.border,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  textArea: {
    backgroundColor: d.card2, borderRadius: 16, minHeight: 78, padding: 14,
    paddingHorizontal: 16, fontFamily: inter.r, fontSize: 14, lineHeight: 21,
    color: d.textDim, textAlignVertical: 'top',
  },
  hintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: d.card,
    borderRadius: 16, padding: 12, paddingHorizontal: 14,
  },
  hintThumb: {
    width: 38, height: 38, borderRadius: 12, borderWidth: 1, borderColor: d.muted,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
  },

  // 5b / 6b
  caseScreen: { flex: 1, backgroundColor: d.bg },
  caseHead: {
    backgroundColor: d.card, borderBottomWidth: 1, borderBottomColor: d.border,
    paddingTop: 58, paddingBottom: 14, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  caseBack: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  opsMark: {
    width: 40, height: 40, borderRadius: 999, backgroundColor: d.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  thread: { padding: 16, gap: 0 },
  bubble: { maxWidth: '82%', paddingVertical: 12, paddingHorizontal: 14 },
  bubbleMine: {
    alignSelf: 'flex-end', backgroundColor: d.accent,
    borderRadius: 18, borderBottomRightRadius: 4,
  },
  bubbleThem: {
    alignSelf: 'flex-start', backgroundColor: d.card,
    borderRadius: 18, borderBottomLeftRadius: 4,
  },
  stamp: { marginTop: 4, marginBottom: 10 },
  composerWrap: {
    gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 34,
    borderTopWidth: 1, borderTopColor: d.border, backgroundColor: d.bg,
  },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  composerInput: {
    flex: 1, height: 46, borderRadius: radius.pill, backgroundColor: d.card,
    paddingHorizontal: 16, fontFamily: inter.r, fontSize: 13, color: d.text,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: d.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  publicBtn: {
    height: 44, borderRadius: radius.pill, backgroundColor: d.card2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
  },

  // 6a
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topRowTitle: { flex: 1, textAlign: 'center' },
  puck38: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: d.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  serifTitle: {
    fontFamily: serif, fontSize: 26, lineHeight: 29, letterSpacing: 0.5,
    color: d.text, textTransform: 'uppercase',
  },
  pillGreen: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: d.greenSoft,
    borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8,
  },
  dotGreen: { width: 5, height: 5, borderRadius: 999, backgroundColor: d.green },
  amberCard: {
    backgroundColor: 'rgba(232,161,0,0.08)', borderWidth: 1, borderColor: d.amberLine,
    borderRadius: 20, padding: 16, paddingHorizontal: 18, gap: 12,
  },
  amberFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderTopWidth: 1, borderTopColor: 'rgba(232,161,0,0.2)', paddingTop: 12,
  },
  tick: {
    width: 20, height: 20, borderRadius: 999, backgroundColor: d.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, padding: 14 },
  actionIcon: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: d.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  // 6c
  starterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  starter: {
    borderRadius: 999, backgroundColor: d.card2, paddingVertical: 8, paddingHorizontal: 13,
  },
  preview: {
    backgroundColor: d.sheet, borderWidth: 1, borderColor: d.border,
    borderRadius: 16, padding: 14, paddingHorizontal: 15, gap: 11,
  },
  quote: {
    borderLeftWidth: 2, borderLeftColor: d.accent, paddingLeft: 11, marginLeft: 4,
  },
  pillAccent: {
    backgroundColor: d.accentSoft, borderRadius: 5, paddingVertical: 3, paddingHorizontal: 6,
  },
});
