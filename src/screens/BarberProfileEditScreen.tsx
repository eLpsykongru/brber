import { ReactNode, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Pressable, StyleSheet, TextInput, View, ViewStyle,
} from 'react-native';
import LocationPicker from '../components/LocationPicker';
import { Eyebrow, Ico, IconName, Screen, Serif, Sheet, T } from '../components/dark';
import { useBack } from '../components/motion';
import type { LatLng } from '../lib/geo';
import {
  ABOUT_MAX, LANGUAGES, formerlyName, nameLockedUntil, sinceYear, yearsFrom,
} from '../lib/profileRules';
import { supabase } from '../lib/supabase';
import { dark as D, inter, serif } from '../theme';
import type { Barber, Profile } from '../types';

// T4 of "Barber - Profile.dc.html" — BPR-06, and BPR-08 as the sheet behind a
// name change. BPR-07 is PreviewPage in preview mode, reached from here.
//
// The screen's one rule is that it says who each field is for. What customers see
// is editable; what only Sterncut sees is shown and locked, with the way to change
// it; and the numbers nobody edits — rating, reviews, cancellations — are named as
// absent rather than silently left out.
//
// 0109 enforces the name lock: a trigger, not this screen, refuses a second change
// inside sixty days. Two of the mock's lines are not here because nothing backs
// them — owner consent for a name containing a shop's name, and the check against
// the name on the licence (both in BACKLOG) — and the phone is shown without
// "verified", because nothing verifies it yet.

type Loaded = {
  full_name: string | null; phone: string | null;
  previous_name: string | null; name_changed_at: string | null;
  status: string; specialty: string | null; years_experience: number | null;
  languages: string[] | null; bio: string | null; licence_expires_at: string | null;
};
type Draft = { name: string; headline: string; since: string; languages: string[]; about: string };
type Salon = { id: string; name: string; lat: number | null; lng: number | null };
type Focus = 'name' | 'headline' | 'since' | 'about' | null;

const draftOf = (l: Loaded): Draft => ({
  name: l.full_name ?? '',
  headline: l.specialty ?? '',
  since: String(sinceYear(l.years_experience, new Date()) ?? ''),
  languages: l.languages ?? [],
  about: l.bio ?? '',
});

const longDate = (d: Date) => d.toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
});
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export default function BarberProfileEditScreen({
  profile, barber, avatarUrl, avatarBusy, onAvatar, onBack, onSaved, onPreview, onReviews, onCancellations, onHelp,
}: {
  profile: Profile; barber: Barber; avatarUrl: string | null; avatarBusy: boolean;
  onAvatar: () => void; onBack: () => void; onSaved: () => void; onPreview: () => void;
  onReviews: () => void; onCancellations: () => void; onHelp: () => void;
}) {
  const back = useBack(onBack);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [clients, setClients] = useState<number | null>(null);
  const [rating, setRating] = useState<{ count: number; avg: number | null }>({ count: 0, avg: null });
  const [salon, setSalon] = useState<Salon | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    const [pr, br, cc, rv, sl] = await Promise.all([
      supabase.from('profiles').select('full_name, phone, previous_name, name_changed_at')
        .eq('id', profile.id).single(),
      supabase.from('barbers').select('status, specialty, years_experience, languages, bio, licence_expires_at')
        .eq('id', barber.id).single(),
      supabase.rpc('barber_customer_count', { p_barber: barber.id }),
      supabase.from('reviews').select('rating').eq('barber_id', barber.id),
      barber.salon_id
        ? supabase.from('salons').select('id, name, lat, lng')
          .eq('id', barber.salon_id).eq('owner_id', barber.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const err = pr.error ?? br.error;
    if (err) { Alert.alert('Could not load your profile', err.message); return; }
    const next = { ...(pr.data as object), ...(br.data as object) } as Loaded;
    setLoaded(next);
    setDraft(draftOf(next));
    setClients(typeof cc.data === 'number' ? cc.data : null);
    const ratings = ((rv.data ?? []) as { rating: number }[]).map((r) => r.rating);
    setRating({
      count: ratings.length,
      avg: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    });
    setSalon((sl.data as Salon | null) ?? null);
  }, [profile.id, barber.id, barber.salon_id]);

  useEffect(() => { load(); }, [load]);

  if (!loaded || !draft) {
    return (
      <Screen gap={14}>
        <View style={s.topRow}>
          {back
            ? <Pressable onPress={back} hitSlop={8} style={s.puck} accessibilityLabel="Go back"><Ico name="arrow-left" /></Pressable>
            : <View style={s.puckGhost} />}
          <Serif size={17} style={s.topTitle}>Your profile</Serif>
          <View style={s.saveSlot} />
        </View>
        <ActivityIndicator color={D.accent} accessibilityLabel="Loading your profile" />
      </Screen>
    );
  }

  const now = Date.now();
  const live = loaded.status === 'approved';
  const lockedUntil = live ? nameLockedUntil(loaded.name_changed_at, now) : null;
  const base = draftOf(loaded);
  const nameChanged = draft.name.trim() !== base.name;
  const dirty = nameChanged || draft.headline.trim() !== base.headline || draft.since.trim() !== base.since
    || draft.about.trim() !== base.about
    || [...draft.languages].sort().join() !== [...base.languages].sort().join();
  const oldName = loaded.full_name ?? 'your current name';
  const newLock = new Date(now + 60 * 86_400_000);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  async function save(nameConfirmed = false) {
    if (!loaded || !draft) return;
    if (!draft.name.trim()) {
      Alert.alert('Your name cannot be empty', 'Customers need something to find you by.');
      return;
    }
    const thisYear = new Date().getFullYear();
    const year = draft.since.trim() ? Number(draft.since.trim()) : null;
    const years = year == null ? null : yearsFrom(year, new Date());
    if (year != null && years == null) {
      Alert.alert('Check the year', `Cutting since has to be a year between ${thisYear - 80} and ${thisYear}.`);
      return;
    }
    // BPR-08 — a live page's name is rationed; the sheet says what the change costs
    if (nameChanged && live && !nameConfirmed) {
      if (lockedUntil) {
        Alert.alert('Your name is locked', `It can change again on ${longDate(lockedUntil)}.`);
        return;
      }
      setSheetOpen(true);
      return;
    }

    setBusy(true);
    if (nameChanged) {
      const { error } = await supabase.from('profiles').update({ full_name: draft.name.trim() }).eq('id', profile.id);
      if (error) {
        setBusy(false);
        Alert.alert('Could not change your name', error.message);
        return;
      }
    }
    const { error } = await supabase.from('barbers').update({
      specialty: draft.headline.trim() || null,
      years_experience: years,
      languages: draft.languages,
      bio: draft.about.trim() || null,
    }).eq('id', barber.id);
    setBusy(false);
    if (error) { Alert.alert('Could not save', error.message); return; }
    setSheetOpen(false);
    onSaved();
  }

  function explainLock() {
    const was = loaded ? formerlyName(loaded.previous_name, loaded.name_changed_at, now) : null;
    Alert.alert('Why your name is locked',
      `${clients ? `${clients} people know` : 'Customers know'} you by the name on your page, so it changes `
      + 'at most once every sixty days.'
      + (was ? ` For thirty days after a change your page also reads “formerly ${was}”.` : ''));
  }

  async function savePin(c: LatLng) {
    setPickerOpen(false);
    if (!salon) return;
    const { error } = await supabase.from('salons').update({ lat: c.latitude, lng: c.longitude }).eq('id', salon.id);
    if (error) Alert.alert('Could not save location', error.message);
    else setSalon({ ...salon, lat: c.latitude, lng: c.longitude });
  }

  const licence = loaded.licence_expires_at ? new Date(`${loaded.licence_expires_at}T00:00:00`) : null;
  const licenceGone = !!licence && licence.getTime() < now;

  return (
    <>
      <Screen gap={10}>
        <View style={s.topRow}>
          {back
            ? <Pressable onPress={back} hitSlop={8} style={s.puck} accessibilityLabel="Go back"><Ico name="arrow-left" /></Pressable>
            : <View style={s.puckGhost} />}
          <Serif size={17} style={s.topTitle}>Your profile</Serif>
          <Pressable onPress={() => save()} disabled={!dirty || busy} hitSlop={8} style={s.saveSlot}
            accessibilityRole="button" accessibilityLabel="Save" accessibilityState={{ disabled: !dirty || busy }}>
            <T w="b" size={12} c={dirty && !busy ? D.accent : D.muted}>{busy ? '…' : 'SAVE'}</T>
          </Pressable>
        </View>

        <View style={s.photoRow}>
          <View style={s.photo}>
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={s.photoImg} />
              : <T w="b" size={16} c={D.sub}>{initials(draft.name || '?')}</T>}
          </View>
          <View style={s.grow}>
            <T w="b" size={12.5}>Your photograph</T>
            <T size={11} c={D.sub} style={s.lh16}>Your face, not your work — your work has its own page.</T>
          </View>
          <Pressable onPress={onAvatar} disabled={avatarBusy} hitSlop={8} accessibilityRole="button">
            <T w="sb" size={12} c={D.accent}>{avatarBusy ? 'Uploading…' : 'Replace'}</T>
          </Pressable>
        </View>

        <View style={s.sectionRow}>
          <Eyebrow ls={1.65}>WHAT CUSTOMERS SEE</Eyebrow>
          {!!barber.salon_id && (
            <Pressable onPress={onPreview} hitSlop={8} accessibilityRole="button">
              <T w="sb" size={12} c={D.accent}>Preview</T>
            </Pressable>
          )}
        </View>

        <Field label="NAME ON YOUR PAGE" focused={focus === 'name'}>
          <TextInput value={draft.name} onChangeText={(v) => set({ name: v })} editable={!lockedUntil}
            onFocus={() => setFocus('name')} onBlur={() => setFocus(null)} placeholder="Your name"
            placeholderTextColor={D.faint} selectionColor={D.accent} accessibilityLabel="Name on your page"
            style={[s.input, !!lockedUntil && { color: D.sub }]} />
        </Field>
        {!!lockedUntil && (
          <View style={s.ration}>
            <Ico name="clock" size={12} color={D.amber} />
            <T size={11} c={D.sub} style={[s.grow, s.lh16]}>
              Changed once already. Next change {longDate(lockedUntil)} —{' '}
              <T w="sb" size={11} c={D.accent} onPress={explainLock}>why</T>
            </T>
          </View>
        )}

        <View style={s.pair}>
          <Field label="HEADLINE" focused={focus === 'headline'} style={s.grow}>
            <TextInput value={draft.headline} onChangeText={(v) => set({ headline: v })} maxLength={40}
              onFocus={() => setFocus('headline')} onBlur={() => setFocus(null)} placeholder="Fade specialist"
              placeholderTextColor={D.faint} selectionColor={D.accent} style={s.input} accessibilityLabel="Headline" />
          </Field>
          <Field label="CUTTING SINCE" focused={focus === 'since'} style={s.since}>
            <TextInput value={draft.since} onChangeText={(v) => set({ since: v.replace(/[^0-9]/g, '') })}
              keyboardType="number-pad" maxLength={4} onFocus={() => setFocus('since')} onBlur={() => setFocus(null)}
              placeholder="2016" placeholderTextColor={D.faint} selectionColor={D.accent}
              style={[s.input, s.tnum]} accessibilityLabel="Cutting since" />
          </Field>
        </View>

        <Field label="LANGUAGES IN THE CHAIR">
          <View style={s.chips}>
            {LANGUAGES.map((l) => {
              const on = draft.languages.includes(l.key);
              return (
                <Pressable key={l.key} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  onPress={() => set({ languages: on ? draft.languages.filter((k) => k !== l.key) : [...draft.languages, l.key] })}
                  style={[s.chip, on ? s.chipOn : s.chipOff]}>
                  {on && <Ico name="check" size={11} color="#111" />}
                  <T w={on ? 'b' : 'sb'} size={11.5} c={on ? '#111' : D.sub}>{l.label}</T>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="ABOUT YOU" focused={focus === 'about'}
          right={<T w="sb" size={10} c={D.faint} style={s.tnum}>{draft.about.length} / {ABOUT_MAX}</T>}>
          <TextInput value={draft.about} onChangeText={(v) => set({ about: v })} multiline maxLength={ABOUT_MAX}
            onFocus={() => setFocus('about')} onBlur={() => setFocus(null)}
            placeholder="What you are good at, in a sentence or two" placeholderTextColor={D.faint}
            selectionColor={D.accent} style={[s.input, s.about]} accessibilityLabel="About you" />
          <T size={10.5} c={D.faint} style={s.aboutRule}>No prices here — those belong to your services.</T>
        </Field>

        <Eyebrow ls={1.65} style={s.mt2}>WHAT ONLY STERNCUT SEES</Eyebrow>
        <View style={s.private}>
          <PrivateRow icon="lock" tint={D.faint} label="Phone" value={loaded.phone ?? 'None on file'}
            last={!licence} />
          {licence && (
            <PrivateRow icon={licenceGone ? 'alert-triangle' : 'check'} tint={licenceGone ? D.amber : D.green}
              label={licenceGone ? 'Licence · ran out' : 'Licence · valid to'} last
              value={licence.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} />
          )}
          <View style={s.privateFoot}>
            <T size={10.5} c={D.faint} style={s.lh15}>
              To change one of these,{' '}
              <T w="sb" size={10.5} c={D.accent} onPress={onHelp}>send us the document</T>. Your page stays
              live and bookable while we read it.
            </T>
          </View>
        </View>

        {salon && (
          <>
            <Eyebrow ls={1.65} style={s.mt2}>YOUR SHOP</Eyebrow>
            <Pressable onPress={() => setPickerOpen(true)} accessibilityRole="button"
              style={({ pressed }) => [s.pinRow, pressed && s.pressed]}>
              <Ico name="map-pin" size={15} color={salon.lat != null ? D.green : D.accent} />
              <View style={s.grow}>
                <T w="sb" size={13}>{salon.name} on the map</T>
                <T size={11} c={D.sub} style={s.mt2}>
                  {salon.lat != null ? 'Set — tap to move the pin' : 'Not set — customers cannot find it on the map'}
                </T>
              </View>
              <Ico name="chevron-right" size={14} color={D.muted} />
            </Pressable>
          </>
        )}

        <View style={s.note}>
          <Ico name="info" size={13} color={D.sub} />
          <T size={11.5} c={D.sub} style={[s.grow, s.lh17]}>
            Your {rating.avg != null ? rating.avg.toFixed(1) : 'rating'}, your reviews and your cancellations are not
            here — they are not yours to edit. They sit on{' '}
            <T w="sb" size={11.5} c={D.accent} onPress={onReviews}>your reviews</T> and{' '}
            <T w="sb" size={11.5} c={D.accent} onPress={onCancellations}>your cancellations</T>, with how each was
            counted.
          </T>
        </View>
      </Screen>

      {/* BPR-08 — what a name change costs, said before it happens */}
      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} deep gap={13}>
        <Eyebrow ls={1.5}>CHANGE THE NAME ON YOUR PAGE</Eyebrow>
        <T style={s.stake}>
          {clients
            ? `${clients} people know you by the name you are about to delete.`
            : 'Customers find you by the name you are about to change.'}
        </T>
        <View style={s.nowNew}>
          <View style={s.grow}>
            <Eyebrow c={D.faint} ls={1.2}>NOW</Eyebrow>
            <T w="sb" size={13.5} style={s.mt2}>{oldName}</T>
          </View>
          <Ico name="arrow-right" size={15} color={D.muted} />
          <View style={s.grow}>
            <Eyebrow c={D.faint} ls={1.2}>NEW</Eyebrow>
            <T w="sb" size={13.5} c={D.accent} style={s.mt2}>{draft.name.trim()}</T>
          </View>
        </View>
        <View style={s.consequences}>
          <Consequence tone="good">
            Your {rating.count ? `${rating.count} ` : ''}review{rating.count === 1 ? '' : 's'}, your photographs and your
            regulars all follow the change
          </Consequence>
          <Consequence tone="warn">
            For thirty days your page reads <T w="sb" size={11.5} c={D.text}>formerly {oldName}</T>, so{' '}
            {clients ? `the ${clients}` : 'your clients'} can still find you
          </Consequence>
          <Consequence tone="warn">
            Once done, it locks for sixty days — until <T w="b" size={11.5} c={D.text}>{longDate(newLock)}</T>
          </Consequence>
        </View>
        <Pressable onPress={() => save(true)} disabled={busy} accessibilityRole="button"
          style={({ pressed }) => [s.whiteBtn, pressed && s.pressed]}>
          <T w="eb" size={12.5} c="#111" ls={0.5}>{busy ? 'CHANGING…' : 'CHANGE IT'}</T>
          <T w="sb" size={10.5} c="#5C5C58">Live on your page straight away</T>
        </Pressable>
        <Pressable accessibilityRole="button"
          onPress={() => { set({ name: loaded.full_name ?? '' }); setSheetOpen(false); }}
          style={({ pressed }) => [s.keepBtn, pressed && s.pressed]}>
          <T w="b" size={12.5} c={D.textDim}>Keep {oldName}</T>
        </Pressable>
      </Sheet>

      {salon && (
        <LocationPicker visible={pickerOpen}
          initial={salon.lat != null && salon.lng != null ? { latitude: salon.lat, longitude: salon.lng } : null}
          onPick={savePin} onClose={() => setPickerOpen(false)} />
      )}
    </>
  );
}

function Field({ label, children, focused, style, right }: {
  label: string; children: ReactNode; focused?: boolean; style?: ViewStyle; right?: ReactNode;
}) {
  return (
    <View style={[s.field, focused && s.fieldFocus, style]}>
      <View style={s.fieldHead}>
        <Eyebrow c={D.faint} ls={1.2} style={s.grow}>{label}</Eyebrow>
        {right}
      </View>
      {children}
    </View>
  );
}

function PrivateRow({ icon, tint, label, value, last }: {
  icon: IconName; tint: string; label: string; value: string; last?: boolean;
}) {
  return (
    <View style={[s.privRow, !last && s.privLine]}>
      <Ico name={icon} size={13} color={tint} />
      <T size={11.5} c={D.sub} style={s.grow}>{label}</T>
      <T w="sb" size={11.5} c={D.textDim}>{value}</T>
    </View>
  );
}

function Consequence({ tone, children }: { tone: 'good' | 'warn'; children: ReactNode }) {
  return (
    <View style={s.cons}>
      <View style={s.consIcon}>
        <Ico name={tone === 'good' ? 'check' : 'alert-triangle'} size={14} color={tone === 'good' ? D.green : D.amber} />
      </View>
      <T size={11.5} c={D.textDim} style={[s.grow, s.lh17]}>{children}</T>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  lh15: { lineHeight: 15 },
  lh16: { lineHeight: 16 },
  lh17: { lineHeight: 17 },
  tnum: { fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.75 },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: { width: 38, height: 38, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center' },
  puckGhost: { width: 38, height: 38 },
  topTitle: { flex: 1, textAlign: 'center' },
  saveSlot: { width: 38, alignItems: 'flex-end' },

  photoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: D.card,
    borderRadius: 18, paddingVertical: 12, paddingHorizontal: 15,
  },
  photo: {
    width: 54, height: 54, borderRadius: 999, backgroundColor: D.card2, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  photoImg: { width: 54, height: 54 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },

  field: { backgroundColor: D.card, borderRadius: 16, paddingVertical: 11, paddingHorizontal: 15, gap: 3 },
  fieldFocus: { borderWidth: 2, borderColor: D.accent, paddingVertical: 9, paddingHorizontal: 13 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { fontFamily: inter.sb, fontSize: 14, color: D.text, paddingVertical: 2, paddingHorizontal: 0 },
  ration: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -4, paddingHorizontal: 4 },
  pair: { flexDirection: 'row', gap: 9 },
  since: { width: 112 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11 },
  chipOn: { backgroundColor: '#fff' },
  chipOff: { borderWidth: 1, borderColor: D.muted },
  about: { fontFamily: inter.r, fontSize: 12.5, lineHeight: 19, color: D.textDim, minHeight: 60, textAlignVertical: 'top' },
  aboutRule: { lineHeight: 15, borderTopWidth: 1, borderTopColor: D.border, paddingTop: 8, marginTop: 4 },

  private: {
    backgroundColor: D.recessed, borderWidth: 1, borderColor: D.seam, borderRadius: 16,
    paddingHorizontal: 15, paddingVertical: 4,
  },
  privRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  privLine: { borderBottomWidth: 1, borderBottomColor: D.seam },
  privateFoot: { borderTopWidth: 1, borderTopColor: D.seam, paddingVertical: 9 },

  pinRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 15,
  },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.recessed,
    borderWidth: 1, borderColor: D.seam, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginTop: 2,
  },

  stake: { fontFamily: serif, fontSize: 20, lineHeight: 26, color: D.text },
  nowNew: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  consequences: { gap: 9, borderTopWidth: 1, borderTopColor: D.border, paddingTop: 13 },
  cons: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  consIcon: { marginTop: 2 },
  whiteBtn: {
    height: 50, borderRadius: 16, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  keepBtn: {
    height: 46, borderRadius: 16, backgroundColor: D.card, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
