// BTD-11's message, and what a text costs. Pure, so `npm run check` holds it.
//
// A text in the GSM alphabet is 160 characters a send; one character outside it
// — an em dash, a curly apostrophe, "Nº" — turns the whole text into UCS-2 at 70.
// So the words keep to plain punctuation (the owner's call on the code text,
// 2026-09-15), and the counter says what the carrier will actually charge.

export type ShareChair = { name: string; waiting: number; waitMin: number };

const first = (name: string) => name.split(' ')[0];

/** The line link as it goes out. The wait is in the words, not only the preview card (QL-01). */
export function shareMessage({ shop, url, chair, soonest }: {
  shop: string; url: string; chair?: ShareChair | null; soonest?: ShareChair | null;
}): string {
  const tail = `Take a place in today's line here - no app needed: ${url}`;
  if (chair) return `${first(chair.name)} at ${shop}. ${chair.waiting} waiting, about ${chair.waitMin} min. ${tail}`;
  if (soonest) return `${shop}. ${first(soonest.name)} is free in about ${soonest.waitMin} min. ${tail}`;
  return `${shop}. ${tail}`;
}

const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡'
  + 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';   // each takes two places

/** Characters as the carrier counts them, the per-send limit, and how many sends. */
export function smsLength(text: string): { chars: number; limit: number; sends: number } {
  let units = 0;
  for (const ch of text) {
    if (GSM.includes(ch)) units += 1;
    else if (GSM_EXTENDED.includes(ch)) units += 2;
    else {
      // UCS-2: every UTF-16 unit counts, and a long text splits at 67
      const u = text.length;
      return { chars: u, limit: 70, sends: u <= 70 ? 1 : Math.ceil(u / 67) };
    }
  }
  return { chars: units, limit: 160, sends: units <= 160 ? 1 : Math.ceil(units / 153) };
}
