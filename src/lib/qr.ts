import QRCode from 'qrcode';

// The walk-in QR (design 2h/2i/2j). `qrcode.create` is synchronous — the async
// `toString` API would force every caller to hold state — so the SVG path is
// built here from the raw module matrix, one rect per dark module.
//
// `web/` serves this (BACKLOG "Queue link"). sterncut.ma is not pointed at it
// yet: EXPO_PUBLIC_QUEUE_BASE sends a test build's links wherever the page is
// deployed. A printed poster outlives a temporary address, so only ever print
// posters against the real one.
const QUEUE_BASE = process.env.EXPO_PUBLIC_QUEUE_BASE || 'https://sterncut.ma/q';

/** Scanning this drops the walk-in into the shop's live queue (or one chair's).
 *  `shop` is the salon's six-character code (0110); a uuid still resolves, and is
 *  what every poster printed before 0110 carries. */
export function queueUrl(shop: string, barber?: string | null) {
  return barber ? `${QUEUE_BASE}/${shop}?b=${barber}` : `${QUEUE_BASE}/${shop}`;
}

/** SVG path data for the QR, in a `0 0 size size` viewBox (1 unit = 1 module). */
export function qrPath(text: string): { d: string; size: number } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  const data = modules.data;
  let d = '';
  for (let y = 0; y < size; y++) {
    let run = 0;
    for (let x = 0; x <= size; x++) {
      const on = x < size && !!data[y * size + x];
      if (on) { run++; continue; }
      if (run) { d += `M${x - run} ${y}h${run}v1h-${run}z`; run = 0; } // merge horizontal runs
    }
  }
  return { d, size };
}

/** A standalone <svg> string — usable by SvgXml on screen and inside print HTML. */
export function qrSvg(text: string, px: number, color = '#111') {
  const { d, size } = qrPath(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" `
    + `viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
    + `<path fill="${color}" d="${d}"/></svg>`;
}
