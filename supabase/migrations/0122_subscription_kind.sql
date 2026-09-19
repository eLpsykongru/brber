-- 0122_subscription_kind: one word, on its own.
--
-- The billing rail (0123) puts the month's subscription on the shop's Friday
-- statement as its own line. `statement_items.kind` is an enum, and a value
-- added by ALTER TYPE cannot be used in the same transaction that adds it — so
-- the word ships alone, the same reason 0085 left a `closed` visit state out.

alter type public.statement_kind add value if not exists 'subscription';
