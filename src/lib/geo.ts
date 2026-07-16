import { Alert, Linking, Platform } from 'react-native';

export type LatLng = { latitude: number; longitude: number };

// Tangier city center — map fallback until the user grants location
export const TANGIER: LatLng = { latitude: 35.7595, longitude: -5.834 };
export const DEFAULT_REGION = { ...TANGIER, latitudeDelta: 0.08, longitudeDelta: 0.08 };

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ponytail: flat 12 min/km walking pace; a routing API when straight-line ETA bites
export const walkMin = (km: number) => Math.max(1, Math.round(km * 12));

export function openDirections(lat: number, lng: number, name: string) {
  const url = Platform.OS === 'ios'
    ? `maps:?daddr=${lat},${lng}`
    : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`;
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`)
      .catch(() => Alert.alert('Directions', 'Could not open a maps app.')));
}
