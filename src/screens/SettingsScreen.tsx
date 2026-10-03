import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Display } from '../components/ui';
import { chooseLanguage, LANGUAGE_ROWS } from '../lib/language';
import { openLegal } from '../lib/legal';
import { logOut } from '../lib/push';
import { supabase } from '../lib/supabase';
import { appearance, chooseAppearance, colors, font, radius, serif, shadow, TOP_INSET } from '../theme';
import type { AppearancePick } from '../theme';
import type { Profile } from '../types';
import { tr, trn, lang } from '../lib/i18n';
import type { Lang } from '../lib/i18n';

// 19a Settings, 19b Edit profile, 20a Delete account, 20b Language.

// each row names itself in its own language; the hint names it in yours
const LANGUAGE_HINT: Record<Lang, string> = { fr: tr('French'), ar: tr('Arabic'), en: tr('English') };

type Summary = {
  wallet_cents: number; active_coupons: number; live_deposit_cents: number;
  top_barber_id: string | null; top_barber_visits: number | null;
};


// ---- 19a -----------------------------------------------------------------
export default function SettingsScreen({ profile, onBack, onProfileChanged, go }: {
  profile: Profile; onBack: () => void; onProfileChanged: () => void;
  go: (view: 'edit' | 'notifications' | 'invite' | 'password' | 'linked' | 'delete') => void;
}) {
  const [langOpen, setLangOpen] = useState(false);

  // What the app reads is the pick saved on this phone (lib/language.ts). The
  // profile keeps it too, for whatever sends texts later; offline, the switch
  // still happens.
  async function saveLanguage(next: Lang) {
    setLangOpen(false);
    if (next === lang()) return;
    await supabase.from('profiles').update({ language: next }).eq('id', profile.id);
    await chooseLanguage(next);
  }

  const current = LANGUAGE_ROWS.find((l) => l.key === lang()) ?? LANGUAGE_ROWS[0];

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Header title={tr('Settings')} onBack={onBack} />

        <Text style={s.section}>{tr('PREFERENCES')}</Text>
        <View style={s.card}>
          <Row label={tr('Language')} value={current.native} onPress={() => setLangOpen(true)} border />
          {/* ponytail: single-city launch — the city is a fact, not a picker */}
          <Row label={tr('City')} value={tr('Tangier')} border />
          {/* "Location while booking" was a switch nothing read — Explore asks the
              phone for location itself, and the phone's own setting is the switch */}
          <Row label={tr('Notifications')} hint={tr('Queue, bookings, wallet')}
            onPress={() => go('notifications')} />
        </View>

        <Text style={s.section}>{tr('APPEARANCE')}</Text>
        <View style={s.cardPad}>
          <View style={s.segRow}>
            {(['Light', 'Dark', 'System'] as const).map((mode) => {
              const pick = mode.toLowerCase() as AppearancePick;
              const on = pick === appearance;
              return (
                <Pressable key={mode} onPress={() => { if (!on) chooseAppearance(pick); }}
                  accessibilityRole="radio" accessibilityState={{ selected: on }}
                  style={({ pressed }) => [s.seg, on && s.segOn, pressed && s.pressed]}>
                  <Text style={[s.segText, on && s.segTextOn]}>{tr(mode)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.segNote}>{tr('The app restarts to switch.')}</Text>
        </View>

        <Text style={s.section}>{tr('ACCOUNT')}</Text>
        <View style={s.card}>
          <Row label={tr('Your profile')} onPress={() => go('edit')} border />
          <Row label={tr('Linked accounts')} value={tr('Email')} border onPress={() => go('linked')} />
          <Row label={tr('Invite friends')} value={tr('20 DH')} accentValue onPress={() => go('invite')} border />
          {/* sterncut.ma's pages (WEB-14/15), in the in-app browser */}
          <Row label={tr('Terms of use')} onPress={() => openLegal('terms')} border />
          <Row label={tr('Privacy policy')} onPress={() => openLegal('privacy')} />
        </View>

        <View style={[s.card, s.dangerCard]}>
          <Pressable onPress={() => Alert.alert(tr('Log out'), tr('Are you sure you want to log out?'), [
            { text: tr('Cancel'), style: 'cancel' },
            { text: tr('Yes, log out'), style: 'destructive', onPress: () => logOut() },
          ])} style={({ pressed }) => [s.row, s.rowBorder, pressed && s.pressed]}>
            <Text style={[s.rowLabel, s.danger]}>{tr('Log out')}</Text>
          </Pressable>
          <Pressable onPress={() => go('delete')}
            style={({ pressed }) => [s.row, pressed && s.pressed]}>
            <Text style={[s.rowLabel, s.danger, s.grow]}>{tr('Delete my account')}</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.accent} />
          </Pressable>
        </View>
      </ScrollView>

      <LanguageSheet visible={langOpen} value={lang()}
        onClose={() => setLangOpen(false)} onPick={saveLanguage} />
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={8}
        style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel={tr('Go back')}>
        <Ionicons name="arrow-back" size={16} color={colors.text} />
      </Pressable>
      <Display size={18} style={s.headerTitle}>{title}</Display>
      <View style={s.puckGhost} />
    </View>
  );
}

function Row({ label, hint, value, accentValue, onPress, border }: {
  label: string; hint?: string; value?: string; accentValue?: boolean;
  onPress?: () => void; border?: boolean;
}) {
  const body = (
    <>
      <View style={s.grow}>
        <Text style={s.rowLabel}>{label}</Text>
        {!!hint && <Text style={s.rowHint}>{hint}</Text>}
      </View>
      {!!value && <Text style={[s.rowValue, accentValue && s.rowValueAccent]}>{value}</Text>}
      {!!onPress && <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />}
    </>
  );
  if (!onPress) return <View style={[s.row, border && s.rowBorder]}>{body}</View>;
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => [s.row, border && s.rowBorder, pressed && s.pressed]}>
      {body}
    </Pressable>
  );
}

// ---- 20b -----------------------------------------------------------------
function LanguageSheet({ visible, value, onClose, onPick }: {
  visible: boolean; value: Lang; onClose: () => void; onPick: (key: Lang) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <View style={s.sheetHead}>
          <View style={s.sheetSlot} />
          <Display size={18} style={s.sheetTitle}>{tr('Language')}</Display>
          <Pressable onPress={onClose} hitSlop={8} style={[s.sheetSlot, s.sheetSlotEnd]}>
            <Ionicons name="close" size={16} color={colors.text} />
          </Pressable>
        </View>

        <View style={s.optionList}>
          {LANGUAGE_ROWS.map((l) => {
            const on = draft === l.key;
            return (
              <Pressable key={l.key} onPress={() => setDraft(l.key)}
                accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={({ pressed }) => [s.option, on && s.optionOn, pressed && s.pressed]}>
                <View style={s.grow}>
                  <Text style={[s.optionLabel, on && s.optionLabelOn]}>{l.native}</Text>
                  <Text style={s.optionHint}>{LANGUAGE_HINT[l.key]}</Text>
                </View>
                <View style={[s.radio, on && s.radioOn]}>
                  {on && <Ionicons name="checkmark" size={11} color="#fff" />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={s.noteCard}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
          <Text style={s.noteText}>
            {tr('Arabic turns the app right-to-left. Prices stay in DH. The app restarts to switch.')}
          </Text>
        </View>

        <Pressable onPress={() => onPick(draft)}
          style={({ pressed }) => [s.wideDark, pressed && s.pressed]}>
          <Text style={s.wideDarkText}>{tr('SAVE')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ---- 19b -----------------------------------------------------------------
export function EditProfileScreen({ profile, onBack, onDone }: {
  profile: Profile; onBack: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(profile.full_name ?? '');
  const [dob, setDob] = useState(profile.dob ?? '');
  const [avatar, setAvatar] = useState<string | null>(profile.avatar_url ?? null);
  const [usual, setUsual] = useState<string | null>(profile.usual_service ?? null);
  const [services, setServices] = useState<string[]>([]);
  const [top, setTop] = useState<{ name: string; salon: string; visits: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: sum } = await supabase.rpc('my_account_summary');
    const row = (sum ?? [])[0] as Summary | undefined;
    if (row?.top_barber_id) {
      const { data: b } = await supabase.from('barbers')
        .select('profiles!barbers_id_fkey(full_name), salon:salons!salon_id(name)')
        .eq('id', row.top_barber_id).single();
      const rec = b as unknown as { profiles: { full_name: string | null } | null; salon: { name: string } | null } | null;
      if (rec) {
        setTop({
          name: rec.profiles?.full_name ?? tr('Your barber'),
          salon: rec.salon?.name ?? tr('Salon'),
          visits: row.top_barber_visits ?? 0,
        });
      }
    }
    // the chips are the services this customer has actually booked
    const { data: bk } = await supabase.from('bookings')
      .select('services(name)').eq('customer_id', profile.id).limit(50);
    const names = [...new Set(((bk ?? []) as unknown as { services: { name: string } | null }[])
      .map((r) => r.services?.name).filter((n): n is string => !!n))];
    setServices(names.slice(0, 6));
  }, [profile.id]);

  useEffect(() => { load(); }, [load]);

  async function pickAvatar() {
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (res.canceled) return;
    setAvatar(res.assets[0].uri);
  }

  async function save() {
    setBusy(true);
    let avatarUrl = profile.avatar_url ?? null;
    if (avatar && avatar !== profile.avatar_url) {
      const body = await (await fetch(avatar)).arrayBuffer();
      const path = `${profile.id}/${Date.now()}.jpg`;
      const up = await supabase.storage.from('avatars').upload(path, body, { contentType: 'image/jpeg' });
      if (!up.error) {
        avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
    }
    const { error } = await supabase.from('profiles').update({
      full_name: name.trim() || null,
      dob: dob.trim() || null,
      usual_service: usual,
      avatar_url: avatarUrl,
    }).eq('id', profile.id);
    setBusy(false);
    if (error) return Alert.alert(tr('Could not save'), error.message);
    onDone();
  }

  const initials = (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.contentTall} showsVerticalScrollIndicator={false}>
        <Header title={tr('Your profile')} onBack={onBack} />

        <View style={s.avatarBlock}>
          <Pressable onPress={pickAvatar} style={s.avatarWrap} accessibilityLabel={tr('Change photo')}>
            {avatar
              ? <Image source={{ uri: avatar }} style={s.avatarImg} />
              : <View style={[s.avatarImg, s.avatarFallback]}>
                  <Text style={s.avatarText}>{initials}</Text>
                </View>}
            <View style={s.avatarBadge}>
              <Ionicons name="camera-outline" size={12} color="#fff" />
            </View>
          </Pressable>
          <Text style={s.changePhoto} onPress={pickAvatar}>{tr('Change photo')}</Text>
        </View>

        <View style={s.fieldList}>
          <View style={[s.field, s.fieldFocus]}>
            <Text style={s.fieldLabel}>{tr('FULL NAME')}</Text>
            <TextInput style={s.fieldInput} value={name} onChangeText={setName}
              placeholder={tr('Your name')} placeholderTextColor={colors.textTertiary} />
          </View>

          <View style={s.field}>
            <View style={s.grow}>
              <Text style={s.fieldLabel}>{tr('EMAIL')}</Text>
              <Text style={s.fieldLocked}>{profile.email ?? tr('Not set')}</Text>
            </View>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textTertiary} />
          </View>

          <View style={s.field}>
            <View style={s.grow}>
              <Text style={s.fieldLabel}>{tr('PHONE')}</Text>
              <Text style={s.fieldValue}>{profile.phone ?? tr('Not set')}</Text>
            </View>
            {!!profile.phone && (
              <View style={s.verified}>
                <Ionicons name="checkmark" size={11} color="#16A34A" />
                <Text style={s.verifiedText}>{tr('VERIFIED')}</Text>
              </View>
            )}
          </View>

          <View style={s.field}>
            <Text style={s.fieldLabel}>{tr('DATE OF BIRTH')}</Text>
            <TextInput style={s.fieldInput} value={dob} onChangeText={setDob}
              placeholder={tr('Optional · YYYY-MM-DD')} placeholderTextColor={colors.textTertiary} />
          </View>
        </View>

        {top && (
          <>
            <Text style={s.section}>{tr('PREFERRED BARBER')}</Text>
            <View style={s.prefRow}>
              <View style={s.prefAvatar}>
                <Text style={s.prefAvatarText}>
                  {top.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </Text>
              </View>
              <View style={s.grow}>
                <Text style={s.prefName}>{top.name}</Text>
                <Text style={s.rowHint}>{trn(top.visits, '{salon} · {n} visit', '{salon} · {n} visits', { salon: top.salon })}</Text>
              </View>
            </View>
          </>
        )}

        {services.length > 0 && (
          <>
            <Text style={s.section}>{tr('USUAL SERVICE')}</Text>
            <View style={s.chipRow}>
              {services.map((n) => {
                const on = usual === n;
                return (
                  <Pressable key={n} onPress={() => setUsual(on ? null : n)}
                    style={[s.chip, on && s.chipOn]}>
                    <Text style={[s.chipText, on && s.chipTextOn]}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <View style={s.footer}>
        <Pressable onPress={save} disabled={busy}
          style={({ pressed }) => [s.wideDark, (pressed || busy) && s.pressed]}>
          <Text style={s.wideDarkText}>{tr('SAVE CHANGES')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: TOP_INSET, paddingHorizontal: 20, paddingBottom: 40, gap: 13 },
  contentTall: { paddingTop: TOP_INSET, paddingHorizontal: 20, paddingBottom: 110, gap: 14 },
  grow: { flex: 1 },
  center: { alignItems: 'center', paddingTop: 4 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  puckGhost: { width: 40 },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.72 },

  section: {
    fontSize: 11, letterSpacing: 1.65, fontWeight: '700', color: colors.textSecondary, marginTop: 2,
  },
  card: { backgroundColor: colors.bg, borderRadius: 24, paddingHorizontal: 18, ...shadow },
  cardPad: {
    backgroundColor: colors.bg, borderRadius: 24, paddingVertical: 16, paddingHorizontal: 18,
    gap: 12, ...shadow,
  },
  dangerCard: { marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowHint: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  rowValue: { fontSize: 12, color: colors.textSecondary },
  rowValueAccent: { color: colors.accent, fontWeight: '600' },
  danger: { color: colors.accent },

  segRow: { flexDirection: 'row', gap: 8 },
  seg: {
    flex: 1, height: 42, borderRadius: 14, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  segOn: { backgroundColor: colors.ink },
  segText: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  segTextOn: { fontWeight: '700', color: '#fff' },
  segNote: { fontSize: font.tiny, color: colors.textTertiary },

  // sheets
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  scrimDeep: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.52)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24, paddingBottom: 34, gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  sheetSlot: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sheetSlotEnd: { alignItems: 'flex-end' },
  sheetTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.54 },
  sheetTitleTight: { marginTop: 14, textAlign: 'center' },
  sheetSub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 8, lineHeight: 20,
    textAlign: 'center',
  },
  warnCircle: {
    width: 60, height: 60, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  optionList: { gap: 9, marginTop: 2 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16, ...shadow,
  },
  optionOn: { borderWidth: 2, borderColor: colors.text },
  optionLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  optionLabelOn: { fontWeight: '700' },
  optionHint: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  radio: {
    width: 22, height: 22, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textDim },

  summaryCard: {
    backgroundColor: colors.bg, borderRadius: 20, padding: 16, gap: 11, ...shadow,
  },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  warnIcon: { marginTop: 1 },
  warnBody: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textDim },
  warnStrong: { color: colors.text, fontWeight: '700' },
  hr: { height: 1, backgroundColor: colors.border },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sumKey: { fontSize: font.small, color: colors.textSecondary },
  sumVal: { fontSize: font.small, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  confirmBlock: { gap: 8 },
  confirmInput: {
    backgroundColor: colors.bg, borderRadius: 16, height: 52, paddingHorizontal: 18,
    fontSize: 14, fontWeight: '600', letterSpacing: 1.4, color: colors.text, ...shadow,
  },
  sheetCtas: { gap: 10, marginTop: 2 },
  dangerBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  dangerText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.04, color: '#fff' },
  keepBtn: {
    height: 52, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  keepText: { fontSize: font.small, fontWeight: '700', letterSpacing: 0.78, color: colors.text },

  // 19b
  avatarBlock: { alignItems: 'center', gap: 9, paddingVertical: 4 },
  avatarWrap: { width: 92, height: 92 },
  avatarImg: { width: 92, height: 92, borderRadius: 999, backgroundColor: colors.bg },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  avatarText: { fontFamily: serif, fontSize: 30, color: colors.accent },
  avatarBadge: {
    position: 'absolute', bottom: 2, right: 2, width: 28, height: 28, borderRadius: 999,
    backgroundColor: colors.ink, borderWidth: 3, borderColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  changePhoto: { fontSize: 12, fontWeight: '600', color: colors.accent },

  fieldList: { gap: 11 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 11, paddingHorizontal: 18, ...shadow,
  },
  fieldFocus: { borderWidth: 2, borderColor: colors.text, flexDirection: 'column', alignItems: 'stretch' },
  fieldLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: colors.textTertiary },
  fieldInput: { fontSize: 14, fontWeight: '500', color: colors.text, marginTop: 3, padding: 0 },
  fieldValue: { fontSize: 14, fontWeight: '500', color: colors.text, marginTop: 3 },
  fieldLocked: { fontSize: 14, fontWeight: '500', color: colors.textDim, marginTop: 3 },
  verified: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(74,222,128,0.16)', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9,
  },
  verifiedText: { fontSize: 10, letterSpacing: 0.8, fontWeight: '700', color: colors.greenInk },

  prefRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, ...shadow,
  },
  prefAvatar: {
    width: 42, height: 42, borderRadius: 999, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  prefAvatarText: { fontSize: 12, fontWeight: '700', color: colors.accent },
  prefName: { fontSize: font.small, fontWeight: '700', color: colors.text },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: radius.pill, backgroundColor: colors.bg,
    paddingVertical: 9, paddingHorizontal: 16, ...shadow,
  },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  chipTextOn: { color: '#fff' },

  footer: { position: 'absolute', left: 20, right: 20, bottom: 26 },
  wideDark: {
    width: '100%', height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  wideDarkText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: '#fff' },
});
