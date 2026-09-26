import * as Print from 'expo-print';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { ExportPeriod, pagesFor, periodRange, rangeParts, sharePdf } from '../lib/exportPdf';
import { tr, trn } from '../lib/i18n';
import { dark as D, serif } from '../theme';
import { Ico, Sheet, T } from './dark';

// EXP-01 — one sheet, two doors: Wallet › Activity and Owner › Shop report.
// Period → preview → Share PDF → the phone's share sheet. "Pick dates" isn't drawn:
// the app has no date-range picker, and a chip that opens nothing is worse than none.

export type ExportBuild = { html: string; entries: number; fileName: string };

const PERIODS: { key: ExportPeriod; label: string }[] = [
  { key: 'thisWeek', label: tr('This week') },
  { key: 'lastWeek', label: tr('Last week') },
  { key: 'thisMonth', label: tr('This month') },
];

export default function ExportSheet({ visible, onClose, kind, build }: {
  visible: boolean; onClose: () => void; kind: 'wallet' | 'shop';
  /** the PDF for [from, to), and how many rows it holds */
  build: (from: Date, to: Date) => Promise<ExportBuild>;
}) {
  const [period, setPeriod] = useState<ExportPeriod>('thisMonth');
  const [doc, setDoc] = useState<ExportBuild | null>(null);
  const [busy, setBusy] = useState(false);
  const { from, to } = periodRange(period);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setDoc(null);
    build(from, to).then((d) => { if (live) setDoc(d); })
      .catch((e) => Alert.alert(tr('Could not load'), e.message ?? String(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, period]);

  const empty = !!doc && doc.entries === 0;
  async function share() {
    if (!doc || empty) return;
    setBusy(true);
    try { await sharePdf(doc.html, doc.fileName); }
    catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/cancel|didn'?t complete/i.test(msg)) Alert.alert(tr('Could not share'), msg);
    } finally { setBusy(false); }
  }

  return (
    <Sheet visible={visible} onClose={onClose} gap={14}>
      <View style={s.head}>
        <T w="b" size={18} style={s.grow}>{kind === 'wallet' ? tr('Export activity') : tr('Export shop report')}</T>
        <Pressable onPress={onClose} accessibilityLabel={tr('Close')} style={s.close}><Ico name="x" size={16} /></Pressable>
      </View>
      <View style={s.chips}>
        {PERIODS.map((p) => {
          const on = p.key === period;
          return (
            <Pressable key={p.key} onPress={() => setPeriod(p.key)} accessibilityRole="radio"
              accessibilityState={{ selected: on }} style={[s.chip, on && s.chipOn]}>
              <T w={on ? 'b' : 'sb'} size={13.5} c={on ? D.bg : D.text}>{p.label}</T>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={doc && !empty ? () => Print.printAsync({ html: doc.html }).catch(() => {}) : undefined}
        accessibilityRole="button" style={s.preview}>
        {/* the first page, drawn small: brand, title block, lines */}
        <View style={s.thumb}>
          <T style={s.thumbBrand}>STERNCUT</T>
          <View style={s.thumbTitle} />
          {[1, 1, 0.8, 1, 0.7, 1].map((w, i) => <View key={i} style={[s.thumbLine, { width: `${w * 100}%` }]} />)}
        </View>
        <View style={s.grow}>
          <T w="b" size={14}>{kind === 'wallet' ? tr('Wallet activity') : tr('Shop report')}</T>
          {!doc ? <ActivityIndicator color={D.sub} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
            : empty ? <T size={12} c={D.sub} style={{ marginTop: 4 }}>{tr('Nothing in this period')}</T>
              : (
                <>
                  <T size={12} c={D.sub} style={s.meta}>
                    {tr('{from} – {to} · {n} pages', { ...rangeParts(from, to), n: pagesFor(doc.entries) })}
                  </T>
                  <T size={12} c={D.sub} style={s.meta}>
                    {kind === 'wallet'
                      ? tr('{n} top-ups · PDF', { n: doc.entries })
                      : `${trn(doc.entries, '{n} booking', '{n} bookings')} · PDF`}
                  </T>
                  <T w="sb" size={12.5} style={{ marginTop: 8 }}>{tr('See full page')}</T>
                </>
              )}
        </View>
      </Pressable>

      <Pressable onPress={share} disabled={!doc || empty || busy} accessibilityRole="button"
        style={({ pressed }) => [s.cta, (!doc || empty) && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
        {busy ? <ActivityIndicator color="#fff" /> : (
          <>
            <Ico name="share" size={16} color="#fff" />
            <T w="b" size={14}>{tr('Share PDF')}</T>
          </>
        )}
      </Pressable>
    </Sheet>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  close: { width: 44, height: 44, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1, flexBasis: '45%', height: 48, borderRadius: 999, backgroundColor: D.card,
    borderWidth: 1, borderColor: D.border, alignItems: 'center', justifyContent: 'center',
  },
  chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: D.card, borderRadius: 18, padding: 12 },
  thumb: { width: 84, height: 118, borderRadius: 6, backgroundColor: '#F4F2EE', padding: 8, gap: 4 },
  thumbBrand: { fontFamily: serif, fontSize: 6, letterSpacing: 0.6, color: '#111' },
  thumbTitle: { height: 10, width: '60%', backgroundColor: '#111', borderRadius: 2, marginTop: 3 },
  thumbLine: { height: 3, backgroundColor: '#CFCBC4', borderRadius: 1 },
  meta: { marginTop: 4, lineHeight: 18, fontVariant: ['tabular-nums'] },
  cta: { height: 54, borderRadius: 999, backgroundColor: D.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
