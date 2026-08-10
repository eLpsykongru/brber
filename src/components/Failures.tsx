import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Display } from './ui';
import { colors, font, radius, shadow } from '../theme';

// Turn 38 of "Customer App 3.dc.html" — the rest of the failures.
//
// The rule, stated once in the turn note and obeyed by every piece here:
// **every error names what still works and offers the one action that actually
// helps.** A screen whose only button is "Try again" is a screen that has given
// up on the customer's behalf. So none of these dead-ends, and none of them
// blocks a booking that already exists.

const dh = (c: number) => Math.round(c / 100);

// ---------------------------------------------------------------------------
// 38a — Location off · Explore
// ---------------------------------------------------------------------------
// Explore still works; it just can't sort by distance. So the list stays and
// falls back to A–Z, and the banner offers the two ways to fix the sort.
export function NoLocationBar({ onAsk, onPickDistrict }: {
  onAsk: () => void; onPickDistrict?: () => void;
}) {
  return (
    <View style={s.bar}>
      <View style={s.barIcon}>
        <Ionicons name="location-outline" size={16} color={colors.accent} />
      </View>
      <View style={s.grow}>
        <Text style={s.barTitle}>Can't see where you are</Text>
        <Text style={s.barSub}>Location is off, so we can't sort by distance</Text>
        <View style={s.barBtns}>
          <Pressable onPress={onAsk} style={s.barPrimary}>
            <Text style={s.barPrimaryText}>TURN IT ON</Text>
          </Pressable>
          {!!onPickDistrict && (
            <Pressable onPress={onPickDistrict} style={s.barGhost}>
              <Text style={s.barGhostText}>PICK A DISTRICT</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 38b — Camera blocked · type it instead
// ---------------------------------------------------------------------------
// The QR is a convenience, not the mechanism. Six characters under the poster
// do the same job, so a blocked camera costs him nothing but typing.
export function CameraBlockedNote({ onSettings }: { onSettings?: () => void }) {
  return (
    <View style={s.bar}>
      <View style={s.barIcon}>
        <Ionicons name="camera-outline" size={16} color={colors.accent} />
      </View>
      <View style={s.grow}>
        <Text style={s.barTitle}>Camera is blocked</Text>
        <Text style={s.barSub}>You can still join — type the code under the QR</Text>
        {!!onSettings && (
          <Pressable onPress={onSettings} hitSlop={6} style={s.barLinkRow}>
            <Text style={s.barLink}>Let the camera work instead</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 38d — Wallet too low for the deposit
// ---------------------------------------------------------------------------
// **Not a wall.** The deposit is the barber's condition, and one of his options
// is to ask without one — so this offers the booking, not an apology.
export function LowWalletBlock({ balanceCents, floorCents, onRequest, onTopUp }: {
  balanceCents: number; floorCents: number;
  onRequest: () => void; onTopUp?: () => void;
}) {
  const short = Math.max(0, floorCents - balanceCents);
  return (
    <>
      <View style={s.lowCard}>
        <View style={s.lowTop}>
          <View style={s.lowIcon}>
            <Ionicons name="wallet-outline" size={16} color={colors.accent} />
          </View>
          <View style={s.grow}>
            <Text style={s.lowTitle}>Not enough in your wallet</Text>
            <Text style={s.lowSub}>
              You have {dh(balanceCents)} DH · the smallest deposit is {dh(floorCents)}
            </Text>
          </View>
        </View>
        <View style={s.lowBarRow}>
          <Text style={s.lowMeta}>MIN · {dh(floorCents)} DH</Text>
          <View style={s.grow} />
          <Text style={s.lowShort}>{dh(short)} DH short</Text>
        </View>
      </View>

      <Text style={s.waysLabel}>TWO WAYS ROUND IT</Text>
      <Pressable onPress={onRequest} style={s.wayCard}>
        <View style={s.wayIcon}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} />
        </View>
        <View style={s.grow}>
          <Text style={s.wayTitle}>Book it without a deposit</Text>
          <Text style={s.waySub}>Your barber confirms it himself · pay at the shop</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </Pressable>
      {!!onTopUp && (
        <Pressable onPress={onTopUp} style={s.wayCard}>
          <View style={s.wayIconIdle}>
            <Ionicons name="cash-outline" size={16} color={colors.textSecondary} />
          </View>
          <View style={s.grow}>
            <Text style={s.wayTitle}>Top up with cash first</Text>
            <Text style={s.waySub}>Any Sterncut shop can take it</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 38f — Shop pulled · your booking stands
// ---------------------------------------------------------------------------
// The one that matters most: a shop disappearing from search must never look
// like a booking disappearing. Same card, one honest strip added.
export function UnderReviewStrip({ barberName, onCancel, onMessage }: {
  barberName: string; onCancel?: () => void; onMessage?: () => void;
}) {
  const first = barberName.split(' ')[0];
  return (
    <View style={s.reviewCard}>
      <View style={s.reviewChip}>
        <Text style={s.reviewChipText}>SHOP UNDER REVIEW</Text>
      </View>
      <Text style={s.reviewTitle}>This shop is hidden while we check its papers</Text>
      <Text style={s.reviewBody}>
        Your booking still stands and {first} is expecting you. You just won't find
        them in search for now.
      </Text>
      <View style={s.reviewRefund}>
        <Ionicons name="shield-checkmark-outline" size={14} color={colors.success} />
        <Text style={s.reviewRefundText}>
          If they can't open, you get a full refund.
        </Text>
      </View>
      <View style={s.reviewBtns}>
        {!!onCancel && (
          <Pressable onPress={onCancel} style={s.reviewGhost}>
            <Text style={s.reviewGhostText}>CANCEL FREE</Text>
          </Pressable>
        )}
        {!!onMessage && (
          <Pressable onPress={onMessage} style={s.reviewSolid}>
            <Text style={s.reviewSolidText}>MESSAGE {first.toUpperCase()}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 38c / 38e / 38g / 38h — the four full-screen ones
// ---------------------------------------------------------------------------
// All four are the same shape: a headline, what still works, and one real
// action. Rather than four near-identical files they share this frame, because
// what differs between them is copy, not structure.
export function FullStop({ icon, tint, title, body, works, primary, onPrimary, foot, secondary, onSecondary }: {
  icon: keyof typeof Ionicons.glyphMap; tint: string;
  title: string; body: string;
  works: { ok: boolean; text: string }[];
  primary: string; onPrimary: () => void;
  foot?: string;
  secondary?: string; onSecondary?: () => void;
}) {
  return (
    <View style={s.full}>
      <View style={[s.fullCircle, { backgroundColor: `${tint}22` }]}>
        <Ionicons name={icon} size={28} color={tint} />
      </View>
      <Display size={23} style={s.fullTitle}>{title}</Display>
      <Text style={s.fullBody}>{body}</Text>

      {works.length > 0 && (
        <View style={s.worksCard}>
          <Text style={s.worksLabel}>
            {works.every((w) => w.ok) ? 'NOTHING IS LOST' : 'WHAT STILL WORKS'}
          </Text>
          {works.map((w) => (
            <View key={w.text} style={s.worksRow}>
              <View style={[s.worksDot, w.ok && s.worksDotOn]}>
                <Ionicons name={w.ok ? 'checkmark' : 'close'} size={11}
                  color={w.ok ? colors.success : colors.textTertiary} />
              </View>
              <Text style={[s.worksText, !w.ok && s.worksTextOff]}>{w.text}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable onPress={onPrimary} style={s.fullPrimary}>
        <Text style={s.fullPrimaryText}>{primary}</Text>
      </Pressable>
      {!!secondary && (
        <Pressable onPress={onSecondary} style={s.fullSecondary}>
          <Text style={s.fullSecondaryText}>{secondary}</Text>
        </Pressable>
      )}
      {!!foot && <Text style={s.fullFoot}>{foot}</Text>}
    </View>
  );
}

/** 38e — our fault, and it says so. */
export function ServerDown({ since, onRetry }: { since?: string; onRetry: () => void }) {
  return (
    <FullStop icon="cloud-offline-outline" tint={colors.accent}
      title={'Our end,\nnot yours'}
      body="Something's wrong on Sterncut. We already know and we're on it."
      works={[
        { ok: true, text: 'Your bookings are safe — nothing was lost' },
        { ok: true, text: 'Your wallet balance is untouched' },
        { ok: false, text: 'New bookings are paused for now' },
      ]}
      primary="TRY AGAIN" onPrimary={onRetry}
      foot={since
        ? `Started ${since} · booked today? Just turn up — your barber has it on his phone.`
        : 'Booked today? Just turn up — your barber has it on his phone.'} />
  );
}

/** 38g — too old to talk to us. The only screen here whose action leaves the app. */
export function TooOld({ version, minimum, bookings, walletCents, onUpdate }: {
  version: string; minimum: string; bookings: number; walletCents: number;
  onUpdate?: () => void;
}) {
  return (
    <FullStop icon="cloud-download-outline" tint={colors.accent}
      title={'Time for\na new version'}
      body="This one can't talk to Sterncut any more."
      works={[
        { ok: true, text: `Your ${bookings} booking${bookings === 1 ? '' : 's'} ${bookings === 1 ? 'is' : 'are'} still there` },
        { ok: true, text: `Your ${dh(walletCents)} DH wallet is untouched` },
        { ok: true, text: 'You stay signed in' },
      ]}
      primary="UPDATE FROM THE APP STORE"
      onPrimary={onUpdate ?? (() => Linking.openURL('https://apps.apple.com/'))}
      foot={`Version ${version} · needs ${minimum} or newer`} />
  );
}

/** 38h — the one failure that is about him, so it says exactly why. */
export function Suspended({ reason, onAppeal, onSupport }: {
  reason: string; onAppeal: () => void; onSupport?: () => void;
}) {
  return (
    <FullStop icon="pause-circle-outline" tint={colors.accent}
      title={'Booking is\npaused for you'}
      body={reason}
      works={[
        { ok: true, text: 'Bookings you already have still stand' },
        { ok: true, text: 'Your wallet balance is yours' },
        { ok: false, text: 'You can\'t make new bookings' },
      ]}
      primary="ASK US TO LOOK AGAIN" onPrimary={onAppeal}
      secondary={onSupport ? 'Message support' : undefined} onSecondary={onSupport} />
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },

  // 38a / 38b
  bar: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11, backgroundColor: colors.bg,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 14, ...shadow,
  },
  barIcon: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(232,68,46,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  barTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  barSub: { fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  barBtns: { flexDirection: 'row', gap: 8, marginTop: 11 },
  barPrimary: {
    height: 36, borderRadius: radius.pill, backgroundColor: colors.ink,
    justifyContent: 'center', paddingHorizontal: 16,
  },
  barPrimaryText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#fff' },
  barGhost: {
    height: 36, borderRadius: radius.pill, backgroundColor: colors.surface,
    justifyContent: 'center', paddingHorizontal: 16,
  },
  barGhostText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#5c5c58' },
  barLinkRow: { marginTop: 9 },
  barLink: { fontSize: 12, fontWeight: '600', color: colors.accent },

  // 38d
  lowCard: { backgroundColor: colors.bg, borderRadius: 20, padding: 16, gap: 12, ...shadow },
  lowTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  lowIcon: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(232,68,46,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  lowTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  lowSub: { fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  lowBarRow: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: '#EFECE4', paddingTop: 12,
  },
  lowMeta: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, color: colors.textSecondary },
  lowShort: { fontSize: 12, fontWeight: '700', color: colors.accent },
  waysLabel: {
    fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, color: colors.textSecondary,
  },
  wayCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.bg,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 14, ...shadow,
  },
  wayIcon: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(232,68,46,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  wayIconIdle: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  wayTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  waySub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },

  // 38f
  reviewCard: {
    backgroundColor: colors.bg, borderRadius: 20, padding: 16, gap: 11,
    borderWidth: 1, borderColor: '#E5E2DB', ...shadow,
  },
  reviewChip: {
    alignSelf: 'flex-start', backgroundColor: '#F0E7D8', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  reviewChipText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1, color: '#8A6D2F' },
  reviewTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  reviewBody: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  reviewRefund: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: '#EFECE4', paddingTop: 11,
  },
  reviewRefundText: { flex: 1, fontSize: 11.5, color: '#5c5c58' },
  reviewBtns: { flexDirection: 'row', gap: 8 },
  reviewGhost: {
    flex: 1, height: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: '#DDD9CF',
    alignItems: 'center', justifyContent: 'center',
  },
  reviewGhostText: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.5, color: '#5c5c58' },
  reviewSolid: {
    flex: 1, height: 42, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewSolidText: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.5, color: '#fff' },

  // the shared full-screen frame
  full: { flex: 1, alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 20 },
  fullCircle: {
    width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center',
  },
  fullTitle: { textAlign: 'center', lineHeight: 27 },
  fullBody: {
    fontSize: 12.5, lineHeight: 19, color: colors.textSecondary, textAlign: 'center',
    maxWidth: 280, marginTop: -6,
  },
  worksCard: {
    alignSelf: 'stretch', backgroundColor: colors.bg, borderRadius: 20,
    padding: 16, gap: 12, marginTop: 6, ...shadow,
  },
  worksLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: colors.textSecondary },
  worksRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  worksDot: {
    width: 19, height: 19, borderRadius: 10, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  worksDotOn: { backgroundColor: 'rgba(74,222,128,0.18)' },
  worksText: { flex: 1, fontSize: 12.5, color: colors.text },
  worksTextOff: { color: colors.textSecondary },
  fullPrimary: {
    alignSelf: 'stretch', height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  fullPrimaryText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.9, color: '#fff' },
  fullSecondary: { paddingVertical: 4 },
  fullSecondaryText: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },
  fullFoot: {
    fontSize: 11.5, lineHeight: 18, color: colors.textTertiary, textAlign: 'center',
  },
});
