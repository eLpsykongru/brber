-- 0041_notif_moderation_kind: one new value on notif_kind for decisions taken at
-- the admin desk — a review removed, a shop approved or rejected.
--
-- Its own file, same reason as 0033 and 0036: a value added to an enum cannot be
-- used in the transaction that adds it, and 0042 uses this one.

alter type public.notif_kind add value if not exists 'moderation';
