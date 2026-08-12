import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// 39c — the heart, shared by the Explore cards and the salon page.
//
// No RPC: `wishlists` is a two-column table whose RLS policy already scopes
// every row to its owner, so a plain insert/delete is the whole feature. The
// policy is also what makes "nobody is told you saved them" true.

type Kind = 'barber' | 'salon';
const col = (k: Kind) => (k === 'barber' ? 'barber_id' : 'salon_id');

/** [saved, toggle] for one barber or salon. */
export function useSaved(kind: Kind, id: string | null) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    supabase.from('wishlists').select('id').eq(col(kind), id).maybeSingle()
      .then(({ data }) => { if (live) setSaved(!!data); });
    return () => { live = false; };
  }, [kind, id]);

  const toggle = useCallback(async () => {
    if (!id) return;
    const next = !saved;
    setSaved(next);   // optimistic: a heart that lags feels broken
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setSaved(!next); return; }
    const { error } = next
      ? await supabase.from('wishlists').insert({ customer_id: u.user.id, [col(kind)]: id })
      : await supabase.from('wishlists').delete().eq(col(kind), id);
    if (error) setSaved(!next);
  }, [kind, id, saved]);

  return [saved, toggle] as const;
}
