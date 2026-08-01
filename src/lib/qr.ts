import QRCode from 'qrcode';

// The walk-in QR (design 2h/2i/2j). `qrcode.create` is synchronous — the async
// `toString` API would force every caller to hold state — so the SVG path is
// built here from the raw module matrix, one rect per dark module.
//
// ponytail: nothing serves this URL yet. It is the BACKLOG "shareable booking
// link" surface; when that lands, this constant is the only thing to change.
const QUEUE_BASE = 'https://sterncut.ma/q';

/** Scanning this drops the walk-in into the shop's live queue (or one chair's). */
export function queueUrl(salonId: string, barberId?: string | null) {
  return barberId ? `${QUEUE_BASE}/${salonId}?b=${barberId}` : `${QUEUE_BASE}/${salonId}`;
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
