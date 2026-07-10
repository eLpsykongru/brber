import { Button, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Barber, Profile } from '../types';

const STATUS_MSG: Record<string, string> = {
  pending: 'Your shop is under review — we’ll notify you once approved.',
  approved: 'You’re live! Customers can find your shop.',
  rejected: 'Your application was not approved. Contact support for details.',
};

export default function HomeScreen({ profile, barber }: { profile: Profile; barber: Barber | null }) {
  return (
    <View style={styles.form}>
      <Text style={styles.title}>Hi {profile.full_name ?? 'there'}</Text>
      <Text style={styles.subtitle}>({profile.role})</Text>
      {barber && <Text style={styles.status}>{STATUS_MSG[barber.status] ?? barber.status}</Text>}
      <Button title="Sign out" onPress={() => supabase.auth.signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center' },
  subtitle: { textAlign: 'center', color: '#666' },
  status: { textAlign: 'center', padding: 12, backgroundColor: '#f2f2f2', borderRadius: 8 },
});
