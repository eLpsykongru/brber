import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { bump, Job, JobCall, replace, sendable, without } from './outbox';
import { supabase } from './supabase';

// The half of turn 10's queue that touches the world: disk, network, React.
// The arithmetic lives in `outbox.ts` where it can be checked.
//
// ponytail: one key, whole array, rewritten on every change. A barber's unsent
// list is three rows on a bad morning, not three thousand — a per-job key or a
// local database would be machinery for a problem this shop will never have.
// If it ever grows past a screenful, that is the moment to reach for SQLite.

const KEY = 'sterncut.outbox.v1';

let jobs: Job[] = [];
let loaded = false;
let flushing = false;
const listeners = new Set<(j: Job[]) => void>();

function emit() {
  for (const l of listeners) l(jobs);
}

async function save() {
  await AsyncStorage.setItem(KEY, JSON.stringify(jobs));
  emit();
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) jobs = JSON.parse(raw) as Job[];
  } catch {
    // a corrupt queue is worse than an empty one: it would retry for ever
    jobs = [];
  }
  emit();
}

/** Do it now, locally, and send it when we can. Returns immediately. */
export async function enqueue(job: Omit<Job, 'id' | 'tries'>): Promise<void> {
  await load();
  jobs = [...jobs, { ...job, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tries: 0 }];
  await save();
  flush();
}

async function run(call: JobCall) {
  if ('rpc' in call) return supabase.rpc(call.rpc, call.args);
  if ('insert' in call) return supabase.from(call.insert).insert(call.row);
  return supabase.from(call.update).update(call.patch).eq('id', call.id);
}

/** Try the queue, oldest first. Stops at the first network failure. */
export async function flush(): Promise<void> {
  await load();
  if (flushing) return;
  flushing = true;
  try {
    for (const job of sendable(jobs)) {
      const { error } = await run(job.call);
      if (!error) {
        jobs = without(jobs, job.id);
        await save();
        continue;
      }
      const next = bump(job, error.message);
      jobs = replace(jobs, next);
      await save();
      // a conflict is his to answer (10b) — keep going. Anything else is the
      // network, and the next job will hit the same wall.
      if (!next.conflict) break;
    }
  } finally {
    flushing = false;
  }
}

export async function drop(id: string): Promise<void> {
  await load();
  jobs = without(jobs, id);
  await save();
}

/** The queue, live. Every screen that shows it re-renders on its own. */
export function useOutbox(): Job[] {
  const [list, setList] = useState<Job[]>(jobs);
  useEffect(() => {
    listeners.add(setList);
    load();
    return () => { listeners.delete(setList); };
  }, []);
  return list;
}

/** Online, with the moment we last had a connection — 10a's "since 10:42". */
export function useConnection(): { online: boolean; since: Date | null } {
  const [online, setOnline] = useState(true);
  const [since, setSince] = useState<Date | null>(null);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((st) => {
      const up = st.isConnected !== false && st.isInternetReachable !== false;
      setOnline((was) => {
        // stamp the moment it went, not every tick while it is down
        if (was && !up) setSince(new Date());
        if (!was && up) { setSince(null); flush(); }
        return up;
      });
    });
    return () => unsub();
  }, []);
  return { online, since };
}
