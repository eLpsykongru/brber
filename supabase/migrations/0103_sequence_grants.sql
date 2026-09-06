-- 0103_sequence_grants: a column default is evaluated as the INSERTING user.
--
-- 0083 gave `bookings` a reference — `'STC-' || nextval('booking_ref_seq')` —
-- and never granted the sequence. `bookings` is the one table in this schema a
-- customer inserts into DIRECTLY rather than through a security-definer
-- function, so the default runs as him, and every booking in the app has been
-- failing with:
--
--   permission denied for sequence booking_ref_seq
--
-- That is why 0038's `support_case_seq` never needed a grant and this one does:
-- a case is filed through `file_support_case`, which is security definer, so
-- its default is evaluated as the owner. The rule is about WHO runs the insert,
-- not about the sequence.
--
-- Granting all four rather than only the one that broke. `wallet_ref_seq`,
-- `receipt_ref_seq` and `ops_call_seq` are reached only through security-definer
-- functions today and so do not need it — but "does not need it today" is
-- exactly what was true of `booking_ref_seq` until a table's insert grant
-- changed. USAGE on a sequence hands out nothing but the next number.

grant usage on sequence public.booking_ref_seq  to authenticated;
grant usage on sequence public.wallet_ref_seq   to authenticated;
grant usage on sequence public.receipt_ref_seq  to authenticated;
grant usage on sequence public.ops_call_seq     to authenticated;
grant usage on sequence public.support_case_seq to authenticated;

do $$
declare
  v_missing text;
begin
  -- Every sequence that backs a column default must be usable by the role that
  -- performs the insert. This lists any that still is not.
  --
  -- MATERIALIZED is load-bearing. Postgres does not promise to evaluate WHERE
  -- clauses in written order, so it is free to call has_sequence_privilege() on
  -- an index's oid before the relkind filter has excluded it — which it did:
  --   ERROR: "settlement_receipts_client_ref" is not a sequence
  -- The CTE forces the filter to run first.
  with seqs as materialized (
    select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'S' and n.nspname = 'public'
  )
  select string_agg(s.relname, ', ') into v_missing
    from seqs s
   where not has_sequence_privilege('authenticated', s.oid, 'USAGE');

  assert v_missing is null,
    format('these sequences are still not usable by authenticated: %s', v_missing);

  -- and the one that actually broke: a booking's reference comes from it
  assert has_sequence_privilege('authenticated', 'public.booking_ref_seq', 'USAGE'),
    'a customer can mint his own booking reference again';
end $$;
