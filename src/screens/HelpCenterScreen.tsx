import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Display } from '../components/ui';
import { colors, font, radius, shadow, TOP_INSET } from '../theme';
import { tr } from '../lib/i18n';

// 16b — search, popular articles, topic list, contact row. 22b is the article
// itself, opened over the top.
//
// ponytail: the articles live in this file, not a CMS. Seven answers do not need
// a table, an editor and a fetch; when someone wants to edit copy without
// shipping a release, that is the moment to move them.

type Article = {
  id: string; title: string; topic: string; body: string;
  icon: keyof typeof Ionicons.glyphMap; hot?: boolean;
};

const ARTICLES: Article[] = [
  {
    id: 'deposits', topic: tr('Wallet, deposits & coupons'), hot: true, icon: 'lock-closed-outline',
    title: tr('How do deposits and refunds work?'),
    body: tr('When your wallet has the balance, you can pay part of a booking up front — at least 40% of the price, up to the whole thing. The rest you pay in cash at the shop.\n\nThe deposit leaves your wallet the moment you book, and it is what holds your slot.\n\nIf the barber cancels, the deposit goes straight back to your wallet. If you cancel, it does not — that asymmetry is the point of a deposit, and it is what makes a barber willing to hold a chair for you.\n\nMoving a booking never costs anything: the deposit carries over to the new time.'),
  },
  {
    id: 'queue', topic: tr('Queue & walk-ins'), hot: true, icon: 'time-outline',
    title: tr('Using the live queue & tickets'),
    body: tr('Once a barber confirms a booking for today, you get a ticket number and a live view of the chair.\n\n"3 ahead" counts the confirmed people before you who have not been served yet. The estimate moves as the barber starts and finishes each cut.\n\nYou always get a notification when you are next, whatever your other notification settings say.'),
  },
  {
    id: 'topup', topic: tr('Wallet, deposits & coupons'), hot: true, icon: 'card-outline',
    title: tr('Topping up your wallet with cash'),
    body: tr('Hand cash to the salon owner and they credit your wallet on the spot — you will see the balance change before you leave the shop.\n\nCard top-ups are not available yet. When they arrive, Add money will do it in the app.\n\nYour balance does not expire, and it can be spent as a deposit at any salon on Sterncut.'),
  },
  {
    id: 'reschedule', topic: tr('Bookings & rescheduling'), icon: 'repeat',
    title: tr('Moving or cancelling a booking'),
    body: tr('Open the booking and tap RESCHEDULE to ask for a new time. Your original slot is held until the barber answers, and your deposit carries over.\n\nIf he cannot do the new time he declines, and your original booking stands untouched.\n\nCancelling frees the slot immediately. You can cancel any time before the booking starts.'),
  },
  {
    id: 'coupons', topic: tr('Wallet, deposits & coupons'), icon: 'ticket-outline',
    title: tr('Using a coupon'),
    body: tr('A coupon is a code you show at the shop — it comes off what you pay at the counter, not off the deposit.\n\nAdd a code with "Have a code?" on My Coupons. Once the shop rings it up it moves to the Used tab with the amount you saved.'),
  },
  {
    id: 'account', topic: tr('Account & sign-in'), icon: 'person-outline',
    title: tr('Changing your phone or email'),
    body: tr('Your name, photo and date of birth are editable in Settings → Your profile.\n\nYour phone is verified by SMS and your email is tied to how you sign in, so neither can be edited in place yet — report a problem and support will move the account for you.'),
  },
  {
    id: 'report', topic: tr('Reviews & reporting'), icon: 'flag-outline',
    title: tr('Reporting a problem with a visit'),
    body: tr('Open the booking, tap the ⋯ menu and choose Report a problem — or use Report a problem in your profile.\n\nPick what went wrong, add a photo or receipt if you have one, and you get a case number. Support answers within 24 hours in the case thread.'),
  },
];

const TOPICS = [
  tr('Bookings & rescheduling'),
  tr('Queue & walk-ins'),
  tr('Wallet, deposits & coupons'),
  tr('Account & sign-in'),
  tr('Reviews & reporting'),
];

export default function HelpCenterScreen({ onBack, onContact }: {
  onBack: () => void; onContact?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<string | null>(null);
  const [article, setArticle] = useState<Article | null>(null);

  const q = query.trim().toLowerCase();
  const matches = q
    ? ARTICLES.filter((a) => a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q))
    : null;
  const inTopic = topic ? ARTICLES.filter((a) => a.topic === topic) : null;
  const list = matches ?? inTopic;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable onPress={topic ? () => setTopic(null) : onBack} hitSlop={8}
            style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel={tr('Go back')}>
            <Ionicons name="arrow-back" size={16} color={colors.text} />
          </Pressable>
          <Display size={18} style={s.headerTitle}>{topic ? tr('Articles') : tr('Help center')}</Display>
          <View style={s.puckGhost} />
        </View>

        <View style={s.search}>
          <Ionicons name="search" size={17} color={colors.textSecondary} />
          <TextInput style={s.searchInput} value={query} onChangeText={setQuery}
            placeholder={tr('Search help articles…')} placeholderTextColor={colors.textSecondary} />
          {!!q && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel={tr('Clear search')}>
              <Ionicons name="close-circle" size={17} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>

        {list ? (
          <>
            <Text style={s.section}>{topic ? topic.toUpperCase() : tr('{count} RESULTS', { count: list.length })}</Text>
            <View style={s.cards}>
              {list.map((a) => <ArticleRow key={a.id} a={a} onPress={() => setArticle(a)} />)}
              {list.length === 0 && (
                <Text style={s.empty}>{tr('Nothing matched. Try a topic below, or contact support.')}</Text>
              )}
            </View>
          </>
        ) : (
          <>
            <Text style={s.section}>{tr('POPULAR RIGHT NOW')}</Text>
            <View style={s.cards}>
              {ARTICLES.filter((a) => a.hot).map((a) => (
                <ArticleRow key={a.id} a={a} onPress={() => setArticle(a)} />
              ))}
            </View>

            <Text style={s.section}>{tr('BROWSE TOPICS')}</Text>
            <View style={s.card}>
              {TOPICS.map((t, i) => (
                <Pressable key={t} onPress={() => setTopic(t)}
                  style={({ pressed }) => [s.row, i < TOPICS.length - 1 && s.rowBorder, pressed && s.pressed]}>
                  <Text style={s.rowLabel}>{t}</Text>
                  <Text style={s.rowCount}>{ARTICLES.filter((a) => a.topic === t).length}</Text>
                  <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          </>
        )}

        <View style={s.contact}>
          <View style={s.contactIcon}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
          </View>
          <View style={s.grow}>
            <Text style={s.contactTitle}>{tr('Still stuck?')}</Text>
            <Text style={s.contactSub}>{tr('Chat with Sterncut support · replies in ~1 h')}</Text>
          </View>
          <Pressable onPress={onContact} disabled={!onContact}
            style={({ pressed }) => [s.contactBtn, pressed && s.pressed]}>
            <Text style={s.contactBtnText}>{tr('CONTACT')}</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* 22b — the article itself */}
      <Modal visible={!!article} animationType="slide" onRequestClose={() => setArticle(null)}>
        <View style={s.screen}>
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={s.header}>
              <Pressable onPress={() => setArticle(null)} hitSlop={8}
                style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel={tr('Close')}>
                <Ionicons name="arrow-back" size={16} color={colors.text} />
              </Pressable>
              <Display size={18} style={s.headerTitle}>{tr('Help')}</Display>
              <View style={s.puckGhost} />
            </View>
            {!!article && (
              <>
                <Text style={s.articleTopic}>{article.topic.toUpperCase()}</Text>
                <Display size={24} style={s.articleTitle}>{article.title}</Display>
                <View style={s.articleCard}>
                  <Text style={s.articleBody}>{article.body}</Text>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function ArticleRow({ a, onPress }: { a: Article; onPress: () => void }) {
  const hot = a.id === 'deposits';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.articleRow, pressed && s.pressed]}>
      <View style={[s.articleIcon, hot && s.articleIconHot]}>
        <Ionicons name={a.icon} size={17} color={hot ? colors.accent : colors.text} />
      </View>
      <Text style={s.articleRowTitle}>{a.title}</Text>
      <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: TOP_INSET, paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  grow: { flex: 1 },
  pressed: { opacity: 0.75 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  puckGhost: { width: 40 },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.72 },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bg,
    borderRadius: radius.pill, height: 50, paddingHorizontal: 18, ...shadow,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },

  section: {
    fontSize: 11, letterSpacing: 1.65, fontWeight: '700', color: colors.textSecondary, marginTop: 2,
  },
  cards: { gap: 10 },
  empty: { fontSize: 12, color: colors.textSecondary },

  articleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.bg,
    borderRadius: 20, paddingVertical: 15, paddingHorizontal: 16, ...shadow,
  },
  articleIcon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  articleIconHot: { backgroundColor: 'rgba(232,68,46,0.10)' },
  articleRowTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },

  card: { backgroundColor: colors.bg, borderRadius: 24, paddingHorizontal: 18, ...shadow },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#EFECE4' },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  rowCount: { fontSize: 12, color: colors.textTertiary },

  contact: {
    flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.ink,
    borderRadius: 22, padding: 18, marginTop: 2,
  },
  contactIcon: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  contactTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  contactSub: { fontSize: font.tiny, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  contactBtn: {
    height: 38, borderRadius: radius.pill, backgroundColor: '#fff',
    justifyContent: 'center', paddingHorizontal: 16,
  },
  contactBtnText: { fontSize: font.tiny, fontWeight: '700', letterSpacing: 0.66, color: colors.text },

  articleTopic: {
    fontSize: 10, letterSpacing: 1.8, fontWeight: '700', color: colors.textTertiary, marginTop: 2,
  },
  articleTitle: { marginTop: -6 },
  articleCard: { backgroundColor: colors.bg, borderRadius: 24, padding: 20, ...shadow },
  articleBody: { fontSize: 14, lineHeight: 23, color: '#5C5C58' },
});
