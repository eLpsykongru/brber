-- 0063_notif_shop_status: one new value on notif_kind, for barber turn 11.
--
-- Its own file for the usual reason: `alter type ... add value` cannot share a
-- transaction with a statement that uses the new value, so 0064 needs this to
-- have already committed.
--
-- Closing a shop is not moderation and it is not a booking answer. It is the
-- shop's own state changing under people who were counting on it — the two
-- barbers who are working today, and the person on the waiting list who is
-- holding out for a slot that is no longer coming.

alter type public.notif_kind add value if not exists 'shop_status';
