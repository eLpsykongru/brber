import { logOut } from './push';
import { tr } from './i18n';
import { supabase } from './supabase';

// DEL-01…06 — what account_deletion_check() (0131) answers, and the delete itself.
// The server is the authority: the screens draw from the check, and the delete
// asks it again, so a refusal means something changed in between.

export type Blocker =
  | { key: 'bookings'; open: boolean; n: number }
  | { key: 'money'; open: boolean; cents: number }            // > 0: owes Sterncut
  | { key: 'drawer'; open: boolean; cents: number; holder: string | null; is_owner: boolean }
  | { key: 'shop'; open: boolean; shop: string; names: string[]; bill_cents: number };

export type DepositBooking = {
  id: string; deposit_cents: number; starts_at: string;
  service: string | null; barber: string | null; shop: string | null;
};

export type DeletionCheck = {
  role: 'customer' | 'barber' | 'admin' | 'agent';
  deposit_bookings: DepositBooking[];
  wallet_cents: number;
  coupons: number;
  bookings: number;
  reviews: number;
  barber: { blockers: Blocker[]; bookings: number; reviews: number } | null;
};

export async function loadDeletionCheck(): Promise<DeletionCheck> {
  const { data, error } = await supabase.rpc('account_deletion_check');
  if (error) throw error;
  return data as DeletionCheck;
}

/**
 * Deletes, removes the files the rows pointed at, and signs this phone out with a
 * farewell so App draws DEL-03 / DEL-06 instead of the welcome screen. Returns the
 * refusal when the server says no — the caller reloads the check and says what
 * changed. Files go best effort: the account is gone either way, and nothing here
 * may keep anyone signed in.
 */
export async function deleteAccount(userId: string, confirm: string, acceptWalletLoss: boolean,
  role: 'customer' | 'barber'): Promise<string | null> {
  const { data, error } = await supabase.rpc('delete_my_account',
    { p_confirm: confirm.trim(), p_accept_wallet_loss: acceptWalletLoss });
  if (error) return error.message;
  const chat = ((data as { chat_images?: string[] } | null)?.chat_images ?? []);
  if (chat.length) await supabase.storage.from('chat-images').remove(chat);
  for (const bucket of ['avatars', 'portfolio', 'id-documents']) {
    const { data: files } = await supabase.storage.from(bucket).list(userId, { limit: 1000 });
    if (files?.length) await supabase.storage.from(bucket).remove(files.map((f) => `${userId}/${f.name}`));
  }
  await logOut('local', role);
  return null;
}

/**
 * The name on a kept booking or review. An account that was deleted keeps its rows
 * with no name (0131), shown as "Former customer" / "Former barber" on both sides.
 * Keyed on deleted_at, not on a missing name: an Apple sign-in can hide the name
 * of an account that is very much alive.
 */
export function nameOrFormer(p: { full_name: string | null; deleted_at?: string | null } | null | undefined,
  fallback: string, role: 'customer' | 'barber') {
  if (p?.full_name) return p.full_name;
  return p?.deleted_at ? (role === 'customer' ? tr('Former customer') : tr('Former barber')) : fallback;
}

/** The typed word: Latin DELETE in every language, trimmed, any case (the server agrees). */
export const typedDelete = (s: string) => s.trim().toUpperCase() === 'DELETE';
