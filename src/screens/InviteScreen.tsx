import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif } from '../theme';

// 18a — the referral screen. Dark, like the barber side, because it is the one
// customer screen that is a pitch rather than a tool.
//
// The reward rail is real (0038): redeem_referral() issues the friend a 20 DH
// coupon, and reward_referrer() credits the wallet once they have actually been.
// What the design never draws is where the friend TYPES the code — there is no
// field on sign-up and no deep link yet, so today the entry point is the
// "Have a code?" row on My Coupons.

const REWARD_DH = 20;
const LINK = (code: string) => `https://sterncut.ma/r/${code}`;

type Invite = {
  id: string; status: string; created_at: string; rewarded_at: string | null;
  invitee: { full_name: string | null } | null;
};

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
function shortName(name: string | null | undefined) {
  if (!name) return 'A friend';
  const [first, last] = name.split(' ');
  return last ? `${first} ${last[0]}.` : first;
}

export default function InviteScreen({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      supabase.rpc('my_referral_code'),
      supabase.from('referrals')
        .select('id, status, created_at, rewarded_at, invitee:profiles!invitee_id(full_name)')
        .order('created_at', { ascending: false }),
    ]);
    if (c.error) Alert.alert('Could not load your code', c.error.message);
    else setCode(c.data as string);
    setInvites((r.data ?? []) as unknown as Invite[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function copy() {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function share() {
    if (!code) return;
    await Share.share({
      message: `Get ${REWARD_DH} DH off your first cut on Sterncut with my code ${code} — ${LINK(code)}`,
    });
  }

  const joined = invites.length;
  const earned = invites.filter((i) => i.status === 'rewarded').length * REWARD_DH;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable onPress={onBack} hitSlop={8}
            style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={16} color="#fff" />
          </Pressable>
          <Text style={s.headerTitle}>INVITE FRIENDS</Text>
          <View style={s.puckGhost} />
        </View>

        <View style={s.pitch}>
          <Text style={s.pitchTitle}>Give {REWARD_DH} DH,{'\n'}get {REWARD_DH} DH.</Text>
          <Text style={s.pitchSub}>
            Your friend gets {REWARD_DH} DH off their first cut. You get {REWARD_DH} DH in your
            wallet once they've been.
          </Text>
        </View>

        <View style={s.codeCard}>
          <Text style={s.codeLabel}>YOUR CODE</Text>
          <View style={s.codeRow}>
            <Text style={s.code}>{code ?? '…'}</Text>
            <Pressable onPress={copy} disabled={!code}
              style={({ pressed }) => [s.copyBtn, pressed && s.pressed]}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={colors.text} />
              <Text style={s.copyText}>{copied ? 'COPIED' : 'COPY'}</Text>
            </Pressable>
          </View>
          <View style={s.shareRow}>
            <Pressable onPress={share} disabled={!code}
              style={({ pressed }) => [s.shareBtn, pressed && s.pressed]}>
              <Ionicons name="send" size={14} color="#fff" />
              <Text style={s.shareText}>SHARE LINK</Text>
            </Pressable>
            <Pressable onPress={share} disabled={!code} accessibilityLabel="Share to a chat"
              style={({ pressed }) => [s.shareIcon, pressed && s.pressed]}>
              <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.text} />
            </Pressable>
            <Pressable onPress={copy} disabled={!code} accessibilityLabel="Copy the invite link"
              style={({ pressed }) => [s.shareIcon, pressed && s.pressed]}>
              <Ionicons name="qr-code-outline" size={17} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={s.stats}>
          <View style={s.stat}>
            <Text style={s.statValue}>{joined}</Text>
            <Text style={s.statLabel}>Friends joined</Text>
          </View>
          <View style={s.stat}>
            <Text style={[s.statValue, s.statGreen]}>{earned} DH</Text>
            <Text style={s.statLabel}>Earned so far</Text>
          </View>
        </View>

        <Text style={s.section}>YOUR INVITES</Text>
        {invites.length === 0 && (
          <Text style={s.emptyText}>
            No invites yet. Share your code and it shows up here the moment someone signs up.
          </Text>
        )}
        <View style={s.inviteList}>
          {invites.map((i) => {
            const name = shortName(i.invitee?.full_name);
            const done = i.status === 'rewarded';
            return (
              <View key={i.id} style={s.invite}>
                <View style={s.inviteAvatar}>
                  <Text style={s.inviteAvatarText}>{initials(name)}</Text>
                </View>
                <View style={s.grow}>
                  <Text style={s.inviteName}>{name}</Text>
                  <Text style={s.inviteMeta}>
                    {done
                      ? `First cut ${new Date(i.rewarded_at!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                      : "Signed up · hasn't booked yet"}
                  </Text>
                </View>
                {done
                  ? <Text style={s.inviteReward}>+{REWARD_DH} DH</Text>
                  : <View style={s.pendingChip}><Text style={s.pendingText}>PENDING</Text></View>}
              </View>
            );
          })}
        </View>

        <Text style={s.footNote}>
          Rewards land in your wallet after your friend's first completed visit.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { paddingTop: 66, paddingHorizontal: 24, paddingBottom: 40, gap: 16 },
  grow: { flex: 1 },
  pressed: { opacity: 0.75 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  puckGhost: { width: 40 },
  headerTitle: {
    flex: 1, textAlign: 'center', fontSize: 11, letterSpacing: 1.98,
    fontWeight: '700', color: 'rgba(255,255,255,0.55)',
  },

  pitch: { marginTop: 8 },
  pitchTitle: {
    fontFamily: serif, fontSize: 34, lineHeight: 37, letterSpacing: 0.68,
    color: '#fff', textTransform: 'uppercase',
  },
  pitchSub: {
    fontSize: 14, lineHeight: 21, color: 'rgba(255,255,255,0.6)', marginTop: 10, maxWidth: 300,
  },

  codeCard: { backgroundColor: '#fff', borderRadius: 22, padding: 18, gap: 14 },
  codeLabel: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: colors.textSecondary },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code: { flex: 1, fontFamily: serif, fontSize: 30, lineHeight: 32, color: colors.text, letterSpacing: 1.8 },
  copyBtn: {
    height: 40, borderRadius: radius.pill, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16,
  },
  copyText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.72, color: colors.text },
  shareRow: {
    flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: '#EFECE4', paddingTop: 14,
  },
  shareBtn: {
    flex: 1, height: 46, borderRadius: radius.pill, backgroundColor: colors.ink,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  shareText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.72, color: '#fff' },
  shareIcon: {
    width: 46, height: 46, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },

  stats: { flexDirection: 'row', gap: 12 },
  stat: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: 16, gap: 4,
  },
  statValue: { fontSize: 24, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  statGreen: { color: '#4ADE80' },
  statLabel: { fontSize: font.tiny, color: 'rgba(255,255,255,0.55)' },

  section: {
    fontSize: 10, letterSpacing: 1.8, fontWeight: '700',
    color: 'rgba(255,255,255,0.45)', marginTop: 2,
  },
  emptyText: { fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.45)' },
  inviteList: { gap: 9 },
  invite: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 18,
    paddingVertical: 13, paddingHorizontal: 15,
  },
  inviteAvatar: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  inviteAvatarText: { fontSize: font.tiny, fontWeight: '700', color: '#fff' },
  inviteName: { fontSize: font.small, fontWeight: '700', color: '#fff' },
  inviteMeta: { fontSize: font.tiny, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  inviteReward: {
    fontSize: font.small, fontWeight: '800', color: '#4ADE80', fontVariant: ['tabular-nums'],
  },
  pendingChip: {
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9,
  },
  pendingText: {
    fontSize: 10, letterSpacing: 1, fontWeight: '700', color: 'rgba(255,255,255,0.6)',
  },
  footNote: {
    fontSize: font.tiny, lineHeight: 17, color: 'rgba(255,255,255,0.5)',
    textAlign: 'center', marginTop: 2,
  },
});
