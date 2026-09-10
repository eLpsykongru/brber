import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import SalonDetailScreen, { SalonCard } from './SalonDetailScreen';

/**
 * A salon or a barber opened from an id alone.
 *
 * `SalonDetailScreen` wants a fully-hydrated `SalonCard`; a saved row carries
 * only a uuid. This is the one place that turns one into the other, and a
 * barber's page lives inside his shop's, so a barber id resolves to a salon
 * first and then opens straight onto him.
 *
 * Lifted out of ProfileScreen when Saved became a tab: two doors now open the
 * same page, and a second copy of this fetch is a second thing to keep right.
 */
export default function PreviewPage({ salonId, barberId, onBack, onBooked, onChromeHidden }: {
  salonId?: string; barberId?: string; onBack: () => void; onBooked?: () => void;
  onChromeHidden?: (hidden: boolean) => void;
}) {
  const [salon, setSalon] = useState<SalonCard | null>(null);
  // a saved barber carries only his own id; his page lives inside his shop's
  const [shopId, setShopId] = useState<string | null>(salonId ?? null);

  useEffect(() => {
    if (shopId || !barberId) return;
    supabase.from('barbers').select('salon_id').eq('id', barberId).single()
      .then(({ data, error }) => {
        if (error || !data?.salon_id) { Alert.alert('Could not open', error?.message ?? 'No shop'); onBack(); return; }
        setShopId(data.salon_id);
      });
  }, [barberId, shopId]);

  useEffect(() => {
    if (!shopId) return;
    supabase.from('salons')
      .select('id, name, address, lat, lng, bio, website, barbers!salon_id(id, bio, status, salon_status, specialty, years_experience, profiles!barbers_id_fkey(full_name, avatar_url, phone), reviews!reviews_barber_id_fkey(rating), services(id, name, price_cents, duration_min, is_active, category))')
      .eq('id', shopId).single()
      .then(({ data, error }) => {
        if (error) { Alert.alert('Could not load preview', error.message); onBack(); return; }
        const card = data as unknown as SalonCard;
        setSalon({ ...card, barbers: card.barbers.filter((b) => b.status === 'approved' && b.salon_status === 'approved') });
      });
  }, [shopId]);

  if (!salon) return <View style={s.center}><ActivityIndicator /></View>;
  return <SalonDetailScreen salon={salon} onBack={onBack} onChromeHidden={onChromeHidden}
    initialBarberId={barberId} onBooked={onBooked} />;
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
