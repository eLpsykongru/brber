import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Pressable, Share, StyleSheet, TextInput, useWindowDimensions, View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import {
  Avatar, Btn, Eyebrow, GhostBtn, Ico, Screen, Segmented, Serif, Sheet, SheetHead, Stars, T, Toggle, TopBar,
} from '../components/dark';
import { qrSvg, queueUrl } from '../lib/qr';
import { supabase } from '../lib/supabase';
import { dark as D, inter, serif } from '../theme';
import type { Member, ShopMeta } from './OwnerScreens';

// Turn 2, money & reputation: 2e shop report, 2f reviews inbox, 2g shop listing,
// 2h/2i the walk-in QR poster, 2j the wall display.

const BARBER_TINTS = ['#E8442E', '#5B8DEF', '#4ADE80', '#E8A100', '#A78BFA'];
const dh = (c: number) => `${Math.round(c / 100).toLocaleString('en-US').replace(/,/g, ' ')} DH`;
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const first = (n: string) => n.split(' ')[0];

// ---- 2e · shop report ------------------------------------------------------
type ReportRow = {
  barber_id: string; name: string; is_owner: boolean; pay_model: string; commission_pct: number;
  bookings: number; booked_cents: number | null; commission_cents: number; no_shows: number;
};
type Period = 'week' | 'month' | 'year';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'year', label: 'Year' },
];

function rangeFor(p: Period, back = 0): { from: Date; to: Date; label: string } {
  const now = new Date();
  if (p === 'week') {
    const to = new Date(now); to.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() - ((to.getDay() + 6) % 7) - back * 7 + 7);
    const from = new Date(to); from.setDate(from.getDate() - 7);
    return { from, to, label: `Week of ${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }
  if (p === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
    return { from, to, label: from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  const from = new Date(now.getFullYear() - back, 0, 1);
  const to = new Date(now.getFullYear() - back + 1, 0, 1);
  return { from, to, label: String(from.getFullYear()) };
}

export function ShopReportScreen({ onBack }: { onBack: () => void }) {
  const [period, setPeriod] = useState<Period>('month');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [prev, setPrev] = useState<number | null>(null);
  const [topUps, setTopUps] = useState(0);
  const [lastSettled, setLastSettled] = useState<Record<string, string>>({});
  const [due, setDue] = useState<ReportRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    const cur = rangeFor(period);
    const before = rangeFor(period, 1);
    const [now, past, tu, last] = await Promise.all([
      supabase.rpc('salon_report', { p_from: cur.from.toISOString(), p_to: cur.to.toISOString() }),
      supabase.rpc('salon_report', { p_from: before.from.toISOString(), p_to: before.to.toISOString() }),
      supabase.from('wallet_transactions').select('amount_cents')
        .gte('created_at', cur.from.toISOString()).lt('created_at', cur.to.toISOString()),
      supabase.rpc('salon_last_settled'),
    ]);
    setRows((now.data ?? []) as ReportRow[]);
    const prior = ((past.data ?? []) as ReportRow[]).reduce((a, r) => a + (r.booked_cents ?? 0), 0);
    setPrev(prior || null);
    setTopUps((tu.data ?? []).reduce((a: number, t: any) => a + t.amount_cents, 0));
    const by: Record<string, string> = {};
    for (const r of (last ?? { data: [] }).data ?? []) by[(r as any).barber_id] = (r as any).covers_to;
    setLastSettled(by);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  // what's owed right now: commission since each barber was last squared up
  useEffect(() => {
    (async () => {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const froms = (rows ?? []).filter((r) => r.pay_model === 'commission' && !r.is_owner);
      if (!froms.length) return setDue([]);
      const oldest = froms.reduce((a, r) => {
        const d = lastSettled[r.barber_id] ? new Date(lastSettled[r.barber_id]) : weekAgo;
        return d < a ? d : a;
      }, new Date());
      const { data } = await supabase.rpc('salon_report', {
        p_from: oldest.toISOString(), p_to: new Date().toISOString(),
      });
      const owed = ((data ?? []) as ReportRow[])
        .filter((r) => froms.some((f) => f.barber_id === r.barber_id) && r.commission_cents > 0);
      setDue(owed);
    })();
  }, [rows, lastSettled]);

  const list = rows ?? [];
  const take = list.reduce((a, r) => a + (r.booked_cents ?? 0), 0);
  const commission = list.reduce((a, r) => a + r.commission_cents, 0);
  const bookings = list.reduce((a, r) => a + r.bookings, 0);
  const noShows = list.reduce((a, r) => a + r.no_shows, 0);
  const max = Math.max(...list.map((r) => r.booked_cents ?? 0), 1);
  const delta = prev ? Math.round(((take - prev) / prev) * 100) : null;
  const cur = rangeFor(period);
  const totalDue = due.reduce((a, r) => a + r.commission_cents, 0);

  async function settleAll() {
    if (!due.length) return;
    setBusy(true);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    for (const r of due) {
      const from = lastSettled[r.barber_id] ? new Date(lastSettled[r.barber_id]) : weekAgo;
      const { error } = await supabase.rpc('salon_mark_settled', {
        p_barber: r.barber_id, p_amount_cents: r.commission_cents,
        p_from: from.toISOString(), p_to: new Date().toISOString(),
      });
      if (error) { setBusy(false); return Alert.alert('Could not settle', error.message); }
    }
    setBusy(false);
    Alert.alert('Settled', `${dh(totalDue)} recorded as collected in cash.`);
    load();
  }

  return (
    <Screen gap={14}>
      <TopBar title="Shop report" onBack={onBack} plain right="filter"
        onRight={() => Alert.alert('Export', 'Coming soon — see BACKLOG.md')} />

      <Segmented track={D.card} height={38} active={period}
        items={PERIODS.map((p) => ({ key: p.key, label: p.label }))}
        onChange={(k) => setPeriod(k as Period)} />

      <View>
        <Eyebrow ls={1.6}>{cur.label.toUpperCase()} · SHOP TAKE</Eyebrow>
        <Serif size={40} ls={0} style={s.hero}>{dh(take)}</Serif>
        <View style={s.deltaRow}>
          {delta != null && (
            <View style={s.delta}>
              <Ico name={delta >= 0 ? 'arrow-up' : 'arrow-down'} size={12}
                color={delta >= 0 ? D.green : D.red} />
              <T w="b" size={12} c={delta >= 0 ? D.green : D.red}>{Math.abs(delta)}%</T>
            </View>
          )}
          <T size={12} c={D.sub}>
            {delta != null ? 'vs previous · ' : ''}{bookings} booking{bookings === 1 ? '' : 's'}
          </T>
        </View>
      </View>

      {rows === null && <ActivityIndicator color={D.accent} accessibilityLabel="Loading the report" />}

      {!!list.length && (
        <View style={s.card}>
          <Eyebrow ls={1.4}>BY BARBER</Eyebrow>
          <View style={{ gap: 11 }}>
            {list.map((r, i) => (
              <View key={r.barber_id} style={{ gap: 6 }}>
                <View style={s.byRow}>
                  <T w="b" size={13}>
                    {first(r.name)}
                    {r.is_owner ? <T size={11} c={D.sub}> · you</T> : null}
                  </T>
                  <T w="b" size={13} style={s.tnum}>
                    {r.booked_cents == null ? 'rent' : dh(r.booked_cents)}
                  </T>
                </View>
                <View style={s.track}>
                  <View style={[s.fill, {
                    width: `${Math.round(((r.booked_cents ?? 0) / max) * 100)}%`,
                    backgroundColor: BARBER_TINTS[i % BARBER_TINTS.length],
                  }]} />
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={s.tiles}>
        <Tile label="COMMISSION" value={dh(commission)} />
        <Tile label="TOP-UPS" value={dh(topUps)} />
        <Tile label="NO-SHOWS" value={String(noShows)} color={noShows ? D.red : undefined} />
      </View>

      {due.length > 0 && (
        <>
          <Eyebrow ls={1.65}>SETTLEMENT · OWED NOW</Eyebrow>
          <View style={s.listCard}>
            {due.map((r) => (
              <View key={r.barber_id} style={[s.listRow, s.listLine]}>
                <T w="sb" size={13} style={s.grow}>{r.name}</T>
                <T w="b" size={13} c={D.accent} style={s.tnum}>{dh(r.commission_cents)}</T>
              </View>
            ))}
            <View style={s.listRow}>
              <T w="b" size={13} style={s.grow}>Total to collect</T>
              <T w="eb" size={15} style={s.tnum}>{dh(totalDue)}</T>
            </View>
          </View>
          {/* ponytail: bookkeeping only — records cash handed over, moves nothing */}
          <Btn title="MARK SETTLED IN CASH" height={52} onPress={settleAll}
            style={busy ? { opacity: 0.6 } : undefined} />
        </>
      )}
    </Screen>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.tile}>
      <Eyebrow ls={0.8}>{label}</Eyebrow>
      <T w="b" size={19} c={color ?? D.text} style={s.tnum}>{value}</T>
    </View>
  );
}

// ---- 2f · reviews inbox ----------------------------------------------------
type ReviewRow = {
  id: string; rating: number; comment: string | null; created_at: string;
  reply: string | null; replied_at: string | null; flagged_at: string | null;
  barber_id: string;
  barbers: { profiles: { full_name: string | null } | null } | null;
  customer: { full_name: string | null } | null;
};

export function ReviewsInboxScreen({ salon, team, onBack }: {
  salon: ShopMeta; team: Member[]; onBack: () => void;
}) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [filter, setFilter] = useState<'needs' | 'all' | 'low'>('needs');
  const [replyTo, setReplyTo] = useState<ReviewRow | null>(null);
  const [draft, setDraft] = useState('');
  const ids = team.map((m) => m.id);

  const load = useCallback(async () => {
    if (!ids.length) return;
    const { data, error } = await supabase.from('reviews')
      .select('id, rating, comment, created_at, reply, replied_at, flagged_at, barber_id, barbers(profiles(full_name)), customer:profiles!customer_id(full_name)')
      .in('barber_id', ids).order('created_at', { ascending: false }).limit(100);
    if (error) return Alert.alert('Could not load reviews', error.message);
    setRows((data as unknown as ReviewRow[]) ?? []);
  }, [ids.join(',')]);

  useEffect(() => { load(); }, [load]);

  async function sendReply() {
    if (!replyTo) return;
    const { error } = await supabase.rpc('review_reply', { p_review: replyTo.id, p_reply: draft });
    if (error) return Alert.alert('Could not reply', error.message);
    setReplyTo(null); setDraft(''); load();
  }

  async function flag(r: ReviewRow) {
    Alert.alert('Flag this review?', 'It stays public, but we take a look at it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Flag',
        onPress: async () => {
          const { error } = await supabase.rpc('review_flag', { p_review: r.id });
          if (error) Alert.alert('Could not flag', error.message);
          else load();
        },
      },
    ]);
  }

  const all = rows ?? [];
  const needs = all.filter((r) => !r.reply && r.rating <= 4);
  const shown = filter === 'needs' ? needs : filter === 'low' ? all.filter((r) => r.rating <= 3) : all;
  const avg = all.length ? all.reduce((a, r) => a + r.rating, 0) / all.length : 0;
  const dist = [5, 4, 3, 2, 1].map((n) => ({
    n, pct: all.length ? Math.round((all.filter((r) => r.rating === n).length / all.length) * 100) : 0,
  }));

  return (
    <Screen gap={13}>
      <TopBar title="Reviews" onBack={onBack} plain />

      <View style={s.summaryCard}>
        <View style={s.summaryLeft}>
          <Serif size={34} ls={0}>{avg ? avg.toFixed(1) : '—'}</Serif>
          <View style={{ marginTop: 3 }}><Stars n={Math.round(avg)} size={11} /></View>
          <T size={10} c={D.sub} style={{ marginTop: 4 }}>{all.length} reviews</T>
        </View>
        <View style={s.summaryBars}>
          {dist.map((d) => (
            <View key={d.n} style={s.distRow}>
              <T size={10} c={D.sub} style={{ width: 8 }}>{d.n}</T>
              <View style={s.distTrack}>
                <View style={[s.distFill, { width: `${d.pct}%` }]} />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={s.chipRow}>
        {([['needs', `Needs reply · ${needs.length}`], ['all', 'All'], ['low', 'Low']] as const).map(([k, label]) => (
          <Pressable key={k} onPress={() => setFilter(k)} accessibilityRole="button"
            accessibilityState={{ selected: filter === k }}
            style={({ pressed }) => [s.chip, filter === k && s.chipOn, pressed && s.pressed]}>
            <T w={filter === k ? 'b' : 'sb'} size={11} c={filter === k ? '#fff' : D.sub}>{label}</T>
          </Pressable>
        ))}
      </View>

      {rows === null && <ActivityIndicator color={D.accent} accessibilityLabel="Loading reviews" />}
      {rows !== null && shown.length === 0 && (
        <T size={13} c={D.sub}>Nothing here — {filter === 'needs' ? 'every review is answered.' : 'no reviews yet.'}</T>
      )}

      <View style={{ gap: 10 }}>
        {shown.map((r) => {
          const who = r.customer?.full_name ?? 'Client';
          const barber = r.barbers?.profiles?.full_name ?? 'the shop';
          return (
            <View key={r.id} style={s.reviewCard}>
              <View style={s.reviewHead}>
                <Avatar size={38} initials={initials(who)} warm={r.rating >= 5} />
                <View style={s.grow}>
                  <T w="b" size={13}>{who}</T>
                  <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                    {first(barber)} · {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </T>
                </View>
                <Stars n={r.rating} size={11} />
              </View>
              {!!r.comment && <T size={13} c={D.textDim} style={s.reviewBody}>{r.comment}</T>}
              {r.reply ? (
                <View style={s.replyBox}>
                  <View style={s.replyAvatar}>
                    <T w="b" size={9} c={D.accent}>{initials(salon.name)}</T>
                  </View>
                  <View style={s.grow}>
                    <T w="b" size={11} c={D.sub}>{salon.name} replied</T>
                    <T size={12} c={D.textDim} style={s.replyText}>{r.reply}</T>
                  </View>
                </View>
              ) : (
                <View style={s.reviewBtns}>
                  <Pressable onPress={() => { setReplyTo(r); setDraft(''); }} accessibilityRole="button"
                    accessibilityLabel={`Reply to ${who}`}
                    style={({ pressed }) => [s.replyBtn, pressed && s.pressed]}>
                    <T w="b" size={12} c="#fff" ls={0.6}>REPLY</T>
                  </Pressable>
                  <Pressable onPress={() => flag(r)} accessibilityRole="button" accessibilityLabel="Flag review"
                    style={({ pressed }) => [s.flagBtn, pressed && s.pressed]}>
                    <T w="b" size={12} c={r.flagged_at ? D.amber : D.sub}>
                      {r.flagged_at ? 'Flagged' : 'Flag'}
                    </T>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <Sheet visible={!!replyTo} onClose={() => setReplyTo(null)}>
        <SheetHead title="Reply publicly" onClose={() => setReplyTo(null)} left />
        <T size={12} c={D.sub}>
          Everyone browsing {salon.name} sees this under the review.
        </T>
        <TextInput value={draft} onChangeText={setDraft} multiline
          placeholder="Shukran — see you next time." placeholderTextColor={D.sub}
          accessibilityLabel="Your reply" style={s.replyInput} />
        <Btn title="POST REPLY" height={52} onPress={sendReply}
          style={draft.trim() ? undefined : { opacity: 0.5 }} />
      </Sheet>
    </Screen>
  );
}

// ---- 2g · shop listing, customer preview -----------------------------------
export function ShopListingScreen({ salon, onBack, onMovePin, onSaved }: {
  salon: ShopMeta & { bio?: string | null; accepting_bookings?: boolean };
  onBack: () => void; onMovePin: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(salon.name);
  const [tagline, setTagline] = useState(salon.bio ?? '');
  const [address, setAddress] = useState(salon.address ?? '');
  const [walkIns, setWalkIns] = useState(salon.accepting_bookings ?? true);
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const loadPhotos = useCallback(async () => {
    const { data } = await supabase.storage.from('salon-photos').list(salon.id, { limit: 20 });
    setPhotos((data ?? []).filter((f) => f.name !== '.emptyFolderPlaceholder').map((f) => ({
      name: `${salon.id}/${f.name}`,
      url: supabase.storage.from('salon-photos').getPublicUrl(`${salon.id}/${f.name}`).data.publicUrl,
    })));
  }, [salon.id]);

  useEffect(() => {
    loadPhotos();
    // "what the shop offers" is derived — the services the team actually sells
    supabase.from('barbers').select('id').eq('salon_id', salon.id).then(async ({ data }) => {
      const ids = (data ?? []).map((b: any) => b.id);
      if (!ids.length) return;
      const { data: svc } = await supabase.from('services').select('name')
        .in('barber_id', ids).eq('is_active', true);
      setTags([...new Set((svc ?? []).map((x: any) => x.name as string))].slice(0, 8));
    });
  }, [salon.id, loadPhotos]);

  async function addPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return;
    setBusy(true);
    try {
      const path = `${salon.id}/${Date.now()}.jpg`;
      const buf = await fetch(res.assets[0].uri).then((r) => r.arrayBuffer());
      const { error } = await supabase.storage.from('salon-photos')
        .upload(path, buf, { contentType: 'image/jpeg' });
      if (error) throw error;
      await loadPhotos();
    } catch (e: any) {
      Alert.alert('Could not upload', e.message ?? String(e));
    } finally { setBusy(false); }
  }

  function removePhoto(path: string) {
    Alert.alert('Remove photo?', '', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          await supabase.storage.from('salon-photos').remove([path]);
          loadPhotos();
        },
      },
    ]);
  }

  async function save() {
    if (!name.trim()) return Alert.alert('Missing name', 'The shop needs a name.');
    setBusy(true);
    const { error } = await supabase.from('salons').update({
      name: name.trim(), bio: tagline.trim() || null,
      address: address.trim() || null, accepting_bookings: walkIns,
    }).eq('id', salon.id);
    setBusy(false);
    if (error) return Alert.alert('Could not save', error.message);
    onSaved();
  }

  const cover = photos[0];
  const rest = photos.slice(1);

  return (
    <Screen gap={13}>
      <View style={s.listingHead}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back"
          style={({ pressed }) => [s.puck38, pressed && s.pressed]}>
          <Ico name="arrow-left" size={16} />
        </Pressable>
        <T w="b" size={17} style={s.listingTitle}>Shop listing</T>
        <Pressable onPress={save} accessibilityRole="button" accessibilityLabel="Save listing"
          style={({ pressed }) => [s.savePill, busy && { opacity: 0.6 }, pressed && s.pressed]}>
          <T w="b" size={11} c="#fff">SAVE</T>
        </Pressable>
      </View>

      <View style={s.liveStrip}>
        <Ico name="check" size={14} color={D.green} />
        <T w="sb" size={12} c={D.green} style={s.grow}>Live — this is what customers see</T>
      </View>

      <Pressable onPress={addPhoto} accessibilityRole="button" accessibilityLabel="Change cover photo"
        style={({ pressed }) => [s.cover, pressed && s.pressed]}>
        {cover
          ? <Image source={{ uri: cover.url }} style={s.coverImg} />
          : <View style={s.coverEmpty}><T size={12} c={D.sub}>Add a cover photo</T></View>}
        <View style={s.coverBadge}>
          <Ico name="edit-2" size={12} />
          <T w="b" size={11}>Change</T>
        </View>
      </Pressable>

      <View style={s.gallery}>
        {rest.slice(0, 3).map((p) => (
          <Pressable key={p.name} onLongPress={() => removePhoto(p.name)}
            accessibilityRole="imagebutton" accessibilityLabel="Gallery photo, long-press to remove">
            <Image source={{ uri: p.url }} style={s.thumb} />
          </Pressable>
        ))}
        <Pressable onPress={addPhoto} accessibilityRole="button" accessibilityLabel="Add photo"
          style={({ pressed }) => [s.thumbAdd, pressed && s.pressed]}>
          <Ico name="plus" size={18} color={D.sub} />
        </Pressable>
      </View>

      <View style={s.fieldCard}>
        <Field label="SHOP NAME" value={name} onChange={setName} bold />
        <Field label="TAGLINE" value={tagline} onChange={setTagline}
          placeholder="Skin fades & hot towel shaves" />
        <Field label="ADDRESS" value={address} onChange={setAddress} placeholder="Street, city" />
        <View style={s.pinRow}>
          <View style={s.grow}>
            <Eyebrow ls={1.2}>MAP PIN</Eyebrow>
            <T w="sb" size={14} style={{ marginTop: 3 }}>
              {(salon as any).lat != null
                ? `${(salon as any).lat.toFixed(4)}, ${(salon as any).lng.toFixed(4)}`
                : 'Not set'}
            </T>
          </View>
          <Pressable onPress={onMovePin} accessibilityRole="button" accessibilityLabel="Move map pin"
            style={({ pressed }) => [s.movePill, pressed && s.pressed]}>
            <T w="b" size={12}>Move</T>
          </Pressable>
        </View>
      </View>

      <Eyebrow ls={1.65}>WHAT THE SHOP OFFERS</Eyebrow>
      <View style={s.tagRow}>
        {tags.map((t) => (
          <View key={t} style={s.tag}><T w="sb" size={12}>{t}</T></View>
        ))}
        {tags.length === 0 && <T size={12} c={D.sub}>Add services and they show up here.</T>}
      </View>

      <View style={s.walkInRow}>
        <View style={s.grow}>
          <T w="b" size={13}>Accept walk-ins</T>
          <T size={11} c={D.sub} style={{ marginTop: 2 }}>Shows the queue and QR on your page</T>
        </View>
        <Toggle on={walkIns} onPress={() => setWalkIns(!walkIns)} />
      </View>
    </Screen>
  );
}

function Field({ label, value, onChange, placeholder, bold }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; bold?: boolean;
}) {
  return (
    <View style={[s.fieldRow, s.fieldLine]}>
      <Eyebrow ls={1.2}>{label}</Eyebrow>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder}
        placeholderTextColor={D.sub} accessibilityLabel={label}
        style={[s.fieldInput, bold && { fontFamily: inter.b }]} />
    </View>
  );
}

// ---- 2h / 2i · walk-in QR poster ------------------------------------------
type Size = 'A4' | 'A5' | 'Sticker';

export function WalkInPosterScreen({ salon, onBack }: { salon: ShopMeta; onBack: () => void }) {
  const [size, setSize] = useState<Size>('A4');
  const [showWait, setShowWait] = useState(true);
  const [busy, setBusy] = useState(false);
  const url = queueUrl(salon.id);
  const svg = qrSvg(url, 104);

  const hours = `${String(Math.floor(salon.open_min / 60)).padStart(2, '0')}:${String(salon.open_min % 60).padStart(2, '0')}`
    + ` – ${String(Math.floor(salon.close_min / 60)).padStart(2, '0')}:${String(salon.close_min % 60).padStart(2, '0')}`;

  // 2i — the printed sheet. Same layout at three paper sizes.
  function posterHtml() {
    const mm = size === 'A4' ? { w: 210, h: 297 } : size === 'A5' ? { w: 148, h: 210 } : { w: 100, h: 140 };
    const k = mm.w / 210; // scale everything off A4
    return `<html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        @page { size: ${mm.w}mm ${mm.h}mm; margin: 0; }
        body { margin:0; font-family:-apple-system,Roboto,sans-serif; }
        .sheet { width:${mm.w}mm; height:${mm.h}mm; background:#F2F0EB; color:#111;
                 display:flex; flex-direction:column; align-items:center;
                 padding:${22 * k}mm ${20 * k}mm; box-sizing:border-box; }
        .brand { font-weight:800; font-size:${26 * k}pt; letter-spacing:.24em; text-transform:uppercase; }
        .rule { width:${34 * k}px; height:2px; background:#E8442E; margin-top:${16 * k}px; }
        h1 { font-weight:700; font-size:${38 * k}pt; line-height:1.05; letter-spacing:.02em;
             text-transform:uppercase; text-align:center; margin:${26 * k}px 0 0; }
        .lede { font-size:${14 * k}pt; color:#5c5c58; margin-top:${14 * k}px; text-align:center;
                line-height:1.5; max-width:${250 * k}px; }
        .qr { background:#fff; border-radius:${14 * k}px; margin-top:${26 * k}px;
              padding:${13 * k}px; box-shadow:0 6px 18px rgba(0,0,0,.07); line-height:0; }
        .wait { display:inline-flex; align-items:center; gap:8px; background:#101010; color:#fff;
                border-radius:999px; padding:${10 * k}px ${18 * k}px; margin-top:${22 * k}px;
                font-size:${12 * k}pt; font-weight:700; letter-spacing:.04em; }
        .dot { width:7px; height:7px; border-radius:999px; background:#4ADE80; display:inline-block; }
        .spacer { flex:1; }
        .foot { width:100%; border-top:1px solid #DDD9CF; padding-top:${18 * k}px;
                display:flex; align-items:flex-end; justify-content:space-between; }
        .shop { font-weight:700; font-size:${17 * k}pt; letter-spacing:.03em; text-transform:uppercase; }
        .addr { font-size:${11 * k}pt; color:#8A8A85; margin-top:${4 * k}px; }
        .rtl { font-size:${11 * k}pt; font-weight:700; direction:rtl; }
      </style></head><body>
      <div class="sheet">
        <div class="brand">Sterncut</div>
        <div class="rule"></div>
        <h1>Skip<br>the wait</h1>
        <div class="lede">Scan with your phone camera to take a ticket and watch the queue from your seat.</div>
        <div class="qr">${qrSvg(url, Math.round(160 * k))}</div>
        ${showWait ? '<div class="wait"><span class="dot"></span>Usually 20–40 min</div>' : ''}
        <div class="spacer"></div>
        <div class="foot">
          <div>
            <div class="shop">${escapeHtml(salon.name)}</div>
            <div class="addr">${escapeHtml(salon.address ?? '')} · ${hours}</div>
          </div>
          <div style="text-align:right">
            <div class="rtl">امسح للانضمام</div>
            <div class="addr">Scannez pour patienter</div>
          </div>
        </div>
      </div></body></html>`;
  }

  async function print() {
    setBusy(true);
    try { await Print.printAsync({ html: posterHtml() }); }
    catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/didn'?t complete|cancel/i.test(msg)) Alert.alert('Could not print', msg);
    } finally { setBusy(false); }
  }

  async function download() {
    setBusy(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: posterHtml() });
      await Share.share({ url: uri, message: `${salon.name} — walk-in poster` });
    } catch (e: any) {
      Alert.alert('Could not save', e.message ?? String(e));
    } finally { setBusy(false); }
  }

  return (
    <Screen gap={13}>
      <TopBar title="Walk-in poster" onBack={onBack} plain right="send"
        onRight={() => Share.share({ message: `Join the queue at ${salon.name}: ${url}` })} />

      <T size={13} c={D.sub} style={s.lede}>
        Stick it by the mirror. Scanning puts them in your live queue with a ticket — no account needed.
      </T>

      <View style={s.poster}>
        <T style={s.posterBrand}>STERNCUT</T>
        <View style={{ alignItems: 'center' }}>
          <T style={s.posterTitle}>SKIP THE WAIT</T>
          <T size={11} style={s.posterSub}>Scan to join the queue</T>
        </View>
        <View style={s.qrBox}><SvgXml xml={svg} width={104} height={104} /></View>
        <View style={{ alignItems: 'center' }}>
          <T w="b" size={13} c="#111">{salon.name}</T>
          {!!salon.address && <T size={10} style={s.posterSub}>{salon.address}</T>}
        </View>
      </View>

      <View style={s.sizeRow}>
        {(['A4', 'A5', 'Sticker'] as const).map((k) => (
          <Pressable key={k} onPress={() => setSize(k)} accessibilityRole="button"
            accessibilityState={{ selected: size === k }}
            style={({ pressed }) => [s.sizeBtn, size === k && s.sizeBtnOn, pressed && s.pressed]}>
            <T w={size === k ? 'b' : 'sb'} size={12} c={size === k ? '#fff' : D.sub}>{k}</T>
          </Pressable>
        ))}
      </View>

      <View style={s.listCard}>
        <View style={[s.listRow, s.listLine]}>
          <T w="sb" size={13} style={s.grow}>Show live wait time</T>
          <Toggle small on={showWait} color={D.accent} onPress={() => setShowWait(!showWait)} />
        </View>
        <View style={s.listRow}>
          <T w="sb" size={13} style={s.grow}>Points at</T>
          <T size={12} c={D.sub}>Whole shop</T>
        </View>
      </View>

      <View style={s.posterBtns}>
        <GhostBtn title="DOWNLOAD" height={50} color={D.text} border={D.border}
          style={s.grow} onPress={download} />
        <Btn title="PRINT" height={50} icon="printer" style={s.growWide} onPress={print} />
      </View>
      {busy && <ActivityIndicator color={D.accent} />}
    </Screen>
  );
}

function escapeHtml(x: string) {
  return x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

// ---- 2j · wall display -----------------------------------------------------
type QueueRow = {
  id: string; barber_id: string; starts_at: string; ends_at: string;
  walk_in_name: string | null; customer_id: string;
  checked_in_at: string | null; started_at: string | null; completed_at: string | null;
  services: { name: string } | null;
  customer: { full_name: string | null } | null;
};

export function WallDisplayScreen({ salon, team, onBack }: {
  salon: ShopMeta; team: Member[]; onBack: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [now, setNow] = useState(() => new Date());
  const ids = team.filter((m) => m.status === 'approved').map((m) => m.id);

  const load = useCallback(async () => {
    if (!ids.length) return;
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const { data } = await supabase.from('bookings')
      .select('id, barber_id, starts_at, ends_at, walk_in_name, customer_id, checked_in_at, started_at, completed_at, services(name), customer:profiles!customer_id(full_name)')
      .in('barber_id', ids).eq('status', 'confirmed')
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
      .order('starts_at');
    setRows((data as unknown as QueueRow[]) ?? []);
  }, [ids.join(',')]);

  useEffect(() => {
    load();
    const t = setInterval(() => { setNow(new Date()); load(); }, 20_000);
    return () => clearInterval(t);
  }, [load]);

  // the display scales off A4-ish reference of 1280×800 so a real tablet matches the mock
  const k = Math.min(width / 1280, height / 800);
  const f = (px: number) => Math.round(px * Math.max(0.42, k));

  const active = rows.filter((r) => !r.completed_at);
  const inChair = active.find((r) => r.started_at);
  const upNext = active.filter((r) => !r.started_at).slice(0, 3);
  const label = (r: QueueRow) => r.walk_in_name
    ?? (r.customer?.full_name
      ? `${first(r.customer.full_name)} ${(r.customer.full_name.split(' ')[1] ?? '')[0] ?? ''}.`.trim()
      : 'Walk-in');
  const barberOf = (r: QueueRow) => first(team.find((m) => m.id === r.barber_id)?.name ?? 'the shop');
  const ticket = (r: QueueRow) => String(rows.indexOf(r) + 1).padStart(2, '0');
  const waitFor = (r: QueueRow) =>
    Math.max(0, Math.round((new Date(r.starts_at).getTime() - now.getTime()) / 60_000));

  return (
    <View style={s.wall}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Close the wall display"
        style={s.wallClose} hitSlop={12}>
        <Ico name="x" size={18} color={D.sub} />
      </Pressable>

      <View style={s.wallMain}>
        <View style={s.wallHead}>
          <View>
            <Serif size={f(30)} ls={0.24}>Sterncut</Serif>
            <T size={f(16)} c={D.sub} style={{ marginTop: f(9) }}>
              {salon.name}{salon.address ? ` · ${salon.address}` : ''}
            </T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Serif size={f(44)} ls={0} style={s.tnum}>{now.toTimeString().slice(0, 5)}</Serif>
            <T size={f(14)} c={D.sub} style={{ marginTop: f(8) }}>
              {now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
            </T>
          </View>
        </View>

        <View style={[s.nowCard, { padding: f(30), gap: f(34) }]}>
          <View style={[s.nowRing, { width: f(132), height: f(132) }]}>
            <T w="b" size={f(13)} c={D.green} ls={f(13) * 0.16}>NOW</T>
            <Serif size={f(54)} ls={0} style={s.tnum}>{inChair ? ticket(inChair) : '—'}</Serif>
          </View>
          <View style={s.grow}>
            <Serif size={f(46)} ls={0.02}>{inChair ? label(inChair) : 'Chair free'}</Serif>
            <T size={f(20)} c={D.sub} style={{ marginTop: f(11) }}>
              {inChair ? `${inChair.services?.name ?? 'Service'} · with ${barberOf(inChair)}` : 'Walk straight in'}
            </T>
            {inChair && (
              <View style={[s.nowSince, { marginTop: f(13) }]}>
                <View style={[s.greenDot, { width: f(11), height: f(11) }]} />
                <T w="b" size={f(16)} c={D.green}>
                  In the chair since {inChair.started_at!.slice(11, 16)}
                </T>
              </View>
            )}
          </View>
        </View>

        <View style={{ gap: f(13) }}>
          <T w="b" size={f(14)} c={D.sub} ls={f(14) * 0.2}>UP NEXT</T>
          {upNext.length === 0 && <T size={f(18)} c={D.sub}>Nobody waiting — take a seat.</T>}
          {upNext.map((r, i) => (
            <View key={r.id} style={[
              i === 0 ? s.nextCard : s.nextCardDim,
              { padding: f(i === 0 ? 20 : 17), paddingHorizontal: f(30), gap: f(24) },
            ]}>
              <View style={[
                i === 0 ? s.nextTicketHot : s.nextTicket,
                { width: f(i === 0 ? 72 : 64), height: f(i === 0 ? 72 : 64) },
              ]}>
                <Serif size={f(i === 0 ? 30 : 26)} ls={0} c={i === 0 ? D.accent : D.sub} style={s.tnum}>
                  {ticket(r)}
                </Serif>
              </View>
              <View style={s.grow}>
                <T w="b" size={f(i === 0 ? 30 : 26)}>{label(r)}</T>
                <T size={f(i === 0 ? 17 : 16)} c={D.sub} style={{ marginTop: f(4) }}>
                  {r.services?.name ?? 'Service'} · with {barberOf(r)}
                </T>
              </View>
              {i === 0 ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <T w="b" size={f(14)} c={D.sub} ls={f(14) * 0.1}>READY IN</T>
                  <T w="eb" size={f(28)} c={D.accent} style={[s.tnum, { marginTop: f(4) }]}>
                    ~{waitFor(r)} min
                  </T>
                </View>
              ) : (
                <T w="b" size={f(22)} c={D.sub} style={s.tnum}>~{waitFor(r)} min</T>
              )}
            </View>
          ))}
        </View>
      </View>

      <View style={[s.wallSide, { padding: f(38), gap: f(24) }]}>
        <View style={{ gap: f(12) }}>
          <T w="b" size={f(14)} c={D.sub} ls={f(14) * 0.2}>THE CHAIRS</T>
          {team.filter((m) => m.status === 'approved').map((m) => {
            const busy = active.some((r) => r.barber_id === m.id && r.started_at);
            const has = active.some((r) => r.barber_id === m.id);
            return (
              <View key={m.id} style={[
                has ? s.wallChair : s.wallChairOff, { padding: f(14), paddingHorizontal: f(18), gap: f(15) },
              ]}>
                <Avatar size={f(46)} warm={m.role === 'owner'} initials={initials(m.name)}
                  dot={busy ? D.green : has ? D.green : D.muted} />
                <View style={s.grow}>
                  <T w="b" size={f(18)}>{first(m.name)}</T>
                  <T size={f(14)} c={busy ? D.green : D.sub} style={{ marginTop: 2 }}>
                    {busy ? 'Cutting' : has ? 'Free' : 'Day off'}
                  </T>
                </View>
              </View>
            );
          })}
        </View>

        <View style={s.grow} />

        <View style={[s.ticketCard, { padding: f(22), gap: f(14) }]}>
          <View style={{ alignItems: 'center' }}>
            <T style={[s.ticketTitle, { fontSize: f(24) }]}>TAKE A TICKET</T>
            <T size={f(14)} style={s.ticketSub}>Scan · no app account needed</T>
          </View>
          <View style={[s.ticketQr, { width: f(158), height: f(158), padding: f(11) }]}>
            <SvgXml xml={qrSvg(queueUrl(salon.id), f(136))} width={f(136)} height={f(136)} />
          </View>
        </View>

        <View style={[s.waitCard, { padding: f(17), paddingHorizontal: f(22), gap: f(16) }]}>
          <View style={s.grow}>
            <T w="b" size={f(13)} c={D.sub} ls={f(13) * 0.16}>WAITING</T>
            <Serif size={f(34)} ls={0} style={{ marginTop: f(5) }}>{String(upNext.length)}</Serif>
          </View>
          <View style={s.waitDivider} />
          <View style={[s.grow, { alignItems: 'flex-end' }]}>
            <T w="b" size={f(13)} c={D.sub} ls={f(13) * 0.16}>TYPICAL WAIT</T>
            <Serif size={f(34)} ls={0} c={D.accent} style={{ marginTop: f(5) }}>
              {upNext.length ? `${waitFor(upNext[upNext.length - 1])} min` : '0 min'}
            </Serif>
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  growWide: { flex: 1.2 },
  pressed: { opacity: 0.7 },
  tnum: { fontVariant: ['tabular-nums'] },

  // 2e
  hero: { marginTop: 5, fontVariant: ['tabular-nums'] },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  card: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 12 },
  byRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  track: { height: 7, borderRadius: 4, backgroundColor: D.card2, overflow: 'hidden' },
  fill: { height: '100%' },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: D.card, borderRadius: 18, padding: 14, gap: 3 },
  listCard: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  listLine: { borderBottomWidth: 1, borderBottomColor: D.border },

  // 2f
  summaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 18,
    backgroundColor: D.card, borderRadius: 20, padding: 16,
  },
  summaryLeft: { alignItems: 'center' },
  summaryBars: { flex: 1, gap: 5 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  distTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: D.card2, overflow: 'hidden' },
  distFill: { height: '100%', backgroundColor: D.amber },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderRadius: 999, backgroundColor: D.card2, paddingVertical: 8, paddingHorizontal: 14 },
  chipOn: { backgroundColor: D.accent },
  reviewCard: { backgroundColor: D.card, borderRadius: 20, padding: 15, gap: 11 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  reviewBody: { lineHeight: 20 },
  reviewBtns: { flexDirection: 'row', gap: 9 },
  replyBtn: {
    flex: 1, height: 40, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  flagBtn: {
    height: 40, borderRadius: 999, borderWidth: 1, borderColor: D.border,
    paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center',
  },
  replyBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: D.card2, borderRadius: 14, padding: 12, paddingHorizontal: 13,
  },
  replyAvatar: {
    width: 24, height: 24, borderRadius: 999, backgroundColor: D.accentSoft16,
    alignItems: 'center', justifyContent: 'center',
  },
  replyText: { lineHeight: 18, marginTop: 4 },
  replyInput: {
    backgroundColor: D.card2, borderRadius: 16, minHeight: 96, padding: 16,
    textAlignVertical: 'top', fontFamily: inter.r, fontSize: 14, color: D.text,
  },

  // 2g
  listingHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  listingTitle: { flex: 1, textAlign: 'center' },
  puck38: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  savePill: {
    height: 32, borderRadius: 999, backgroundColor: D.accent, paddingHorizontal: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  liveStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14,
    paddingVertical: 11, paddingHorizontal: 14,
    backgroundColor: D.greenSoft10, borderWidth: 1, borderColor: D.greenLine,
  },
  cover: { height: 130, borderRadius: 18, overflow: 'hidden', backgroundColor: D.card },
  coverImg: { width: '100%', height: '100%' },
  coverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverBadge: {
    position: 'absolute', bottom: 8, right: 8, height: 30, borderRadius: 999,
    backgroundColor: 'rgba(13,13,15,0.8)', flexDirection: 'row', alignItems: 'center',
    gap: 6, paddingHorizontal: 12,
  },
  gallery: { flexDirection: 'row', gap: 9 },
  thumb: { width: 72, height: 72, borderRadius: 14, backgroundColor: D.card },
  thumbAdd: {
    width: 72, height: 72, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: D.muted, alignItems: 'center', justifyContent: 'center',
  },
  fieldCard: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  fieldRow: { paddingVertical: 13, gap: 3 },
  fieldLine: { borderBottomWidth: 1, borderBottomColor: D.border },
  fieldInput: { fontFamily: inter.sb, fontSize: 14, color: D.text, padding: 0 },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  movePill: {
    height: 32, borderRadius: 999, backgroundColor: D.card2, paddingHorizontal: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  tag: { borderRadius: 999, backgroundColor: D.card2, paddingVertical: 9, paddingHorizontal: 14 },
  walkInRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: D.card, borderRadius: 18, padding: 14, paddingHorizontal: 16,
  },

  // 2h
  lede: { lineHeight: 20 },
  poster: {
    backgroundColor: '#F2F0EB', borderRadius: 16, paddingVertical: 22, paddingHorizontal: 20,
    alignItems: 'center', gap: 14,
  },
  posterBrand: {
    fontFamily: serif, fontSize: 19, letterSpacing: 3.8, color: '#111', textTransform: 'uppercase',
  },
  posterTitle: {
    fontFamily: serif, fontSize: 17, letterSpacing: 0.5, color: '#111',
    textTransform: 'uppercase', textAlign: 'center',
  },
  posterSub: { color: '#8A8A85', marginTop: 5, textAlign: 'center' },
  qrBox: {
    width: 120, height: 120, backgroundColor: '#fff', borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', padding: 8,
  },
  sizeRow: { flexDirection: 'row', gap: 8 },
  sizeBtn: {
    flex: 1, height: 40, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  sizeBtnOn: { backgroundColor: D.accent },
  posterBtns: { flexDirection: 'row', gap: 9 },

  // 2j
  wall: { flex: 1, flexDirection: 'row', backgroundColor: D.bg },
  wallClose: { position: 'absolute', top: 18, right: 18, zIndex: 10, padding: 8 },
  wallMain: {
    flex: 1.35, padding: 38, paddingHorizontal: 44, gap: 26,
    borderRightWidth: 1, borderRightColor: '#1E1E22',
  },
  wallHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  nowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: D.card, borderRadius: 28 },
  nowRing: {
    borderRadius: 999, backgroundColor: 'rgba(74,222,128,0.14)', borderWidth: 3, borderColor: D.green,
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  nowSince: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  greenDot: { borderRadius: 999, backgroundColor: D.green },
  nextCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: D.card, borderRadius: 24,
    borderWidth: 3, borderColor: D.accent,
  },
  nextCardDim: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141416', borderRadius: 24 },
  nextTicketHot: {
    borderRadius: 999, backgroundColor: D.accentSoft16, alignItems: 'center', justifyContent: 'center',
  },
  nextTicket: { borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center' },
  wallSide: { flex: 0.65 },
  wallChair: { flexDirection: 'row', alignItems: 'center', backgroundColor: D.card, borderRadius: 20 },
  wallChairOff: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#141416', borderRadius: 20, opacity: 0.55,
  },
  ticketCard: { backgroundColor: '#F2F0EB', borderRadius: 26, alignItems: 'center' },
  ticketTitle: { fontFamily: serif, color: '#111', letterSpacing: 0.5, textAlign: 'center' },
  ticketSub: { color: '#8A8A85', marginTop: 6, textAlign: 'center' },
  ticketQr: { backgroundColor: '#fff', borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  waitCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: D.card, borderRadius: 20 },
  waitDivider: { width: 1, alignSelf: 'stretch', backgroundColor: D.border },
});
