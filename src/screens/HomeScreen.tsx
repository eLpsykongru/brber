import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import TabBar, { TabItem } from '../components/TabBar';
import { colors } from '../theme';
import type { Barber, Profile } from '../types';
import AvailabilityScreen from './AvailabilityScreen';
import BookingsScreen from './BookingsScreen';
import ChatsScreen from './ChatsScreen';
import DiscoverScreen from './DiscoverScreen';
import MyBookingsScreen from './MyBookingsScreen';
import PortfolioScreen from './PortfolioScreen';
import ProfileScreen from './ProfileScreen';
import ServicesScreen from './ServicesScreen';

const CUSTOMER_TABS: TabItem[] = [
  { key: 'home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { key: 'bookings', label: 'Bookings', icon: 'calendar', iconOutline: 'calendar-outline' },
  { key: 'chats', label: 'Chat', icon: 'chatbubble-ellipses', iconOutline: 'chatbubble-ellipses-outline' },
  { key: 'profile', label: 'Profile', icon: 'person', iconOutline: 'person-outline' },
];

const BARBER_TABS: TabItem[] = [
  { key: 'bookings', label: 'Bookings', icon: 'calendar', iconOutline: 'calendar-outline' },
  { key: 'services', label: 'Services', icon: 'cut', iconOutline: 'cut-outline' },
  { key: 'hours', label: 'Hours', icon: 'time', iconOutline: 'time-outline' },
  { key: 'work', label: 'Work', icon: 'images', iconOutline: 'images-outline' },
  { key: 'profile', label: 'Profile', icon: 'person', iconOutline: 'person-outline' },
];

// ponytail: state-based tabs, no navigation lib — Android hardware-back doesn't walk
// back through inner screens yet; adopt React Navigation when that bites real users.
export default function HomeScreen({ profile, barber, phone, onProfileChanged }: {
  profile: Profile; barber: Barber | null; phone: string | null; onProfileChanged: () => void;
}) {
  const tabs = barber ? BARBER_TABS : CUSTOMER_TABS;
  const [tab, setTab] = useState(tabs[0].key);
  const [chromeHidden, setChromeHidden] = useState(false);

  let content;
  if (barber) {
    if (tab === 'bookings') content = <BookingsScreen barberId={barber.id} onChromeHidden={setChromeHidden} />;
    else if (tab === 'services') content = <ServicesScreen barberId={barber.id} />;
    else if (tab === 'hours') content = <AvailabilityScreen barberId={barber.id} />;
    else if (tab === 'work') content = <PortfolioScreen barberId={barber.id} />;
    else content = <ProfileScreen profile={profile} barber={barber} phone={phone} onProfileChanged={onProfileChanged} />;
  } else {
    if (tab === 'home') content = <DiscoverScreen onChromeHidden={setChromeHidden} />;
    else if (tab === 'bookings') content = <MyBookingsScreen customerId={profile.id} onChromeHidden={setChromeHidden} />;
    else if (tab === 'chats') content = <ChatsScreen customerId={profile.id} onChromeHidden={setChromeHidden} />;
    else content = <ProfileScreen profile={profile} barber={null} phone={phone} onProfileChanged={onProfileChanged} />;
  }

  return (
    <View style={s.screen}>
      {content}
      {!chromeHidden && (
        <TabBar items={tabs} active={tab}
          onChange={(k) => { setChromeHidden(false); setTab(k); }} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});
