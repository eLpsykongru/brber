// What a person hands the app as a shop: a whole link scanned off the poster or
// pasted from WhatsApp, or the six characters under the QR typed by hand (38b).
// Posters printed before 0110 carry the salon's uuid instead, and still resolve.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** 0110's alphabet — no I, O, 0 or 1 — six characters for a shop, four for a barber. */
const SHOP_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const BARBER_CODE = /^[A-HJ-NP-Z2-9]{4}$/;

export type ShopCode = { shop: string; barber?: string };

export function isUuid(s: string) {
  return new RegExp(`^${UUID.source}$`, 'i').test(s);
}

function pickOut(raw: string, code: RegExp): string | null {
  const uuid = raw.match(UUID);
  if (uuid) return uuid[0].toLowerCase();
  // typed by hand: "lf7 k2m", "LF7-K2M", or a link that ends a sentence
  const typed = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return code.test(typed) ? typed : null;
}

/** The shop (a code or a uuid) and, from a barber's link, his chair. Null when it is not ours. */
export function parseShopCode(raw: string): ShopCode | null {
  const text = raw.trim();
  // a link, on whatever host the page is served from: the shop is the path after /q/
  const link = text.match(/\/q\/([^/?#\s]+)/i);
  const shop = pickOut(link ? link[1] : text, SHOP_CODE);
  if (!shop) return null;
  const b = text.match(/[?&]b=([^&#\s]+)/i);
  const barber = b ? pickOut(b[1], BARBER_CODE) : null;
  return barber ? { shop, barber } : { shop };
}

/**
 * A shop's landing link as the phone hands it to the app (option b): /q/<code>
 * or a pre-0110 poster's /q/<uuid>, on whatever https host serves the page. The
 * code, join and ticket pages under it are not landings — they stay in the browser.
 */
export function queueLanding(url: string): ShopCode | null {
  const landing = /^https:\/\/[^/?#\s]+\/q\/[^/?#\s]+\/?(?:[?#]\S*)?$/i;
  return landing.test(url.trim()) ? parseShopCode(url) : null;
}
