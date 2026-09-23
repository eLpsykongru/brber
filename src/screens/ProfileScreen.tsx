import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Eyebrow, Ico, IconName, RadioRow, Screen, Serif, Sheet, SheetHead, T, TAB_INSET, TopBar } from '../components/dark';
import { chooseLanguage, LANGUAGE_ROWS } from '../lib/language';
import { Chip, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { useAndroidBack } from '../lib/back';
import { Pushed } from '../components/motion';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, serif, shadow, sp, TOP_INSET } from '../theme';
import type { Barber, Profile } from '../types';
import { ActivityIndicator } from 'react-native';
import CouponsScreen from './CouponsScreen';
import StandingScreen from './StandingScreen';
import EarningsScreen from './EarningsScreen';
import HelpCenterScreen from './HelpCenterScreen';
import { SetPasswordScreen } from './AccountScreens';
import CustomerNotificationsScreen from './CustomerNotificationsScreen';
import InviteScreen from './InviteScreen';
import LinkedAccountsScreen from './LinkedAccountsScreen';
import SettingsScreen, { EditProfileScreen } from './SettingsScreen';
import BarberSupportScreen, { BarberCaseScreen, PublicReplyScreen } from './BarberSupportScreens';
import ReviewTakedownScreen, { AppealScreen, useRemovedReviews } from './ReviewAppealScreens';
import ReportProblemScreen, {
  CaseRow, SupportCaseScreen, SupportHomeScreen,
} from './SupportScreens';
import MyBookingsScreen from './MyBookingsScreen';
import PortfolioScreen from './PortfolioScreen';
import AvailabilityScreen from './AvailabilityScreen';
import SalonScreen from './SalonScreen';
import SalonDetailScreen, { SalonCard } from './SalonDetailScreen';
import PreviewPage from './PreviewPage';
import BarberProfileEditScreen from './BarberProfileEditScreen';
import BarberReviewsScreen from './BarberReviewsScreen';
import BundleEditorScreen from './BundleEditorScreen';
import CancellationsScreen from './CancellationsScreen';
import WaitingListScreen from './WaitingListScreen';
import ShopTasksScreen from './ShopTasksScreen';
import ApplicationScreen from './ApplicationScreen';
import CashAgentScreen from './CashAgentScreen';
import SettleFloatScreen, { CollectionRoundScreen } from './SettleFloatScreen';
import StatementScreen from './StatementScreen';
import AgentRoundScreen from './AgentRoundScreen';
import AccountScreen from './AccountScreen';
import SubscriptionScreen from './SubscriptionScreen';
import ServicesScreen from './ServicesScreen';
import WalletScreen from './WalletScreen';
import { tr, trn, lang } from '../lib/i18n';
import type { Lang } from '../lib/i18n';

const STATUS_LABEL: Record<string, string> = {
  pending: tr('Under review'), approved: tr('Live'), rejected: tr('Not approved'),
};

type MenuItem = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean };

type ProfileView =
  | 'menu' | 'edit' | 'bookings' | 'wallet' | 'coupons' | 'help' | 'faq' | 'invite' | 'support'
  | 'settings' | 'notifications' | 'password' | 'linked' | 'takedown' | 'appeal' | 'reply'
  | 'preview' | 'services' | 'bundles' | 'work' | 'schedule' | 'salon' | 'earnings'
  | 'cancellations' | 'waitlist' | 'reviews'
  // turn 39 — two things the app already half-had
  | 'standing'
  // turn 9 — where admin actions land in the shop
  | 'tasks' | 'application' | 'float' | 'round' | 'statement' | 'agent'
  // the billing rail — the owner's bill, and every barber's two-sided account
  | 'subscription' | 'account' | 'cashagent';

export default function ProfileScreen({ profile, barber, phone, onProfileChanged, onChromeHidden, onBack, onExplore }: {
  profile: Profile; barber: Barber | null; phone: string | null;
  onProfileChanged: () => void; onChromeHidden?: (hidden: boolean) => void;
  onBack?: () => void;
  // My Bookings is reachable from here as well as from the tab bar, and its
  // rebook buttons need somewhere to go. Without this they rendered and did
  // nothing, because `onRebook?.()` on a missing prop is silent.
  onExplore?: () => void;
}) {
  const [view, setView] = useState<ProfileView>('menu');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url ?? null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // owner (not just any barber in a salon) gets the Salon management row
  const [ownsSalon, setOwnsSalon] = useState(false);
  const [holdsCash, setHoldsCash] = useState(false);
  const [openCase, setOpenCase] = useState<CaseRow | null>(null); // 18b
  // 31 — a review of yours that ops took down, and the appeal on it if any
  const { rows: takedowns, reload: reloadTakedowns } = useRemovedReviews();
  const takedown = takedowns?.[0] ?? null;
  const [replyTo, setReplyTo] = useState<
    { id: string; rating: number; comment: string | null; created_at: string; customer: string } | null>(null);

  // 6b's REPLY TO THE REVIEW IN PUBLIC — the case knows the booking, the booking
  // knows the review
  async function openReplyFromCase(bookingId: string | null) {
    if (!bookingId) return Alert.alert(tr('No review here'), tr('This case is not about a review.'));
    const { data } = await supabase.from('reviews')
      .select('id, rating, comment, created_at, customer:profiles!customer_id(full_name)')
      .eq('booking_id', bookingId).maybeSingle();
    if (!data) return Alert.alert(tr('No review here'), tr('This case is not about a review.'));
    const r = data as unknown as {
      id: string; rating: number; comment: string | null; created_at: string;
      customer: { full_name: string | null } | null;
    };
    setOpenCase(null);
    setReplyTo({ ...r, customer: r.customer?.full_name ?? tr('A client') });
    go('reply');
  }

  useEffect(() => {
    if (!barber?.salon_id) return;
    supabase.from('salons').select('id, owner_id, cash_agent_id')
      .eq('id', barber.salon_id).maybeSingle()
      .then(({ data }) => {
        setOwnsSalon(!!data && data.owner_id === barber.id);
        // 0127: a barber the owner appointed holds the drawer, so Settle up is his too
        setHoldsCash(!!data && (data.cash_agent_id ?? data.owner_id) === barber.id);
      });
  }, [barber?.salon_id, barber?.id]);

  const initials = (profile.full_name ?? '?')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  // where each view came from, so hardware back retraces the way in rather
  // than always dumping you at the menu. `faq` is reached from `help` and
  // `appeal` from `takedown`; both would lose a step without this.
  const trail = useRef<ProfileView[]>([]);

  // PreviewPage has two callers now - the owner previewing his own shop, and a
  // tap on a saved barber/salon. `from` is where BACK goes, since they differ.
  const [preview, setPreview] = useState<{ salonId?: string; barberId?: string; from: ProfileView } | null>(null);
  // a notification names one booking; MyBookings opens straight onto it
  const [openBookingId, setOpenBookingId] = useState<string | undefined>();

  function go(next: ProfileView) {
    setView((cur) => {
      if (next !== cur) {
        if (next === 'menu') trail.current = [];
        else trail.current.push(cur);
      }
      return next;
    });
    onChromeHidden?.(next !== 'menu');
  }

  // BACK is a pop, not a move. Routing it through `go` recorded the screen you
  // were leaving, so settings → account → back landed on settings with account
  // back on the trail, and the next back went forward again.
  function back() {
    const prev = trail.current.pop() ?? 'menu';
    setView(prev);
    onChromeHidden?.(prev !== 'menu');
  }

  // deepest first: an open case sits on top of whatever view opened it, and at
  // the menu we hand back to whoever pushed us (the barber dashboard) or let
  // Android have it (the customer's Profile is a tab root).
  useAndroidBack(
    openCase ? () => setOpenCase(null)
      : view !== 'menu' ? back
        : onBack,
  );

  // BPR-07 — the barber's own page the way a customer opens it, booking dead
  function openOwnPage(from: ProfileView) {
    if (!barber?.salon_id) return;
    setPreview({ salonId: barber.salon_id, barberId: barber.id, from });
    go('preview');
  }

  function soon(feature: string) {
    Alert.alert(feature, tr('Coming soon — see BACKLOG.md'));
  }

  async function changeAvatar() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.6, allowsEditing: true, aspect: [1, 1],
    });
    if (res.canceled) return;
    setAvatarBusy(true);
    try {
      const path = `${profile.id}/avatar-${Date.now()}.jpg`;
      const buf = await fetch(res.assets[0].uri).then((r) => r.arrayBuffer());
      const up = await supabase.storage.from('avatars').upload(path, buf, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id);
      if (error) throw error;
      setAvatarUrl(url);
      onProfileChanged();
    } catch (e: any) {
      Alert.alert(tr('Could not update photo'), e.message ?? String(e));
    } finally {
      setAvatarBusy(false);
    }
  }

  function signOut() {
    Alert.alert(tr('Logout'), tr('Are you sure you want to log out?'), [
      { text: tr('Cancel'), style: 'cancel' },
      { text: tr('Yes, Logout'), style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  // Every pushed view in one place, so the menu can stay mounted behind it
  // and trail as you swipe back. Returns null when the menu itself is what
  // should show.
  function pushedView() {
    // 19b is the customer's profile — preferred barber, usual service. Barbers
    // keep the original editor: theirs carries bio, specialty and the shop.
    if (view === 'edit') {
      return barber
        ? <BarberProfileEditScreen profile={profile} barber={barber} avatarUrl={avatarUrl}
            avatarBusy={avatarBusy} onAvatar={changeAvatar} onBack={back}
            onSaved={() => { onProfileChanged(); back(); }}
            onPreview={() => openOwnPage('edit')} onReviews={() => go('reviews')}
            onCancellations={() => go('cancellations')} onHelp={() => go('help')} />
        : <EditProfileScreen profile={profile} onBack={back}
            onDone={() => { onProfileChanged(); go('menu'); }} />;
    }
    if (view === 'settings') {
      return <SettingsScreen profile={profile} onBack={back}
        onProfileChanged={onProfileChanged} go={go} />;
    }
    if (view === 'notifications') {
      return <CustomerNotificationsScreen userId={profile.id} onBack={back}
        onOpenBooking={(id) => { setOpenBookingId(id); go('bookings'); }}
        onOpenWallet={() => go('wallet')}
        onRate={(id) => { setOpenBookingId(id); go('bookings'); }} />;
    }
    if (view === 'linked') {
      return <LinkedAccountsScreen onBack={back} onSetPassword={() => go('password')} />;
    }
    if (view === 'password') {
      return <SetPasswordScreen mode="set" email={profile.email} onBack={back}
        onDone={() => { Alert.alert(tr('Password saved'), tr('You can now sign in with your email.')); go('settings'); }} />;
    }
    if (view === 'bookings') {
      return <MyBookingsScreen customerId={profile.id} onChromeHidden={onChromeHidden}
        openBookingId={openBookingId}
        onBack={() => { setOpenBookingId(undefined); go('menu'); }} onRebook={onExplore} />;
    }
    if (view === 'wallet') return <WalletScreen customerId={profile.id} onBack={back} />;
    if (view === 'coupons') return <CouponsScreen onBack={back} />;
    if (view === 'standing') return <StandingScreen onBack={back} onDispute={() => go('support')} />;
    // 30a / 5a — Help Center is now the support console; the FAQ article list it
    // sits on is the old screen, one tap deeper.
    if (view === 'help') {
      return barber
        ? <BarberSupportScreen onBack={back} onOpenCase={setOpenCase} />
        : <SupportHomeScreen onBack={back} onOpenCase={setOpenCase}
            onNewCase={() => go('support')} />;
    }
    if (view === 'faq') {
      return <HelpCenterScreen onBack={back}
        onContact={barber ? undefined : () => go('support')} />;
    }
    if (view === 'reply' && replyTo) {
      return <PublicReplyScreen review={replyTo} onClose={() => go('menu')}
        onPosted={() => { setReplyTo(null); Alert.alert(tr('Posted'), tr('Your reply is on your page.')); go('menu'); }} />;
    }
    if (openCase) {
      return barber
        ? <BarberCaseScreen caseRow={openCase} myId={profile.id}
            onBack={() => { setOpenCase(null); go('help'); }}
            onReplyPublicly={() => openReplyFromCase(openCase.booking_id)} />
        : <SupportCaseScreen caseRow={openCase} myId={profile.id}
            onBack={() => { setOpenCase(null); go('help'); }} />;
    }
    // 31a/c/d — one screen, three states; 31b is the composer behind APPEAL THIS
    if ((view === 'takedown' || view === 'appeal') && takedown) {
      return view === 'appeal'
        ? <AppealScreen item={takedown} onBack={back}
            onSent={() => { reloadTakedowns(); go('takedown'); }} />
        : <ReviewTakedownScreen item={takedown} onBack={back}
            onAppeal={() => go('appeal')} />;
    }
    if (view === 'invite') return <InviteScreen onBack={back} />;
    if (view === 'support') {
      return <ReportProblemScreen onBack={back} onOpenCase={setOpenCase} />;
    }
    if (view === 'preview' && (preview || barber?.salon_id)) {
      const t: { salonId?: string; barberId?: string; from: ProfileView } =
        preview ?? { salonId: barber!.salon_id ?? undefined, from: 'menu' };
      return <PreviewPage salonId={t.salonId} barberId={t.barberId}
        preview={!!barber && t.barberId === barber.id}
        onBack={() => { setPreview(null); back(); }}
        onBooked={() => { setPreview(null); go('bookings'); }}
        onChromeHidden={onChromeHidden} />;
    }
    if (view === 'salon' && barber) return <SalonScreen barberId={barber.id} onBack={back}
      onManageServices={() => go('services')} onEditSalon={() => go('edit')} />;
    if (view === 'schedule' && barber) return <AvailabilityScreen barberId={barber.id} onBack={back} />;
    if (view === 'earnings' && barber) return <EarningsScreen barberId={barber.id} onBack={back} />;
    if (view === 'services' && barber) return <ServicesScreen barberId={barber.id} onBack={back} />;
    // turn 7 — bundles are made of services, so the editor lives next to them
    if (view === 'bundles' && barber) return <BundleEditorScreen onBack={back} />;
    // 8c — the pattern behind the reasons, only visible across bookings
    if (view === 'cancellations' && barber) return <CancellationsScreen onBack={back} />;
    // G2 — BRV-08, the list of their own reviews a barber never had
    if (view === 'reviews' && barber) return <BarberReviewsScreen barberId={barber.id} onBack={back} />;
    // 8h/8i — where turn 36's asks land
    if (view === 'waitlist' && barber) {
      return <WaitingListScreen barberId={barber.id} onBack={back} />;
    }
    if (view === 'work' && barber) return <PortfolioScreen barberId={barber.id} onBack={back} />;
    // 9a/9b — ops writes an obligation, this is where the shop reads it
    if (view === 'tasks' && barber) {
      return <ShopTasksScreen onBack={back} onChat={() => go('support')} />;
    }
    // 9c/9d — the applying shop's own status screen, behind admin 1f
    if (view === 'application' && barber) {
      return <ApplicationScreen onBack={back}
        onGo={(w) => go(w === 'hours' ? 'schedule' : w === 'wallet' ? 'wallet' : 'preview')} />;
    }
    // 9e/9f — the float, hand to hand
    if (view === 'float' && barber) return <SettleFloatScreen onBack={back} />;
    if (view === 'round') return <CollectionRoundScreen onBack={back} />;
    // AGT-01 - the settlement round. Not the float pickup above it: a shop rather
    // than a person, a number that points either way, and a partial that is normal.
    if (view === 'agent') return <AgentRoundScreen onBack={back} />;
    // OSH-16/17 — the week that closed, and which way it points
    if (view === 'statement' && barber) return <StatementScreen onBack={back} />;
    // OSB-01…05 — what the shop pays, and how. The owner's only.
    if (view === 'subscription' && barber && ownsSalon) return <SubscriptionScreen onBack={back} />;
    // OBR-07/08 — who holds the shop's cash, and what it takes to change him
    if (view === 'cashagent' && barber && ownsSalon) return <CashAgentScreen onBack={back} />;
    // BAC-01…08 — what he holds of ours, what we hold of his, and the one number
    if (view === 'account' && barber) {
      return <AccountScreen onBack={back} onStatement={ownsSalon ? () => go('statement') : undefined} />;
    }
    return null;
  }

  // TODO(backlog): Payment Methods / My Coupons / My Wallet — no payment rail yet
  const items: MenuItem[] = [
    { icon: 'person-outline', label: tr('Your profile'), onPress: () => go('edit') },
    ...(barber ? [
      { icon: 'calendar-outline', label: tr('Schedule settings'), onPress: () => go('schedule') },
      { icon: 'cut-outline', label: tr('My Services'), onPress: () => go('services') },
      { icon: 'cube-outline', label: tr('My Bundles'), onPress: () => go('bundles') },
      { icon: 'hourglass-outline', label: tr('Waiting list'), onPress: () => go('waitlist') },
      { icon: 'close-circle-outline', label: tr('Cancellations'), onPress: () => go('cancellations') },
      { icon: 'images-outline', label: tr('My Work'), onPress: () => go('work') },
      // turn 9 — ops was writing into a void; these are the three places it lands
      { icon: 'checkbox-outline', label: tr('To do'), onPress: () => go('tasks') },
      { icon: 'storefront-outline', label: tr('Your shop'), onPress: () => go('application') },
      { icon: 'cash-outline', label: tr('Settle up'), onPress: () => go('float') },
      { icon: 'receipt-outline', label: tr('Weekly statement'), onPress: () => go('statement') },
    ] as MenuItem[] : []),
    // 9f is the collector's phone, not the shop's
    ...(profile.role === 'admin' || profile.role === 'agent' ? [
      { icon: 'car-outline', label: tr('Your round'), onPress: () => go('agent') },
    ] as MenuItem[] : []),
    ...(profile.role === 'admin' ? [
      { icon: 'cash-outline', label: tr('Float pickup (BCF-04)'), onPress: () => go('round') },
    ] as MenuItem[] : []),
    ...(barber?.salon_id ? [
      { icon: 'eye-outline', label: tr('Preview my page'), onPress: () => go('preview') },
    ] as MenuItem[] : []),
    ...(ownsSalon ? [
      { icon: 'storefront-outline', label: tr('Salon management'), onPress: () => go('salon') },
    ] as MenuItem[] : []),
    ...(barber ? [] : [
      { icon: 'card-outline', label: tr('Payment Methods'), onPress: () => soon(tr('Payment Methods')) },
      { icon: 'calendar-outline', label: tr('My Bookings'), onPress: () => go('bookings') },
      // Saved is a tab now (EXPL-24). One door, or the two rot apart.
      { icon: 'shield-checkmark-outline', label: tr('Your standing'), onPress: () => go('standing') },
      { icon: 'ticket-outline', label: tr('My Coupons'), onPress: () => go('coupons') },
      { icon: 'wallet-outline', label: tr('My Wallet'), onPress: () => go('wallet') },
      { icon: 'gift-outline', label: tr('Invite friends'), onPress: () => go('invite') },
    ] as MenuItem[]),
    { icon: 'settings-outline', label: tr('Settings'),
      onPress: () => barber ? soon(tr('Settings')) : go('settings') },
    { icon: 'help-circle-outline', label: tr('Help & support'), onPress: () => go('help') },
    ...(barber ? [] : [
      { icon: 'flag-outline', label: tr('Report a problem'), onPress: () => go('support') },
    ] as MenuItem[]),
    // 31a — only there when there is something to read
    ...(!barber && takedown ? [{
      icon: 'star-half-outline' as const,
      label: takedown.appeal?.upheld ? tr('Your review is back') : tr('A review was taken down'),
      onPress: () => go('takedown'),
    }] as MenuItem[] : []),
    { icon: 'log-out-outline', label: tr('Logout'), onPress: signOut, danger: true },
  ];

  const menu = barber ? (
    <BarberProfile profile={profile} barber={barber} avatarUrl={avatarUrl}
      avatarBusy={avatarBusy} initials={initials} ownsSalon={ownsSalon} holdsCash={holdsCash}
      onAvatar={changeAvatar} onSignOut={signOut} go={go} onBack={onBack}
      onPreview={() => openOwnPage('menu')} />
  ) : (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <ScreenHeader title={tr('Profile')} onBack={onBack} />

      <View style={s.avatarWrap}>
        <Pressable onPress={changeAvatar} disabled={avatarBusy} accessibilityLabel={tr('Change profile photo')}
          style={({ pressed }) => pressed && s.pressed}>
          {avatarUrl
            ? <Image source={{ uri: avatarUrl }} style={s.avatar} />
            : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarText}>{initials}</Text></View>}
          <View style={s.editBadge}>
            <Ionicons name={avatarBusy ? 'hourglass-outline' : 'pencil'} size={14} color={colors.onAccent} />
          </View>
        </Pressable>
        <Text style={s.name}>{profile.full_name ?? tr('Your name')}</Text>
        {!!phone && <Text style={s.phone}>{phone}</Text>}
      </View>

      <View style={s.menu}>
        {items.map((it) => (
          <Pressable key={it.label} onPress={it.onPress}
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            accessibilityRole="button" accessibilityLabel={it.label}>
            <View style={[s.rowIcon, it.danger && s.rowIconDanger]}>
              <Ionicons name={it.icon} size={20} color={it.danger ? colors.accent : colors.text} />
            </View>
            <Text style={[s.rowLabel, it.danger && s.rowLabelDanger]}>{it.label}</Text>
            {!it.danger && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );

  const pushed = pushedView();
  if (!pushed) return menu;
  // one Pushed for all of them: `go` keeps the trail, so back is uniform
  return (
    <Pushed onBack={back} behind={menu}>
      {pushed}
    </Pushed>
  );
}

// 1q — the barber's profile. Same rows, dark canvas, with the numbers that
// tell him whether his page is actually working.
function BarberProfile({
  profile, barber, avatarUrl, avatarBusy, initials, ownsSalon, holdsCash, onAvatar, onSignOut, go, onBack, onPreview,
}: {
  profile: Profile; barber: Barber; avatarUrl: string | null; avatarBusy: boolean;
  initials: string; ownsSalon: boolean; holdsCash: boolean;
  onAvatar: () => void; onSignOut: () => void; go: (v: ProfileView) => void;
  onBack?: () => void; onPreview: () => void;
}) {
  const [stats, setStats] = useState<{
    salon: string | null; rating: number | null; reviews: number;
    clients: number | null; services: number; photos: number;
  }>({ salon: null, rating: null, reviews: 0, clients: null, services: 0, photos: 0 });

  useEffect(() => {
    (async () => {
      const [salon, rev, clients, svc, photos] = await Promise.all([
        barber.salon_id
          ? supabase.from('salons').select('name').eq('id', barber.salon_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('reviews').select('rating').eq('barber_id', barber.id),
        supabase.rpc('barber_customer_count', { p_barber: barber.id }),
        supabase.from('services').select('id', { count: 'exact', head: true })
          .eq('barber_id', barber.id).eq('is_active', true),
        listPortfolio(barber.id),
      ]);
      const ratings = (rev.data ?? []).map((r: any) => r.rating as number);
      setStats({
        salon: (salon.data as any)?.name ?? null,
        rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
        reviews: ratings.length,
        clients: typeof clients.data === 'number' ? clients.data : null,
        services: svc.count ?? 0,
        photos: photos.length,
      });
    })();
  }, [barber.id, barber.salon_id]);

  const live = barber.status === 'approved';
  const [langOpen, setLangOpen] = useState(false);

  // the barber's 20b: his Settings row is still a placeholder, so the language
  // sits in the menu itself. Same rule as the customer's — the phone's pick wins.
  async function pickLanguage(next: Lang) {
    setLangOpen(false);
    if (next === lang()) return;
    await supabase.from('profiles').update({ language: next }).eq('id', profile.id);
    await chooseLanguage(next);
  }

  const rows: { icon: IconName; label: string; value?: string; onPress: () => void }[] = [
    { icon: 'user', label: tr('Your profile'), onPress: () => go('edit') },
    { icon: 'star', label: tr('Your reviews'), value: String(stats.reviews), onPress: () => go('reviews') },
    { icon: 'calendar', label: tr('Schedule settings'), onPress: () => go('schedule') },
    { icon: 'scissors', label: tr('My services'), value: String(stats.services), onPress: () => go('services') },
    { icon: 'image', label: tr('My work'), value: trn(stats.photos, '{n} photo', '{n} photos'), onPress: () => go('work') },
    ...(ownsSalon ? [{ icon: 'edit-2' as IconName, label: tr('Salon management'), onPress: () => go('salon') }] : []),
    // BAC-01: every barber in a shop has an account with Sterncut, owner or not
    ...(barber.salon_id ? [{ icon: 'repeat' as IconName, label: tr('You & Sterncut'), onPress: () => go('account') }] : []),
    // the owner's money rows. "Weekly statement" and "Settle up" lived only in the
    // customer-side list, which a barber never sees — so the agent's four-digit
    // code on the statement had no way in.
    // the drawer is the cash agent's, owner or not
    ...(holdsCash && !ownsSalon ? [{ icon: 'dollar-sign' as IconName, label: tr('Settle up'), onPress: () => go('float') }] : []),
    ...(ownsSalon ? [
      { icon: 'file-text' as IconName, label: tr('Weekly statement'), onPress: () => go('statement') },
      { icon: 'dollar-sign' as IconName, label: tr('Settle up'), onPress: () => go('float') },
      { icon: 'credit-card' as IconName, label: tr('Subscription'), onPress: () => go('subscription') },
      { icon: 'key' as IconName, label: tr('Who holds the cash'), onPress: () => go('cashagent') },
    ] : []),
    { icon: 'trending-up', label: tr('Earnings'), onPress: () => go('earnings') },
    { icon: 'help-circle', label: tr('Help Center'), onPress: () => go('help') },
    { icon: 'globe', label: tr('Language'), value: LANGUAGE_ROWS.find((l) => l.key === lang())?.native, onPress: () => setLangOpen(true) },
  ];

  return (
    <Screen gap={15} bottom={TAB_INSET}>
      {/* The dashboard hides the tab bar when it opens this, so a bare centred
          title left the barber with no way out at all. TopBar draws the same
          title and adds the back puck when there is somewhere to go back to. */}
      <TopBar title={tr('Profile')} onBack={onBack} />

      <View style={d.headRow}>
        <Pressable onPress={onAvatar} disabled={avatarBusy} accessibilityRole="button"
          accessibilityLabel={tr('Change profile photo')} style={({ pressed }) => [d.avatarWrap, pressed && s.pressed]}>
          {avatarUrl
            ? <Image source={{ uri: avatarUrl }} style={d.avatar} />
            : <View style={d.avatar}>
                <Text style={d.avatarText}>{initials}</Text>
              </View>}
          <View style={d.editBadge}>
            <Ico name={avatarBusy ? 'clock' : 'edit-2'} size={11} color="#fff" />
          </View>
        </Pressable>
        <View style={s.grow}>
          <T w="b" size={17}>{profile.full_name ?? tr('Your name')}</T>
          <T size={12} c={D.sub} style={{ marginTop: 3 }}>
            {[barber.specialty ?? tr('Barber'), stats.salon].filter(Boolean).join(' · ')}
          </T>
          <Pressable onPress={() => go('reviews')} hitSlop={6} accessibilityRole="button"
            accessibilityLabel={tr('Your reviews')} style={({ pressed }) => [d.ratingRow, pressed && s.pressed]}>
            <T w="b" size={12}>{stats.rating != null ? `${stats.rating.toFixed(1)} ★` : tr('No reviews yet')}</T>
            <T size={12} c={D.sub}>
              {trn(stats.reviews, '{n} review{x2}', '{n} reviews{x2}', { x2: stats.clients != null ? tr(' · {clients} clients', { clients: stats.clients }) : '' })}
            </T>
          </Pressable>
        </View>
      </View>

      <View style={d.liveCard}>
        <View style={[d.liveIcon, !live && { backgroundColor: D.amberSoft16 }]}>
          <Ico name={live ? 'check-circle' : 'clock'} size={16} color={live ? D.green : D.amber} />
        </View>
        <View style={s.grow}>
          <T w="b" size={13}>{live ? tr('Page is live') : STATUS_LABEL[barber.status] ?? barber.status}</T>
          <T size={11} c={D.sub} style={{ marginTop: 2 }}>
            {live ? tr('Customers can find and book you') : tr('We’ll email you when it’s approved')}
          </T>
        </View>
        {barber.salon_id && (
          <Pressable onPress={onPreview} hitSlop={8} accessibilityRole="button"
            style={({ pressed }) => pressed && s.pressed}>
            <T w="sb" size={12} c={D.accent}>{tr('Preview')}</T>
          </Pressable>
        )}
      </View>

      <View style={d.menu}>
        {rows.map((r, i) => (
          <Pressable key={r.label} onPress={r.onPress} accessibilityRole="button" accessibilityLabel={r.label}
            style={({ pressed }) => [d.row, i < rows.length - 1 && d.rowLine, pressed && s.pressed]}>
            <View style={d.rowIcon}><Ico name={r.icon} size={15} /></View>
            <T w="sb" size={14} style={s.grow}>{r.label}</T>
            {r.value ? <T size={12} c={D.sub}>{r.value}</T> : null}
            <Ico name="chevron-right" size={14} color={D.muted} />
          </Pressable>
        ))}
        <Pressable onPress={onSignOut} accessibilityRole="button" accessibilityLabel={tr('Logout')}
          style={({ pressed }) => [d.row, d.rowLine, pressed && s.pressed]}>
          <View style={[d.rowIcon, { backgroundColor: D.accentSoft }]}>
            <Ico name="log-out" size={15} color={D.accent} />
          </View>
          <T w="sb" size={14} c={D.accent} style={s.grow}>{tr('Logout')}</T>
        </Pressable>
      </View>

      <Sheet visible={langOpen} onClose={() => setLangOpen(false)}>
        <SheetHead title={tr('Language')} onClose={() => setLangOpen(false)} />
        <View style={{ gap: 8 }}>
          {LANGUAGE_ROWS.map((l) => (
            <RadioRow key={l.key} label={l.native} on={lang() === l.key} onPress={() => pickLanguage(l.key)} />
          ))}
        </View>
        <T size={11} c={D.sub}>{tr('Arabic turns the app right-to-left. Prices stay in DH. The app restarts to switch.')}</T>
      </Sheet>
    </Screen>
  );
}

const d = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap: { width: 76, height: 76 },
  avatar: {
    width: 76, height: 76, borderRadius: 999, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: serif, fontSize: 26, color: '#fff' },
  editBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 26, height: 26, borderRadius: 999,
    backgroundColor: D.accent, borderWidth: 3, borderColor: D.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 6 },

  liveCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 18, padding: 14, paddingHorizontal: 16,
  },
  liveIcon: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  menu: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: D.border },
  rowIcon: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
});

// "how customers see me" — fetches the salon in SalonCard shape and reuses the customer screen

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: TOP_INSET, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: sp(5), gap: sp(4), paddingBottom: TAB_BAR_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },

  avatarWrap: { alignItems: 'center', gap: sp(2) },
  avatar: { width: 96, height: 96, borderRadius: radius.pill },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30, fontWeight: '700', color: colors.accent },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: radius.pill,
    backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.surface,
  },
  name: { fontSize: font.h2, fontWeight: '700', color: colors.text, marginTop: sp(1) },
  phone: { fontSize: font.small, color: colors.textSecondary, marginTop: -sp(1) },

  menu: {
    backgroundColor: colors.bg, borderRadius: radius.xl, paddingHorizontal: sp(4.5),
    paddingVertical: sp(1.5), ...shadow,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3.5), paddingVertical: sp(3.25),
    borderBottomWidth: 1, borderBottomColor: '#EFECE4',
  },
  rowPressed: { opacity: 0.7 },
  rowIcon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: colors.accentSoft },
  rowLabel: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  rowLabelDanger: { color: colors.accent },
});
