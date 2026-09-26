import * as FS from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { dh } from './billing';
import { lang, loc, tr, trn } from './i18n';

// EXP-02 / EXP-03 — an A4 PDF from the receipt renderer (expo-print), in the app's
// language (Arabic mirrors, Western digits). Each shows only what its screen shows.

export type ExportPeriod = 'thisWeek' | 'lastWeek' | 'thisMonth';

/** [from, to) — weeks start on Monday, as the shop's statements do. */
export function periodRange(p: ExportPeriod): { from: Date; to: Date } {
  const monday = new Date(); monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  if (p === 'thisWeek') return { from: monday, to: plus(monday, 7) };
  if (p === 'lastWeek') return { from: plus(monday, -7), to: monday };
  const now = new Date();
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}

const ROWS_PER_PAGE = 22;
export const pagesFor = (rows: number) => Math.max(1, Math.ceil(rows / ROWS_PER_PAGE));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** amounts, phones and Latin names stay LTR inside an Arabic page */
const iso = (s: string) => `<bdi>${esc(s)}</bdi>`;
export const shortDate = (d: Date) => d.toLocaleDateString(loc('en-GB'), { day: 'numeric', month: 'short' });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** the last day covered, for a label: `to` is exclusive */
const lastDay = (to: Date) => { const x = new Date(to); x.setDate(x.getDate() - 1); return x; };
export const rangeParts = (from: Date, to: Date) => ({ from: shortDate(from), to: shortDate(lastDay(to)) });
export const fileRange = (from: Date, to: Date) => `${ymd(from)}-${ymd(lastDay(to))}`;

function shell(pages: string[]) {
  const now = new Date();
  const generated = tr('Generated {date}, {time}', {
    date: now.toLocaleDateString(loc('en-GB'), { day: 'numeric', month: 'long', year: 'numeric' }),
    time: now.toTimeString().slice(0, 5),
  });
  const ar = lang() === 'ar';
  return `<html lang="${lang()}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: ${ar ? "'IBM Plex Sans Arabic', " : ''}-apple-system, Roboto, 'Helvetica Neue', sans-serif; color: #111; margin: 0; }
  .page { page-break-after: always; min-height: 250mm; position: relative; }
  .page:last-child { page-break-after: auto; }
  .top { display: flex; justify-content: space-between; font-size: 10px; color: #8A8A85; }
  .brand { font-family: 'Playfair Display', Georgia, serif; font-weight: 800; letter-spacing: ${ar ? 0 : '.16em'}; font-size: 13px; color: #111; }
  h1 { font-size: 22px; margin: 18px 0 4px; }
  .sub { font-size: 12px; color: #5C5C58; }
  .label { font-size: 9.5px; font-weight: 700; letter-spacing: ${ar ? 0 : '.14em'}; color: #8A8A85; margin-bottom: 4px; }
  .tiles { display: flex; gap: 12px; margin: 18px 0; }
  .tile { flex: 1; border: 1px solid #E5E2DB; border-radius: 10px; padding: 12px; }
  .big { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { text-align: start; font-size: 9.5px; letter-spacing: ${ar ? 0 : '.12em'}; color: #8A8A85; padding: 6px 4px; border-bottom: 1px solid #111; }
  td { padding: 7px 4px; border-bottom: 1px solid #E5E2DB; font-variant-numeric: tabular-nums; }
  .num { text-align: end; }
  .foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 9.5px; color: #8A8A85; border-top: 1px solid #E5E2DB; padding-top: 6px; }
  .total td { font-weight: 800; border-bottom: 0; }
</style></head><body>
${pages.map((p, i) => `<div class="page">
  <div class="top"><span class="brand">STERNCUT</span><span>${esc(generated)}</span></div>
  ${p}
  <div class="foot"><span>${esc(tr('A record of activity in Sterncut. Not a tax invoice. sterncut.ma'))}</span>
    <span>${esc(tr('Page {n} of {m}', { n: i + 1, m: pages.length }))}</span></div>
</div>`).join('\n')}
</body></html>`;
}

// ---- EXP-02 ------------------------------------------------------------------
export type WalletRow = { created_at: string; name: string; phone: string | null; amount_cents: number };

export function walletActivityHtml({ shop, from, to, rows, mask }: {
  shop: string; from: Date; to: Date; rows: WalletRow[]; mask: (p: string | null) => string;
}) {
  const total = rows.reduce((a, r) => a + r.amount_cents, 0);
  const head = `<h1>${esc(tr('Wallet activity'))}</h1>
  <div class="sub">${esc(tr('Agent · {shop} · {from} – {to}', { shop: '⁨' + shop + '⁩', from: shortDate(from), to: shortDate(lastDay(to)) }))}</div>
  <div class="tiles">
    <div class="tile"><div class="label">${esc(tr('TOP-UPS'))}</div><div class="big">${rows.length}</div></div>
    <div class="tile"><div class="label">${esc(tr('CASH COLLECTED'))}</div><div class="big">${iso(dh(total))}</div></div>
  </div>`;
  const table = (chunk: WalletRow[]) => `<table>
    <tr><th>${esc(tr('DATE'))}</th><th>${esc(tr('CUSTOMER'))}</th><th>${esc(tr('PHONE'))}</th><th class="num">${esc(tr('AMOUNT'))}</th></tr>
    ${chunk.map((r) => {
      const d = new Date(r.created_at);
      return `<tr><td>${iso(`${shortDate(d)} · ${d.toTimeString().slice(0, 5)}`)}</td><td>${esc(r.name)}</td>
        <td>${iso(mask(r.phone))}</td><td class="num">${iso(dh(r.amount_cents))}</td></tr>`;
    }).join('')}
  </table>`;
  const pages: string[] = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += ROWS_PER_PAGE) {
    pages.push((i === 0 ? head : '') + table(rows.slice(i, i + ROWS_PER_PAGE)));
  }
  return shell(pages);
}

// ---- EXP-03 ------------------------------------------------------------------
export type ShopReport = {
  shop: string; from: Date; to: Date;
  take: number; bookings: number;
  byBarber: { name: string; cents: number | null }[];
  commission: number; topUps: number; noShows: number;
  settlement: { name: string; cents: number }[];
};

export function shopReportHtml(r: ShopReport) {
  const total = r.settlement.reduce((a, x) => a + x.cents, 0);
  return shell([`<h1>${esc(tr('Shop report'))}</h1>
  <div class="sub">${esc(tr('{shop} · {from} – {to}', { shop: '⁨' + r.shop + '⁩', from: shortDate(r.from), to: shortDate(lastDay(r.to)) }))}</div>
  <div class="tiles">
    <div class="tile"><div class="label">${esc(tr('SHOP TAKE'))}</div><div class="big">${iso(dh(r.take))}</div>
      <div class="sub">${esc(trn(r.bookings, '{n} booking', '{n} bookings'))}</div></div>
  </div>
  <div class="label">${esc(tr('BY BARBER'))}</div>
  <table>${r.byBarber.map((b) => `<tr><td>${esc(b.name)}</td><td class="num">${b.cents == null ? esc(tr('rent')) : iso(dh(b.cents))}</td></tr>`).join('')}</table>
  <div class="tiles">
    <div class="tile"><div class="label">${esc(tr('COMMISSION'))}</div><div class="big">${iso(dh(r.commission))}</div></div>
    <div class="tile"><div class="label">${esc(tr('TOP-UPS'))}</div><div class="big">${iso(dh(r.topUps))}</div></div>
    <div class="tile"><div class="label">${esc(tr('NO-SHOWS'))}</div><div class="big">${r.noShows}</div></div>
  </div>
  ${r.settlement.length ? `<div class="label">${esc(tr('SETTLEMENT · OWED NOW'))}</div>
  <table>${r.settlement.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${iso(dh(x.cents))}</td></tr>`).join('')}
    <tr class="total"><td>${esc(tr('Total to collect'))}</td><td class="num">${iso(dh(total))}</td></tr></table>` : ''}`]);
}

/** The phone's own share sheet for a PDF. A build from before expo-sharing
 *  hands the file to the system print sheet instead, which saves or shares it. */
export async function sharePdf(html: string, fileName: string) {
  const { uri } = await Print.printToFileAsync({ html });
  let file = uri;
  try {
    const to = `${FS.cacheDirectory}${fileName}`;
    await FS.deleteAsync(to, { idempotent: true });
    await FS.moveAsync({ from: uri, to });
    file = to;
  } catch { /* the printed file keeps its generated name */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: fileName });
      return;
    }
  } catch { /* no native module in this build */ }
  await Print.printAsync({ uri: file });
}
