// ponytail: module singleton, not a store lib — one writer (schedule editor),
// one reader (MY DAY). Holds the block ids touched by the last applied/undone
// buffer fix so the timeline can glow them once.

let changed: { blockIds: string[]; at: number } | null = null;

export function setLastFix(blockIds: string[]) {
  if (blockIds.length) changed = { blockIds, at: Date.now() };
}

// read-and-clear; stale marks (>5 min) are ignored
export function takeLastFix(maxAgeMs = 5 * 60_000): string[] {
  if (!changed || Date.now() - changed.at > maxAgeMs) return [];
  const ids = changed.blockIds;
  changed = null;
  return ids;
}
