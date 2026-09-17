-- 0121_undo_done: ADDENDUM-app-first, turn B11 (BTD-22). Done is the only rung that
-- moves money, so it is the only one with a way back — and the way back has to bring
-- the money with it. Needs the ledger and the settlement tables (0075, 0081); nothing
-- from 0118–0120, so it is safe to apply on its own.
--
-- 0021's undo cleared completed_at and nothing else. It predates the ledger: since
-- 0075 marking a cut done also hands the deposit to the shop (deposit_holds ->
-- 'to_shop'), asks the customer "How was the cut?" (0037), and lets the barber rate
-- him (0030). Undoing left all three standing: the wrong man's deposit counted as
-- earned, a review asked of a cut that had not happened, and a rating sitting on the
-- booking — client_ratings is one row per booking, so the right cut could never be
-- rated afterwards.
--
-- The way back now takes them with it:
--   · the hold returns to 'held'. 0075 calls resolution one-way, and this is the one
--     exception: while the undo is still open, and only while no settlement run covers the
--     moment it resolved. A cut already on a statement — draft or released — is a
--     correction (§2.8), not a tap. Marking him done again resolves it again.
--   · the "How was the cut?" inbox row goes. A push that already went out cannot be
--     recalled; the row it would open no longer exists.
--   · a rating written since the mark goes, so the right cut can be rated.
-- Left as they were, on purpose:
--   · a referral reward (0038) this cut paid. The ledger is append-only, and the
--     reward pays once per invitee, so marking him done again never pays twice. It
--     is only wrong if he never comes back — BACKLOG.
--   · a bundle repriced at settle (0047). Home settles again when he is marked done
--     again; the day timeline and the calendar keep the settled price, as before.
--   · a you're-next text the finish sent to the next guest (0113). It was true.
--
-- And the window is no longer a clock. 0021 allowed two minutes; now an undo is allowed
-- on the barber's latest done for as long as nobody has sat down in his chair after it.
-- Seating the next man is what counts the cash: from then on a wrong done is the shop
-- owner's to fix, because he is holding the money — there is no correction in the barber
-- app, and the app does not pretend there is (BTD-22). The same rule is line.ts's
-- undoableDone, read off the same rows, so the button and this check cannot disagree.

create or replace function public.revert_completion(
  p_booking uuid,
  p_clear_start boolean default false,
  p_clear_checkin boolean default false
)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
  h record;
begin
  select bk.barber_id, bk.completed_at into b
    from public.bookings bk where bk.id = p_booking
   for update;
  if not found then raise exception 'Booking not found'; end if;
  if auth.uid() is distinct from b.barber_id then raise exception 'Not your booking'; end if;
  if b.completed_at is null then raise exception 'Booking is not completed'; end if;
  -- the chair's latest done, until somebody sits down after it
  if exists (select 1 from public.bookings o
              where o.barber_id = b.barber_id and o.id <> p_booking
                and (o.completed_at > b.completed_at or o.started_at > b.completed_at)) then
    raise exception 'The next man has sat down - this cut is counted now, and it is the owner''s to fix';
  end if;

  select dh.state, dh.reason, dh.resolved_at into h
    from public.deposit_holds dh where dh.booking_id = p_booking
   for update;
  if found and h.state = 'to_shop' and h.reason = 'cut done'
     and exists (select 1 from public.settlement_runs r
                  where h.resolved_at >= r.covers_from and h.resolved_at < r.covers_to) then
    raise exception 'This cut is already on the week''s statement - it needs a correction now';
  end if;

  update public.bookings
     set completed_at = null,
         started_at = case when p_clear_start then null else started_at end,
         checked_in_at = case when p_clear_checkin then null else checked_in_at end
   where id = p_booking;

  -- the one way a hold goes back to 'held': the mark that resolved it was taken back
  update public.deposit_holds
     set state = 'held', reason = null, resolved_at = null
   where booking_id = p_booking and state = 'to_shop' and reason = 'cut done';

  -- written by the mark's own transaction, so stamped at or after it
  delete from public.notifications n
   where n.booking_id = p_booking and n.kind = 'review_ask'
     and n.created_at >= b.completed_at;
  delete from public.client_ratings cr
   where cr.booking_id = p_booking and cr.created_at >= b.completed_at;
end;
$$;

-- default privileges hand anon EXECUTE on anything new (0117): take it back by name
revoke execute on function public.revert_completion(uuid, boolean, boolean) from public, anon;
grant execute on function public.revert_completion(uuid, boolean, boolean) to authenticated;

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  begin
    perform public.revert_completion('00000000-0000-0000-0000-000000000000');
    raise exception 'undid a booking that does not exist';
  exception when raise_exception then
    assert sqlerrm = 'Booking not found', 'nothing to undo: ' || sqlerrm;
  end;

  -- no clock decides it: the next man sitting down does
  assert (select p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and p.proname = 'revert_completion') not like '%interval%',
    'the undo has no time window';

  -- the hold the undo returns is one the mark resolved, and only that one
  assert exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'resolve_deposit_hold'
                    and p.prosrc like '%''cut done''%'),
    'resolve_deposit_hold still names a finished cut ''cut done''';

  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not exists (
      select 1 from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace,
        aclexplode(p.proacl) a
       where ns.nspname = 'public' and p.proname = 'revert_completion'
         and a.privilege_type = 'EXECUTE'
         and (a.grantee = 0 or a.grantee = 'anon'::regrole)),
      'an undo is not callable without signing in';
  end if;
end $$;
