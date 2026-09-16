import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Display, PillButton } from '../components/ui';
import type { QueueLink } from '../lib/queueLink';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, TOP_INSET } from '../theme';

// QL-16 — a shop's queue link opened the app (option b) and nobody is signed in.
// The link is held through the sign-in, and the check-in opens on this shop after
// it. Carrying on in the browser is always here: the page is the mechanism, the
// app a shortcut.
//
// Two things the design draws are not. Nothing is held for anyone before a ticket
// is taken (README §5), so the card quotes the number instead of "Youssef is
// holding this for you". And the app signs in with email, Google or Apple — not a
// texted code — so there is no phone field to fill in from a last cut.

type Chair = { code: string; name: string; next_no: number; state: string; services: { wait_min: number | null }[] };
type Queue = { found: boolean; name: string; open: boolean; chosen: string | null; chairs: Chair[] };

const waitOf = (c: Chair) => Math.min(...c.services.map((v) => v.wait_min ?? Infinity));

export default function QueueLinkScreen({ link, onSignIn, onBrowser, onDismiss }: {
  link: QueueLink; onSignIn: () => void; onBrowser: () => void; onDismiss: () => void;
}) {
  const [q, setQ] = useState<Queue | null>(null);
  useEffect(() => {
    // 0110's page read, callable with no session
    supabase.rpc('public_queue', { p_shop: link.shop, p_barber: link.barber ?? null })
      .then(({ data }) => setQ((data as Queue | null)?.found ? (data as Queue) : null));
  }, [link.url]);

  const taking = (q?.open ? q.chairs : []).filter((c) => c.state === 'taking' && waitOf(c) < Infinity);
  // his own link quotes his chair; the poster quotes whoever is free soonest, as QL-08 does
  const chair = taking.find((c) => c.code === q?.chosen)
    ?? [...taking].sort((a, b) => waitOf(a) - waitOf(b))[0] ?? null;

  return (
    <View style={s.screen}>
      <View style={s.top}>
        <View style={s.logo}><Ionicons name="cut-outline" size={14} color="#fff" /></View>
        <Text style={s.wordmark}>STERNCUT</Text>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
      </View>

      {q && (
        <View style={s.card}>
          {chair && <Text style={s.no}>Nº {String(chair.next_no).padStart(2, '0')}</Text>}
          {chair && <View style={s.vr} />}
          <View style={s.grow}>
            <Text style={s.cardTitle}>{chair ? `${chair.name.split(' ')[0]} · ${q.name}` : q.name}</Text>
            <Text style={s.cardSub}>{chair ? `Wait now ~${waitOf(chair)} min` : 'No walk-ins right now'}</Text>
          </View>
        </View>
      )}

      <View>
        <Display size={25}>Take a ticket</Display>
        <Text style={s.lede}>Sign in and the check-in opens on this shop.</Text>
      </View>

      <PillButton title="SIGN IN" onPress={onSignIn} />
      <View style={s.or}>
        <View style={s.rule} /><Text style={s.orText}>OR</Text><View style={s.rule} />
      </View>
      <PillButton title="CARRY ON IN THE BROWSER" variant="secondary" onPress={onBrowser} />

      <Text style={s.fine}>
        Signing in is only so the ticket, the wallet and the receipts sit in one place. The line
        doesn't care either way.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1, backgroundColor: colors.surface, paddingTop: TOP_INSET,
    paddingHorizontal: 24, paddingBottom: 30, gap: 16,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: {
    width: 26, height: 26, borderRadius: 7, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  wordmark: { flex: 1, fontFamily: serif, fontSize: 14, letterSpacing: 2, color: colors.text },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.ink,
    borderRadius: radius.lg, paddingVertical: 15, paddingHorizontal: 17,
  },
  no: { fontFamily: serif, fontSize: 24, color: '#fff' },
  vr: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.14)' },
  grow: { flex: 1 },
  cardTitle: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
  cardSub: { fontSize: 11.5, color: 'rgba(255,255,255,0.6)', marginTop: 3 },
  lede: { fontSize: font.small, lineHeight: 20, color: colors.textSecondary, marginTop: 9 },
  or: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rule: { flex: 1, height: 1, backgroundColor: 'rgba(0,0,0,0.1)' },
  orText: { fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: colors.textTertiary },
  fine: {
    marginTop: 'auto', textAlign: 'center', fontSize: 11.5, lineHeight: 17, color: colors.textTertiary,
  },
});
