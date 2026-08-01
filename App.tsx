import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import {
  PlayfairDisplay_700Bold, PlayfairDisplay_800ExtraBold, useFonts,
} from '@expo-google-fonts/playfair-display';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { supabase } from './src/lib/supabase';
import AuthScreen, { AuthView } from './src/screens/AuthScreen';
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
  const [user, setUser] = useState<{ profile: Profile; barber: Barber | null } | null>(null);
  const [intro, setIntro] = useState<{ show: boolean; next: AuthView }>({ show: false, next: 'welcome' });

  const loadUser = useCallback(async (s: Session) => {
    const { data: profile } = await supabase
      .from('profiles').select('id, full_name, phone, avatar_url, role').eq('id', s.user.id).single();
    if (!profile) return setUser(null);
    let barber: Barber | null = null;
    if (profile.role === 'barber') {
      const { data } = await supabase.from('barbers').select('*').eq('id', s.user.id).single();
      barber = data;
    }
    setUser({ profile, barber }); // set once, so we never flash Home before the barber row arrives
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
      setSession(s);
      if (!s) setUser(null);
      else if (event === 'SIGNED_IN') loadUser(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadUser]);

  function finishIntro(next: AuthView) {
    AsyncStorage.setItem(INTRO_SEEN_KEY, '1');
    setIntro({ show: false, next });
  }

  let content;
  if (booting || !fontsLoaded || (session && !user)) {
    content = <ActivityIndicator color={colors.text} />;
  } else if (!session || !user) {
    content = intro.show
      ? <IntroScreen onDone={finishIntro} />
      : <AuthScreen initialView={intro.next} />;
  } else if (user.barber && !user.barber.id_document_path) {
    content = <OnboardingScreen barber={user.barber} onDone={() => loadUser(session)} />;
  } else {
    content = <HomeScreen profile={user.profile} barber={user.barber}
      phone={user.profile.phone} onProfileChanged={() => loadUser(session!)} />;
  }

  return (
    <View style={styles.container}>
      {content}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, justifyContent: 'center' },
});
