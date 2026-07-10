import { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { supabase } from './src/lib/supabase';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import type { Barber, Profile } from './src/types';

// ponytail: conditional render instead of a navigation lib — the flow is a strict
// gate (auth → onboarding-if-incomplete → home). Add React Navigation when Phase 2
// brings real multi-screen browsing.
export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<{ profile: Profile; barber: Barber | null } | null>(null);

  const loadUser = useCallback(async (s: Session) => {
    const { data: profile } = await supabase
      .from('profiles').select('id, full_name, role').eq('id', s.user.id).single();
    if (!profile) return setUser(null);
    let barber: Barber | null = null;
    if (profile.role === 'barber') {
      const { data } = await supabase.from('barbers').select('*').eq('id', s.user.id).single();
      barber = data;
    }
    setUser({ profile, barber }); // set once, so we never flash Home before the barber row arrives
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadUser(data.session);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (!s) setUser(null);
      else if (event === 'SIGNED_IN') loadUser(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadUser]);

  let content;
  if (booting || (session && !user)) {
    content = <ActivityIndicator />;
  } else if (!session || !user) {
    content = <AuthScreen />;
  } else if (user.barber && !user.barber.id_document_path) {
    content = <OnboardingScreen barber={user.barber} onDone={() => loadUser(session)} />;
  } else {
    content = <HomeScreen profile={user.profile} barber={user.barber} />;
  }

  return (
    <View style={styles.container}>
      {content}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', justifyContent: 'center' },
});
