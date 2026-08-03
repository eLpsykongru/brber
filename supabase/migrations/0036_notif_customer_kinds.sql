-- 0036_notif_customer_kinds: the events a CUSTOMER gets, added to 0032's enum.
--
-- Alone in its own migration for the same reason 0033 was: PostgreSQL will not
-- let a transaction use an enum value it added, and the Supabase CLI runs each
-- file in one transaction. 0037 references all five.

alter type public.notif_kind add value if not exists 'queue_next';      -- "You're next in the chair"
alter type public.notif_kind add value if not exists 'booking_answer';  -- confirmed / declined / moved
alter type public.notif_kind add value if not exists 'review_ask';      -- "How was the cut?"
alter type public.notif_kind add value if not exists 'reminder';        -- 15a, N minutes before the slot
alter type public.notif_kind add value if not exists 'offer';           -- "10% off at Le Fade Tanger"
