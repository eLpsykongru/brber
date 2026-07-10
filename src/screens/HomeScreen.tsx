import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Barber, Profile } from '../types';
import AvailabilityScreen from './AvailabilityScreen';
import BookingsScreen from './BookingsScreen';
import DiscoverScreen from './DiscoverScreen';
import MyBookingsScreen from './MyBookingsScreen';
import ServicesScreen from './ServicesScreen';

const STATUS_MSG: Record<string, string> = {
  pending: 'Your shop is under review — we’ll notify you once approved.',
  approved: 'You’re live! Customers can find your shop.',
  rejected: 'Your application was not approved. Contact support for details.',
};

export default function HomeScreen({ profile, barber }: { profile: Profile; barber: Barber | null }) {
  const [view, setView] = useState<'home' | 'services' | 'availability' | 'bookings'>('home');

  // barber home
  if (barber) {
    const back = () => setView('home');
    if (view === 'services') return <ServicesScreen barberId={barber.id} onBack={back} />;
    if (view === 'availability') return <AvailabilityScreen barberId={barber.id} onBack={back} />;
    if (view === 'bookings') return <BookingsScreen barberId={barber.id} onBack={back} />;
    return (
      <View style={styles.form}>
        <Text style={styles.title}>Hi {profile.full_name ?? 'there'}</Text>
        <Text style={styles.status}>{STATUS_MSG[barber.status] ?? barber.status}</Text>
        <Button title="Upcoming bookings" onPress={() => setView('bookings')} />
        {/* menu + hours can be set up while still under review */}
        <Button title="Manage my services" onPress={() => setView('services')} />
        <Button title="Working hours & days off" onPress={() => setView('availability')} />
        <Button title="Sign out" onPress={() => supabase.auth.signOut()} />
      </View>
    );
  }

  // customer home = discovery
  if (view === 'bookings') {
    return <MyBookingsScreen customerId={profile.id} onBack={() => setView('home')} />;
  }
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Hi {profile.full_name ?? 'there'}</Text>
        <View style={styles.headerBtns}>
          <Button title="My bookings" onPress={() => setView('bookings')} />
          <Button title="Sign out" onPress={() => supabase.auth.signOut()} />
        </View>
      </View>
      <DiscoverScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 48 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 8,
  },
  headerText: { fontSize: 18, fontWeight: 'bold' },
  headerBtns: { flexDirection: 'row', gap: 4 },
  form: { padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center' },
  status: { textAlign: 'center', padding: 12, backgroundColor: '#f2f2f2', borderRadius: 8 },
});
