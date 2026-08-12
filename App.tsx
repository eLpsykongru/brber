import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import {
  PlayfairDisplay_700Bold, PlayfairDisplay_800ExtraBold, useFonts,
} from '@expo-google-fonts/playfair-display';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, StyleSheet, View } from 'react-native';
import { Suspended } from './src/components/Failures';
import { SUPPORT_PHONE } from './src/screens/SupportScreens';

/** 38h — what my_account_state() (0056) answers. */
type Account = { suspended: boolean; reason: string | null; since: string | null };
import { onBannerAction, registerPush } from './src/lib/push';
import { useAndroidBack } from './src/lib/back';
import { supabase } from './src/lib/supabase';
import { SessionExpiredSheet, SetPasswordScreen } from './src/screens/AccountScreens';
import AuthScreen, { AuthView } from './src/screens/AuthScreen';
import { biometricLockOn, LockScreen } from './src/screens/LinkedAccountsScreen';
import SlotOfferSheet from './src/components/SlotOfferSheet';
import HomeScreen from './src/screens/HomeScreen';
import IntroScreen from './src/screens/IntroScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { colors } from './src/theme';
import type { Barber, Profile } from './src/types';

const INTRO_SEEN_KEY = 'intro_seen';

// ponytail: conditional render instead of a navigation lib — the flow is a strict
// gate (intro → auth → onboarding-if-incomplete → home). Add React Navigation when
// Phase 2 brings real multi-screen browsing.
export default function App() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_700Bold, PlayfairDisplay_800ExtraBold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold,
  });
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<Account | null>(null);   // 38h
  const [user, setUser] = useState<{ profile: Profile; barber: Barber | null } | null>(null);
  const [intro, setIntro] = useState<{ show: boolean; next: AuthView }>({ show: false, next: 'welcome' });
  // 24a remembers who just got signed out; 23c is the emailed reset landing
  const [expired, setExpired] = useState<{ name: string | null; email: string | null } | null>(null);
  const [recovering, setRecovering] = useState(false);
  const userRef = useRef<{ name: string | null; email: string | null } | null>(null);
  userRef.current = user ? { name: user.profile.full_name, email: user.profile.email ?? null } : null;
  // 24b — re-locks whenever the app comes back from the background
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    biometricLockOn().then((on) => setLocked(on));
    const sub = AppState.addEventListener('change', async (st) => {
      if (st === 'background' && await biometricLockOn()) setLocked(true);
    });
    return () => sub.remove();
  }, []);

  const loadUser = useCallback(async (s: Session) => {
    const { data: row } = await supabase
      .from('profiles')
      .select('id, full_name, phone, avatar_url, role, language, dob, usual_service')
      .eq('id', s.user.id).single();
    if (!row) return setUser(null);
    // email lives on the auth user, not the profile row — 19b shows it locked
    const profile: Profile = { ...row, email: s.user.email ?? null };
    let barber: Barber | null = null;
    if (profile.role === 'barber') {
      const { data } = await supabase.from('barbers').select('*').eq('id', s.user.id).single();
      barber = data;
    }
    setUser({ profile, barber }); // set once, so we never flash Home before the barber row arrives
    // 38h — a paused account is a fact about booking, not about signing in, so it
    // rides alongside the profile rather than gating the session.
    if (!barber) {
      const { data: state } = await supabase.rpc('my_account_state');
      setAccount(state as Account);
    }
  }, []);

  useEffect(() => {
    Promise.all([supabase.auth.getSession(), AsyncStorage.getItem(INTRO_SEEN_KEY)])
      .then(async ([{ data }, seen]) => {
        setSession(data.session);
        if (data.session) await loadUser(data.session);
        else if (!seen) setIntro({ show: true, next: 'welcome' });
        setBooting(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // 24a — a session that dies while the app is open is a different event
      // from signing out on purpose, and gets the blocking sheet instead of
      // dumping the user back on the welcome screen
      if (event === 'SIGNED_OUT' && userRef.current) setExpired(userRef.current);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);   // 23c
      setSession(s);
      if (!s) setUser(null);
      else if (event === 'SIGNED_IN') { setExpired(null); setRecovering(false); loadUser(s); }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadUser]);

  // Barber 4a / customer 13b — every signed-in device gets a token, and
  // Accept/Decline on a barber's banner runs the same RPCs the app does.
  // No-ops in Expo Go, which dropped remote push.
  const userId = user?.profile.id;
  useEffect(() => {
    if (!userId) return;
    registerPush(userId).catch(() => {});
    const sub = onBannerAction(() => { if (session) loadUser(session); });
    return () => sub.remove();
  }, [userId, session, loadUser]);

  function finishIntro(next: AuthView) {
    AsyncStorage.setItem(INTRO_SEEN_KEY, '1');
    setIntro({ show: false, next });
  }

  // every other root view is terminal (auth, onboarding, suspended, lock):
  // back there should leave the app, which is what returning null does.
  useAndroidBack(recovering ? () => setRecovering(false) : null);

  let content;
  if (locked && user) {
    content = <LockScreen onUnlocked={() => setLocked(false)}
      onPassword={() => { setLocked(false); supabase.auth.signOut(); }} />;
  } else if (recovering) {
    content = <SetPasswordScreen mode="reset" email={session?.user.email ?? null}
      onBack={() => setRecovering(false)} onDone={() => setRecovering(false)} />;
  } else if (booting || !fontsLoaded || (session && !user)) {
    content = <ActivityIndicator color={colors.text} />;
  } else if (!session || !user) {
    content = intro.show
      ? <IntroScreen onDone={finishIntro} />
      : <AuthScreen initialView={intro.next} />;
  } else if (user.barber && !user.barber.id_document_path) {
    content = <OnboardingScreen barber={user.barber} onDone={() => loadUser(session)} />;
  } else if (account?.suspended) {
    // 38h — booking is paused, everything he already has still stands, and the
    // reason is printed because 0056 refuses to record a suspension without one.
    content = <Suspended reason={account.reason ?? 'Contact support to find out why.'}
      onAppeal={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)} />;
  } else {
    content = <HomeScreen profile={user.profile} barber={user.barber}
      phone={user.profile.phone} onProfileChanged={() => loadUser(session!)} />;
  }

  return (
    <View style={styles.container}>
      {content}
      {/* 8e — a slot Youssef just lost, offered to you. It rides above whatever
          screen you're on, because the countdown doesn't care where you are. */}
      {user && !user.barber && (
        <SlotOfferSheet myId={user.profile.id} onTaken={() => loadUser(session!)} />
      )}
      <SessionExpiredSheet visible={!!expired && !session} name={expired?.name ?? null}
        email={expired?.email ?? null}
        onSignIn={() => setExpired(null)} onNotYou={() => setExpired(null)} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, justifyContent: 'center' },
});
