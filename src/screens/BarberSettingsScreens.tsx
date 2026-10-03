import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ico, IconName, Screen, Segmented, Serif, Sheet, T, Toggle, TopBar } from '../components/dark';
import { dh } from '../lib/billing';
import { Blocker, DeletionCheck, deleteAccount, loadDeletionCheck, typedDelete } from '../lib/deletion';
import { lang, ltr, tr, trn } from '../lib/i18n';
import type { Lang } from '../lib/i18n';
import { chooseLanguage, LANGUAGE_ROWS, reopenSettings } from '../lib/language';
import { openLegal } from '../lib/legal';
import { listPortfolio } from '../lib/portfolio';
import { logOut } from '../lib/push';
import { supabase } from '../lib/supabase';
import { appearance, chooseAppearance, dark as D, inter, serif } from '../theme';
import type { AppearancePick } from '../theme';
import { biometricLockOn, LOCK_KEY } from './LinkedAccountsScreen';
import { DEFAULTS, Prefs, PUSH_ROWS } from './NotificationsScreen';

// BST-01…06 and DEL-01…03 of design_handoff_sterncut_launch/1_barber_store_readiness —
// the barber's Settings, sign-in and way out. Nothing here draws what isn't built:
// no Link button (manual identity linking is off on the project), no lock row on a
// phone with no biometrics, no delete control while anything is open.

const RED = D.red;
const NAME: Record<Lang, string> = { en: tr('English'), fr: tr('French'), ar: tr('Arabic') };
// PRO-07's three, on this side too: the barber kit has a light twin (theme.ts)
const LOOKS = [
  { key: 'light', label: tr('Light') }, { key: 'dark', label: tr('Dark') }, { key: 'system', label: tr('System') },
];
const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---- BST-01 ------------------------------------------------------------------
export default function BarberSettingsScreen({ userId, email, onBack, onNotifications, onSecurity, onDelete }: {
  userId: string; email: string | null; onBack: () => void;
  onNotifications: () => void; onSecurity: () => void; onDelete: () => void;
}) {
  const [langOpen, setLangOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  // BNT-03's state, said in one line
  useEffect(() => {
    Promise.all([
      supabase.from('notification_prefs').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('availability').select('start_min, end_min').eq('barber_id', userId),
    ]).then(([p, a]) => {
      const prefs = { ...DEFAULTS, ...(p.data ?? {}) } as Prefs;
      const on = PUSH_ROWS.filter((r) => prefs[r.key]).length;
      const w = (a.data ?? []) as { start_min: number; end_min: number }[];
      const quiet = prefs.quiet_outside_hours && w.length
        ? { start: hh(Math.max(...w.map((x) => x.end_min))), end: hh(Math.min(...w.map((x) => x.start_min))) }
        : null;
      if (on === 0) return setSummary(tr('All alerts off'));
      const q = quiet ? { start: ltr(quiet.start), end: ltr(quiet.end) } : null;
      if (on === PUSH_ROWS.length) {
        return setSummary(q ? tr('All alerts on · quiet {start}–{end}', q) : tr('All alerts on'));
      }
      setSummary(q ? tr('{n} of {total} alerts on · quiet {start}–{end}', { n: on, total: PUSH_ROWS.length, ...q })
        : tr('{n} of {total} alerts on', { n: on, total: PUSH_ROWS.length }));
    });
  }, [userId]);

  const current = LANGUAGE_ROWS.find((l) => l.key === lang());
  return (
    <Screen gap={12}>
      <TopBar title={tr('Settings')} onBack={onBack} />
      <Group>
        <Row icon="globe" label={tr('Language')} sub={current?.native} onPress={() => setLangOpen(true)} line />
        <Row icon="bell" label={tr('Notifications')} sub={summary ?? undefined} onPress={onNotifications} />
      </Group>
      <Label>{tr('APPEARANCE')}</Label>
      <Segmented items={LOOKS} active={appearance} onChange={(k) => {
        if (k === appearance) return;
        reopenSettings();
        chooseAppearance(k as AppearancePick);
      }} />
      <T size={12} c={D.sub} style={{ marginHorizontal: 4, marginTop: -4 }}>{tr('The app restarts to switch.')}</T>
      <Label>{tr('ACCOUNT')}</Label>
      <Group>
        <Row icon="lock" label={tr('Sign-in & security')} sub={email ?? undefined} onPress={onSecurity} />
      </Group>
      <Label>{tr('LEGAL')}</Label>
      <Group>
        <Row icon="file-text" label={tr('Terms of use')} onPress={() => openLegal('terms')} external line />
        <Row icon="shield" label={tr('Privacy policy')} onPress={() => openLegal('privacy')} external />
      </Group>
      <View style={{ height: 8 }} />
      <Group>
        <Row icon="log-out" label={tr('Log out')} sub={tr('This phone only')} onPress={() => setLogoutOpen(true)} bare />
      </Group>
      <Group>
        <Row icon="trash-2" label={tr('Delete account')} onPress={onDelete} danger />
      </Group>

      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} userId={userId} />
      <LogOutSheet visible={logoutOpen} onClose={() => setLogoutOpen(false)} />
    </Screen>
  );
}

// ---- BST-02 ------------------------------------------------------------------
function LanguageSheet({ visible, onClose, userId }: { visible: boolean; onClose: () => void; userId: string }) {
  const [pick, setPick] = useState<Lang>(lang());
  useEffect(() => { if (visible) setPick(lang()); }, [visible]);
  async function restart() {
    await supabase.from('profiles').update({ language: pick }).eq('id', userId);
    await chooseLanguage(pick, 'settings');
  }
  const CTA: Record<Lang, string> = {
    en: tr('Restart in English'), fr: tr('Restart in French'), ar: tr('Restart in Arabic'),
  };
  return (
    <Sheet visible={visible} onClose={onClose} gap={13}>
      <SheetTitle title={tr('Language')} onClose={onClose} />
      <View style={{ gap: 9 }}>
        {LANGUAGE_ROWS.map((l) => {
          const on = l.key === pick;
          return (
            <Pressable key={l.key} onPress={() => setPick(l.key)} accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[s.langRow, on && l.key !== lang() && s.langRowOn]}>
              <View style={s.grow}>
                <T w="b" size={l.key === 'ar' ? 16 : 15}>{l.native}</T>
                <T size={12} c={D.sub} style={{ marginTop: 3 }}>
                  {l.key === lang() ? tr('Current language') : NAME[l.key]}
                </T>
              </View>
              {on && l.key !== lang()
                ? <View style={s.radioOn}><Ico name="check" size={12} color="#fff" /></View>
                : <View style={s.radioOff} />}
            </Pressable>
          );
        })}
      </View>
      <View style={s.note}>
        <Ico name="info" size={15} color={D.sub} />
        <T size={13} c={D.textDim} style={[s.grow, { lineHeight: 19.5 }]}>
          {tr('Arabic turns the app right-to-left. The app restarts to switch.')}
        </T>
      </View>
      {pick !== lang() && <Pill title={CTA[pick]} onPress={restart} />}
    </Sheet>
  );
}

// ---- BST-05 ------------------------------------------------------------------
/** Also what Profile › Logout opens. */
export function LogOutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Confirm visible={visible} onClose={onClose} icon="log-out" title={tr('Log out of this phone?')}
      body={[tr('Your bookings, clients and messages stay. Booking alerts stop on this phone until you sign in again.')]}
      cta={tr('Log out')} onConfirm={() => logOut()} />
  );
}

// ---- BST-03 ------------------------------------------------------------------
export function SignInSecurityScreen({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [lockLabel, setLockLabel] = useState<string | null>(null);
  const [lock, setLock] = useState(false);
  const [pw, setPw] = useState<'change' | 'set' | null>(null);
  const [everywhere, setEverywhere] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    setEmail(data.user?.email ?? null);
    setProviders((data.user?.identities ?? []).map((i) => i.provider));
    // the row names what the phone has; no biometrics enrolled, no row
    if (await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync()) {
      const kinds = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const face = kinds.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      setLockLabel(Platform.OS === 'ios' ? (face ? 'Face ID' : 'Touch ID') : tr('Fingerprint'));
    }
    setLock(await biometricLockOn());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleLock() {
    const next = !lock;
    if (next) {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: lockLabel ?? 'Sterncut' });
      if (!res.success) return;
    }
    setLock(next);
    await AsyncStorage.setItem(LOCK_KEY, next ? '1' : '0');
  }

  const hasPassword = providers.includes('email');
  const linked = (p: string) => providers.includes(p);
  return (
    <Screen gap={12}>
      <TopBar title={tr('Sign-in & security')} onBack={onBack} plain />
      <Label>{tr('EMAIL')}</Label>
      <Group>
        <View style={[s.row, { minHeight: 66 }]}>
          <Bubble icon="mail" />
          <View style={s.grow}>
            <T w="sb" size={15} numberOfLines={1}>{email ? ltr(email) : ''}</T>
            <T size={12} c={D.sub} style={{ marginTop: 3 }}>{tr('Your sign-in email')}</T>
          </View>
          <Ico name="lock" size={15} color={D.sub} />
        </View>
      </Group>
      <Label>{tr('PASSWORD')}</Label>
      <Group>
        <Row icon="key" label={hasPassword ? tr('Change password') : tr('Set a password')}
          onPress={() => setPw(hasPassword ? 'change' : 'set')} />
      </Group>
      <Label>{tr('LINKED ACCOUNTS')}</Label>
      <Group>
        <Linked icon="logo-google" name="Google" on={linked('google')} line={Platform.OS === 'ios'} />
        {/* Apple sign-in is only offered on iOS */}
        {Platform.OS === 'ios' && <Linked icon="logo-apple" name="Apple" on={linked('apple')} />}
      </Group>
      {lockLabel && (
        <>
          <Label>{tr('APP LOCK')}</Label>
          <Group>
            <View style={[s.row, { minHeight: 66 }]}>
              <Bubble icon="smartphone" />
              <View style={s.grow}>
                <T w="sb" size={15}>{lockLabel}</T>
                <T size={12} c={D.sub} style={{ marginTop: 3 }}>{tr('Ask for it when Sterncut opens')}</T>
              </View>
              <Toggle on={lock} onPress={toggleLock} color={D.accent} />
            </View>
          </Group>
        </>
      )}
      <View style={{ height: 8 }} />
      <Group>
        <Row icon="monitor" label={tr('Sign out on every device')} sub={tr('Including this phone')}
          onPress={() => setEverywhere(true)} />
      </Group>

      <PasswordSheet mode={pw} email={email} onClose={() => setPw(null)}
        onSaved={() => { setPw(null); load(); }} />
      <Confirm visible={everywhere} onClose={() => setEverywhere(false)} icon="monitor"
        title={tr('Sign out on every device?')}
        body={[tr('Every phone signed in as {email} is signed out — this one now, the others within the hour.', { email: ltr(email ?? '') }),
          tr('Use it if a phone is lost, or someone else knows your password.')]}
        cta={tr('Sign out everywhere')} onConfirm={() => logOut('global')} />
    </Screen>
  );
}

// ---- BST-04 ------------------------------------------------------------------
function PasswordSheet({ mode, email, onClose, onSaved }: {
  mode: 'change' | 'set' | null; email: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [show, setShow] = useState({ current: false, next: false });
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (mode) { setCurrent(''); setNext(''); setWrong(false); } }, [mode]);
  const ruleMet = next.length >= 8;
  const ready = ruleMet && (mode === 'set' || current.length > 0) && !busy;

  async function save() {
    setBusy(true);
    if (mode === 'change') {
      // the current password is checked by signing in with it — Auth has no
      // other way to ask. The new password is kept on a miss.
      const { error } = await supabase.auth.signInWithPassword({ email: email ?? '', password: current });
      if (error) { setBusy(false); setWrong(true); return; }
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) return Alert.alert(error.message);
    Alert.alert(tr('Password changed'));
    onSaved();
  }

  async function reset() {
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) return Alert.alert(error.message);
    Alert.alert(tr('Reset link sent to {email}', { email: ltr(email) }));
  }

  return (
    <Sheet visible={!!mode} onClose={onClose} gap={12}>
      <SheetTitle title={mode === 'set' ? tr('Set a password') : tr('Change password')} onClose={onClose} />
      {mode === 'change' && (
        <View style={{ gap: 8 }}>
          <T w="b" size={10.5} c={D.sub} ls={1.5}>{tr('CURRENT PASSWORD')}</T>
          <Secret value={current} onChange={(v) => { setCurrent(v); setWrong(false); }}
            shown={show.current} onShow={() => setShow((x) => ({ ...x, current: !x.current }))} error={wrong} />
          {wrong && <T size={12.5} c={RED}>{tr('That\'s not your current password')}</T>}
          <Pressable onPress={reset} style={s.forgot} accessibilityRole="link">
            <T size={13} c={D.sub}>{tr('Forgot it?')} </T>
            <T w="b" size={13} c={D.accent}>{tr('Email me a reset link')}</T>
          </Pressable>
        </View>
      )}
      <View style={{ gap: 8 }}>
        <T w="b" size={10.5} c={D.sub} ls={1.5}>{tr('NEW PASSWORD')}</T>
        <Secret value={next} onChange={setNext} focused
          shown={show.next} onShow={() => setShow((x) => ({ ...x, next: !x.next }))} />
        <View style={s.rule}>
          <Ico name={ruleMet ? 'check' : 'circle'} size={14} color={ruleMet ? D.green : D.sub} />
          <T size={12.5} c={ruleMet ? D.green : D.sub}>{tr('At least 8 characters')}</T>
        </View>
      </View>
      <Pill title={tr('Save password')} onPress={ready ? save : undefined} dim={!ready} busy={busy} />
    </Sheet>
  );
}

function Secret({ value, onChange, shown, onShow, error, focused }: {
  value: string; onChange: (v: string) => void; shown: boolean; onShow: () => void;
  error?: boolean; focused?: boolean;
}) {
  return (
    <View style={[s.secret, focused && { borderColor: D.text }, error && { borderColor: RED }]}>
      <TextInput value={value} onChangeText={onChange} secureTextEntry={!shown} autoCapitalize="none"
        autoCorrect={false} style={s.secretInput} placeholderTextColor={D.sub} textAlign="left" />
      <Pressable onPress={onShow} style={s.eye} accessibilityLabel={shown ? tr('Hide') : tr('Show')}>
        <Ico name={shown ? 'eye-off' : 'eye'} size={17} color={D.sub} />
      </Pressable>
    </View>
  );
}

// ---- DEL-01 / DEL-02 ----------------------------------------------------------
export function BarberDeleteScreen({ userId, onBack, onCalendar, onAccount, onSettle, onCashAgent, onTalkToUs }: {
  userId: string; onBack: () => void; onCalendar: () => void; onAccount: () => void;
  onSettle: () => void; onCashAgent: () => void; onTalkToUs: (firstLine: string) => void;
}) {
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [photos, setPhotos] = useState(0);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setCheck(await loadDeletionCheck()); }
    catch (e: any) { Alert.alert(tr('Could not load'), e.message); }
    listPortfolio(userId).then((p) => setPhotos(p.length)).catch(() => {});
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  if (!check?.barber) {
    return <Screen><TopBar title={tr('Delete account')} onBack={onBack} plain /><ActivityIndicator color={D.text} /></Screen>;
  }
  const rows = check.barber.blockers;
  // the bookings row already counts his own deposit bookings elsewhere (0131)
  const open = rows.filter((b) => b.open).length;

  if (open > 0) {
    const HEAD = [tr('One thing first'), tr('Two things first'), tr('Three things first'), tr('Four things first')];
    return (
      <Screen gap={12}>
        <TopBar title={tr('Delete account')} onBack={onBack} plain />
        <View style={{ gap: 6, paddingTop: 8, paddingHorizontal: 2 }}>
          <T style={s.display28}>{HEAD[Math.min(open, 4) - 1]}</T>
          <T size={13} c={D.sub} style={{ lineHeight: 19.5 }}>
            {tr('Clear each one and you can delete. Nothing has been deleted yet.')}
          </T>
        </View>
        <View style={s.progress}>
          <T w="b" size={11} c={D.sub} ls={1.65}>
            {tr('{n} OF {total} CLEAR', { n: rows.length - open, total: rows.length })}
          </T>
          <View style={s.bars}>
            {rows.map((b) => <View key={b.key} style={[s.bar, !b.open && { backgroundColor: D.green }]} />)}
          </View>
        </View>
        {rows.map((b) => (
          <BlockerCard key={b.key} b={b} onCalendar={onCalendar} onAccount={onAccount}
            onSettle={onSettle} onCashAgent={onCashAgent} onTalkToUs={onTalkToUs} />
        ))}
      </Screen>
    );
  }

  const armed = typedDelete(typed) && !busy;
  async function destroy() {
    setBusy(true);
    const refused = await deleteAccount(userId, typed, false, 'barber');
    if (!refused) return;              // signed out: App draws DEL-03
    setBusy(false);
    Alert.alert(tr('Something changed. Check the list again.'));
    load();
  }

  return (
    <View style={s.fill}>
      <Screen gap={12} bottom={150}>
        <TopBar title={tr('Delete account')} onBack={onBack} plain />
        <View style={s.clearPill}>
          <Ico name="check" size={12} color={D.green} />
          <T w="b" size={11.5} c={D.green}>{tr('All clear')}</T>
        </View>
        <View style={{ gap: 6 }}>
          <T style={s.display26}>{tr('Nothing stands in the way')}</T>
          <T size={13} c={D.sub} style={{ lineHeight: 19.5 }}>
            {tr('Your name comes off everything. The records stay, without it.')}
          </T>
        </View>
        <View style={[s.list, { gap: 9 }]}>
          <T w="b" size={10.5} c={RED} ls={1.5}>{tr('WHAT GOES')}</T>
          {[tr('Name, phone and email'), tr('Photo and bio'), tr('ID document'),
            ...(photos > 0 ? [trn(photos, '{n} portfolio photo', '{n} portfolio photos')] : []),
            tr('Chat messages and photos')].map((t) => (
            <View key={t} style={s.goes}><Ico name="x" size={12} color={RED} /><T size={13.5}>{t}</T></View>
          ))}
        </View>
        <View style={s.list}>
          <T w="b" size={10.5} c={D.sub} ls={1.5}>{tr('WHAT STAYS, WITHOUT A NAME')}</T>
          {check.barber.bookings > 0 && (
            <Stays title={trn(check.barber.bookings, '{n} booking', '{n} bookings')} sub={tr('Clients see “Former barber”')} />
          )}
          {check.barber.reviews > 0 && <Stays title={trn(check.barber.reviews, '{n} review', '{n} reviews')} />}
          <Stays title={tr('Every money record')} sub={tr('Statements and invoices are kept 10 years by law')} />
        </View>
        <View style={{ gap: 8, marginTop: 2 }}>
          <T w="b" size={10.5} c={D.sub} ls={1.5}>{tr('TYPE DELETE TO CONFIRM')}</T>
          <TextInput value={typed} onChangeText={setTyped} placeholder="DELETE" placeholderTextColor={D.muted}
            autoCapitalize="characters" autoCorrect={false} textAlign="left"
            style={[s.confirm, typedDelete(typed) && { borderColor: RED }]} />
          <T size={12} c={D.sub}>{tr('This can\'t be undone.')}</T>
        </View>
      </Screen>
      <View style={s.footer}>
        <Pill title={tr('Delete my account')} onPress={armed ? destroy : undefined} dim={!armed}
          busy={busy} bg={RED} fg={D.bg} />
        <Ghost title={tr('Keep my account')} onPress={onBack} />
      </View>
    </View>
  );
}

function BlockerCard({ b, onCalendar, onAccount, onSettle, onCashAgent, onTalkToUs }: {
  b: Blocker; onCalendar: () => void; onAccount: () => void; onSettle: () => void;
  onCashAgent: () => void; onTalkToUs: (firstLine: string) => void;
}) {
  if (!b.open) {
    const clear = b.key === 'bookings' ? [tr('No client bookings ahead')]
      : b.key === 'money' ? [tr('Nothing between you and Sterncut')]
        : b.key === 'drawer'
          ? [tr('The shop\'s cash drawer'), b.holder ? tr('{name} holds it, not you.', { name: b.holder.split(' ')[0] }) : '']
          : [tr('You own {shop}', { shop: ltr(b.shop) })];
    return (
      <View style={[s.card, s.cardRow]}>
        <View style={[s.bubble36, { backgroundColor: 'rgba(74,222,128,.14)' }]}><Ico name="check" size={15} color={D.green} /></View>
        <View style={s.grow}>
          <T w="sb" size={15} c={D.textDim}>{clear[0]}</T>
          {!!clear[1] && <T size={12.5} c={D.sub} style={{ marginTop: 3 }}>{clear[1]}</T>}
        </View>
        <T w="b" size={10} c={D.green} ls={1.2}>{tr('CLEAR')}</T>
      </View>
    );
  }
  let icon: IconName = 'calendar', title = '', sub = '', cta = '', go = onCalendar;
  if (b.key === 'bookings') {
    title = trn(b.n, '{n} client booking ahead', '{n} client bookings ahead');
    sub = tr('Cancel or finish each one. Clients are told when a booking is cancelled.');
    cta = tr('Calendar');
  } else if (b.key === 'money') {
    icon = 'credit-card';
    const amount = ltr(dh(b.cents));
    title = b.cents > 0 ? tr('You owe Sterncut {amount}', { amount }) : tr('Sterncut owes you {amount}', { amount });
    sub = tr('It has to reach zero, whichever way it runs.');
    cta = tr('You & Sterncut'); go = onAccount;
  } else if (b.key === 'drawer') {
    icon = 'inbox';
    title = tr('You hold the shop\'s cash · {amount}', { amount: ltr(dh(b.cents)) });
    sub = tr('Hand it over before you go.');
    cta = b.is_owner ? tr('Who holds the cash') : tr('Settle up');
    go = b.is_owner ? onCashAgent : onSettle;
  } else {
    icon = 'home';
    const shop = ltr(b.shop);
    title = tr('You own {shop}', { shop });
    const names = b.names.map(ltr);
    sub = [
      names.length ? trn(names.length, '{names} still works there, and a shop can\'t be handed over from the app.',
        '{names} still work there, and a shop can\'t be handed over from the app.',
        { names: names.length > 1 ? `${names.slice(0, -1).join(', ')} ${tr('and')} ${names[names.length - 1]}` : names[0] }) : '',
      b.bill_cents > 0 ? tr('{shop} has an unpaid bill of {amount}.', { shop, amount: ltr(dh(b.bill_cents)) }) : '',
    ].filter(Boolean).join(' ');
    cta = tr('Talk to us');
    go = () => onTalkToUs(tr('Delete my account — I own {shop}', { shop: b.shop }));
  }
  return (
    <View style={[s.card, { gap: 11 }]}>
      <View style={s.cardTop}>
        <View style={[s.bubble36, { backgroundColor: D.amberSoft }]}><Ico name={icon} size={16} color={D.amber} /></View>
        <View style={[s.grow, { paddingTop: 1 }]}>
          <T w="b" size={15} style={{ lineHeight: 19.5 }}>{title}</T>
          <T size={12.5} c={D.sub} style={{ marginTop: 3, lineHeight: 18 }}>{sub}</T>
        </View>
      </View>
      <Pressable onPress={go} accessibilityRole="button"
        style={({ pressed }) => [s.cta, pressed && s.pressed]}>
        <T w="b" size={13}>{cta}</T>
        <Ico name={lang() === 'ar' ? 'chevron-left' : 'chevron-right'} size={14} color={D.sub} />
      </Pressable>
    </View>
  );
}

// ---- DEL-03 ------------------------------------------------------------------
/** Drawn from local state after the server confirmed; nothing here fetches. */
export function BarberDeletedScreen({ onDone }: { onDone: () => void }) {
  return (
    <View style={[s.fill, s.doneWrap]}>
      <View style={s.doneMid}>
        <View style={s.doneMark}><Ico name="check" size={28} color={D.text} /></View>
        <T w="b" size={11} c={D.sub} ls={1.76} style={{ marginTop: 10 }}>{tr('SIGNED OUT')}</T>
        <Serif size={30} ls={0.04}>{tr('Account deleted')}</Serif>
        <T size={14} c={D.sub} style={s.doneText}>
          {tr('Bookings, reviews and money records stay without your name — the law has us keep statements and invoices for 10 years.')}
        </T>
      </View>
      <View style={{ paddingHorizontal: 24, paddingBottom: 40 }}><Pill title={tr('Done')} onPress={onDone} /></View>
    </View>
  );
}

// ---- pieces ------------------------------------------------------------------
function Label({ children }: { children: ReactNode }) {
  return <T w="b" size={11} c={D.sub} ls={1.65} style={{ marginTop: 6, marginBottom: -4, marginHorizontal: 4 }}>{children}</T>;
}
function Group({ children }: { children: ReactNode }) {
  return <View style={s.group}>{children}</View>;
}
function Bubble({ icon, color = D.text, bg = D.card2 }: { icon: IconName; color?: string; bg?: string }) {
  return <View style={[s.bubble36, { backgroundColor: bg }]}><Ico name={icon} size={16} color={color} /></View>;
}
function Row({ icon, label, sub, onPress, line, external, danger, bare }: {
  icon: IconName; label: string; sub?: string; onPress: () => void;
  line?: boolean; external?: boolean; danger?: boolean; bare?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole={external ? 'link' : 'button'}
      style={({ pressed }) => [s.row, line && s.line, pressed && s.pressed]}>
      <Bubble icon={icon} color={danger ? RED : D.text} bg={danger ? 'rgba(248,113,113,.14)' : D.card2} />
      <View style={s.grow}>
        <T w="sb" size={15} c={danger ? RED : D.text}>{label}</T>
        {!!sub && <T size={12} c={D.sub} style={{ marginTop: 3 }} numberOfLines={1}>{sub}</T>}
      </View>
      {external ? <Ico name="external-link" size={15} color={D.sub} />
        : !bare && <Ico name={lang() === 'ar' ? 'chevron-left' : 'chevron-right'} size={15} color={D.muted} />}
    </Pressable>
  );
}
function Linked({ icon, name, on, line }: { icon: 'logo-google' | 'logo-apple'; name: string; on: boolean; line?: boolean }) {
  return (
    <View style={[s.row, line && s.line]}>
      <View style={[s.bubble36, { backgroundColor: D.card2 }]}><Ionicons name={icon} size={16} color={D.text} /></View>
      <View style={s.grow}>
        <T w="sb" size={15}>{name}</T>
        {!on && <T size={12} c={D.sub} style={{ marginTop: 3 }}>{tr('Not linked')}</T>}
      </View>
      {on && (
        <View style={s.linked}><Ico name="check" size={13} color={D.green} /><T w="b" size={12} c={D.green}>{tr('Linked')}</T></View>
      )}
    </View>
  );
}
function Stays({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={s.stays}>
      <View style={s.staysDot} />
      <View style={s.grow}>
        <T w="sb" size={13.5}>{title}</T>
        {!!sub && <T size={12} c={D.sub} style={{ marginTop: 2 }}>{sub}</T>}
      </View>
    </View>
  );
}
function SheetTitle({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={s.sheetTitle}>
      <T w="b" size={18} style={s.grow}>{title}</T>
      <Pressable onPress={onClose} accessibilityLabel={tr('Close')} style={s.close}><Ico name="x" size={16} /></Pressable>
    </View>
  );
}
function Pill({ title, onPress, dim, busy, bg = D.accent, fg = '#fff' }: {
  title: string; onPress?: () => void; dim?: boolean; busy?: boolean; bg?: string; fg?: string;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button"
      style={({ pressed }) => [s.pill, { backgroundColor: bg }, dim && { opacity: 0.4 }, pressed && s.pressed]}>
      {busy ? <ActivityIndicator color={fg} /> : <T w="b" size={14} c={fg}>{title}</T>}
    </Pressable>
  );
}
function Ghost({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [s.ghost, pressed && s.pressed]}>
      <T w="b" size={14}>{title}</T>
    </Pressable>
  );
}
function Confirm({ visible, onClose, icon, title, body, cta, onConfirm }: {
  visible: boolean; onClose: () => void; icon: IconName; title: string; body: string[];
  cta: string; onConfirm: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} gap={14}>
      <View style={s.confirmIcon}><Ico name={icon} size={21} /></View>
      <View style={{ gap: 8 }}>
        <T w="b" size={20} style={{ lineHeight: 25 }}>{title}</T>
        {body.map((b) => <T key={b} size={13.5} c={D.sub} style={{ lineHeight: 21 }}>{b}</T>)}
      </View>
      <View style={{ gap: 10, marginTop: 4 }}>
        <Pill title={cta} onPress={() => { onClose(); onConfirm(); }} />
        <Ghost title={tr('Cancel')} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: D.bg },
  grow: { flex: 1, minWidth: 0 },
  group: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 64 },
  line: { borderBottomWidth: 1, borderBottomColor: D.border },
  bubble36: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  linked: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sheetTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  close: { width: 44, height: 44, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center' },
  langRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 16, borderWidth: 1.5, borderColor: 'transparent',
  },
  langRowOn: { backgroundColor: D.card2, borderColor: D.text },
  radioOn: { width: 24, height: 24, borderRadius: 999, backgroundColor: D.accent, alignItems: 'center', justifyContent: 'center' },
  radioOff: { width: 24, height: 24, borderRadius: 999, borderWidth: 2, borderColor: D.muted },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: D.card, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15 },
  pill: { height: 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ghost: { height: 52, borderRadius: 999, borderWidth: 1, borderColor: D.border, alignItems: 'center', justifyContent: 'center' },
  confirmIcon: { width: 52, height: 52, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  secret: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: 16, backgroundColor: D.card2,
    paddingLeft: 16, paddingRight: 6, borderWidth: 1.5, borderColor: 'transparent',
  },
  secretInput: { flex: 1, fontFamily: inter.sb, fontSize: 16, color: D.text, writingDirection: 'ltr' },
  eye: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  forgot: { flexDirection: 'row', alignItems: 'center', minHeight: 44, flexWrap: 'wrap' },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 },
  display28: { fontFamily: serif, fontSize: 28, lineHeight: 32, color: D.text },
  display26: { fontFamily: serif, fontSize: 26, lineHeight: 30, color: D.text },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2, paddingVertical: 2 },
  bars: { flex: 1, flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: D.border },
  card: { backgroundColor: D.card, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cta: {
    alignSelf: 'flex-start', marginStart: 48, height: 44, borderRadius: 999, backgroundColor: D.card2,
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 18, paddingEnd: 14,
  },
  clearPill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 28,
    borderRadius: 999, backgroundColor: 'rgba(74,222,128,.12)', paddingHorizontal: 12, marginTop: 2,
  },
  list: { backgroundColor: D.card, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  goes: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stays: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  staysDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: D.sub, marginTop: 7, marginHorizontal: 3 },
  confirm: {
    height: 54, borderRadius: 16, backgroundColor: D.card2, borderWidth: 1.5, borderColor: D.border,
    paddingHorizontal: 16, fontFamily: inter.b, fontSize: 16, letterSpacing: 2.2, color: D.text, writingDirection: 'ltr',
  },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, paddingHorizontal: 20, paddingBottom: 30, gap: 10, backgroundColor: D.bg },
  doneWrap: { justifyContent: 'space-between' },
  doneMid: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 34 },
  doneMark: { width: 72, height: 72, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center' },
  doneText: { lineHeight: 22, textAlign: 'center', maxWidth: 318 },
  pressed: { opacity: 0.75 },
});
