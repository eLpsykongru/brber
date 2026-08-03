-- 0033_notif_reschedule_kind: one new value on 0032's notif_kind, for the
-- customer-initiated reschedule ask that 0034 introduces.
--
-- Alone in its own migration on purpose: PostgreSQL will not let a transaction
-- USE an enum value it added, and the Supabase CLI runs each file in one
-- transaction. Committing the value here leaves 0034 free to reference it.

alter type public.notif_kind add value if not exists 'reschedule';
