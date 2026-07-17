import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import QuickAddSheet, { QuickPick } from '../components/QuickAddSheet';
import TabBar, { TabItem } from '../components/TabBar';
import { colors } from '../theme';
import type { Barber, Profile } from '../types';
import AvailabilityScreen from './AvailabilityScreen';
import BookingsScreen from './BookingsScreen';
import ChatsScreen from './ChatsScreen';
import ClientsScreen from './ClientsScreen';
import DayScheduleScreen from './DayScheduleScreen';
import DiscoverScreen from './DiscoverScreen';
import ExploreScreen from './ExploreScreen';
import MyBookingsScreen from './MyBookingsScreen';
import ProfileScreen from './ProfileScreen';
import WalletScreen from './WalletScreen';

const CUSTOMER_TABS: TabItem[] = [
  { key: 'home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { key: 'explore', label: 'Explore', icon: 'compass', iconOutline: 'compass-outline' },
  { key: 'bookings', label: 'Bookings', icon: 'calendar', iconOutline: 'calendar-outline' },
  { key: 'chats', label: 'Chat', icon: 'chatbubble-ellipses', iconOutline: 'chatbubble-ellipses-outline' },
  { key: 'profile', label: 'Profile', icon: 'person', iconOutline: 'person-outline' },
];

// services / portfolio / profile moved behind the dashboard avatar → Profile menu
const BARBER_TABS: TabItem[] = [
  { key: 'home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar', iconOutline: 'calendar-outline' },
  { key: 'clients', label: 'Clients', icon: 'people', iconOutline: 'people-outline' },
  { key: 'wallet', label: 'Wallet', icon: 'wallet', iconOutline: 'wallet-outline' },
];

type DayOpts = { autoAddNow?: boolean; prefillName?: string; prefillServiceId?: string; preferMin?: number };

// ponytail: state-based tabs, no navigation lib — Android hardware-back doesn't walk
// back through inner screens yet; adopt React Navigation when that bites real users.
export default function HomeScreen({ profile, barber, phone, onProfileChanged }: {
  profile: Profile; barber: Barber | null; phone: string | null; onProfileChanged: () => void;
}) {
  const tabs = barber ? BARBER_TABS : CUSTOMER_TABS;
  const [tab, setTab] = useState(tabs[0].key);
  const [chromeHidden, setChromeHidden] = useState(false);
  // the day timeline (walk-ins) is a full-screen overlay: FAB quick-add + dashboard open it
  const [dayOpen, setDayOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [dayOpts, setDayOpts] = useState<DayOpts>({});

  function openDay(open: boolean, opts: DayOpts = {}) {
    setDayOpts(opts);
    setDayOpen(open);
    setChromeHidden(open);
  }

  function onQuickPick({ mode, name, serviceId, preferMin }: QuickPick) {
    setQuickOpen(false);
    openDay(true, { autoAddNow: mode === 'now', prefillName: name, prefillServiceId: serviceId, preferMin });
  }

  let content;
  if (barber && dayOpen) {
    content = <DayScheduleScreen barberId={barber.id} onBack={() => openDay(false)}
      autoAddNow={dayOpts.autoAddNow} prefillName={dayOpts.prefillName}
      prefillServiceId={dayOpts.prefillServiceId} preferMin={dayOpts.preferMin} />;
  } else if (barber) {
    if (tab === 'home') {
      content = <BookingsScreen barber={barber} profile={profile} phone={phone}
        onProfileChanged={onProfileChanged} onChromeHidden={setChromeHidden}
        goSchedule={() => openDay(true)} />;
    }
    else if (tab === 'calendar') content = <AvailabilityScreen barberId={barber.id} />;
    else if (tab === 'clients') content = <ClientsScreen barberId={barber.id} onChromeHidden={setChromeHidden} />;
    else content = <WalletScreen onBack={() => setTab('home')} />;
  } else {
    if (tab === 'home') content = <DiscoverScreen onChromeHidden={setChromeHidden} />;
    else if (tab === 'explore') content = <ExploreScreen onChromeHidden={setChromeHidden} />;
    else if (tab === 'bookings') content = <MyBookingsScreen customerId={profile.id} onChromeHidden={setChromeHidden} />;
    else if (tab === 'chats') content = <ChatsScreen customerId={profile.id} onChromeHidden={setChromeHidden} />;
    else content = <ProfileScreen profile={profile} barber={null} phone={phone} onProfileChanged={onProfileChanged} onChromeHidden={setChromeHidden} />;
  }

  return (
    <View style={s.screen}>
      {content}
      {barber && (
        <QuickAddSheet visible={quickOpen} barberId={barber.id}
          onClose={() => setQuickOpen(false)} onPick={onQuickPick} />
      )}
      {!chromeHidden && (
        <TabBar items={tabs} active={tab}
          center={barber ? { label: 'Quick add', onPress: () => setQuickOpen(true) } : undefined}
          onChange={(k) => { setChromeHidden(false); setTab(k); }} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});
