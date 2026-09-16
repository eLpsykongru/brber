// Which chair and which service QL-03 is showing. The server's first paint and
// the page's own repaint both run these — the page inlines them by source — so
// the two cannot disagree about who "Anyone" is.

/** The services this chair can still fit today, in menu order. */
export function fitting(chair) {
  return chair.services.filter((s) => s.wait_min != null);
}

/**
 * `pick` is `{ chair: code | '*', service: name | null }`. A chosen chair keeps
 * its chosen service, or falls back to its first; "Anyone" is whoever starts
 * soonest on the chosen service, or on anything. Null only when nothing fits.
 */
export function resolvePick(chairs, pick) {
  const open = chairs.filter((c) => c.state === 'taking');
  if (pick.chair !== '*') {
    const chair = open.find((c) => c.code === pick.chair);
    if (chair) {
      const list = fitting(chair);
      const service = list.find((s) => s.name === pick.service) ?? list[0];
      return service ? { chair, service } : null;
    }
  }
  let best = null;
  for (const chair of open) {
    for (const service of fitting(chair)) {
      if (pick.service && service.name !== pick.service) continue;
      if (!best || service.wait_min < best.service.wait_min) best = { chair, service };
    }
  }
  if (!best && pick.service) return resolvePick(chairs, { chair: '*', service: null });
  return best;
}

/** The chips: one chair's menu, or for "Anyone" each service once, priced by whoever starts it soonest. */
export function menuFor(chairs, pick) {
  const open = chairs.filter((c) => c.state === 'taking');
  const mine = pick.chair === '*' ? null : open.find((c) => c.code === pick.chair);
  const seen = new Map();
  for (const chair of mine ? [mine] : open) {
    for (const service of fitting(chair)) {
      const had = seen.get(service.name);
      if (!had || service.wait_min < had.wait_min) seen.set(service.name, service);
    }
  }
  return [...seen.values()];
}
