import { supabase } from './supabase';

// MSG — unread is the only status chat has. Per thread (a thread is a person,
// lib/threads.ts) from chat_unread() (0131), plus the ops cases' own count (0045).
// The Chat tab's badge is the sum of both.

export type Unread = { byPeer: Map<string, number>; ops: number; total: number };

export async function loadUnread(): Promise<Unread> {
  const [u, c] = await Promise.all([supabase.rpc('chat_unread'), supabase.rpc('my_support_cases')]);
  const byPeer = new Map<string, number>();
  for (const r of (u.data ?? []) as { peer_id: string; unread: number }[]) {
    if (r.unread > 0) byPeer.set(r.peer_id, r.unread);
  }
  const ops = ((c.data ?? []) as { unread?: number }[]).reduce((n, x) => n + (x.unread ?? 0), 0);
  let total = ops;
  byPeer.forEach((n) => { total += n; });
  return { byPeer, ops, total };
}
