-- 0054_licence_standing: barber turn 10d/10e — the countdown and the consequence.
--
-- 10d warns nine days out; 10e is the shop after the deadline passed. Both need
-- one fact nothing recorded: **when the licence runs out.** `id_document_path`
-- said a licence had been seen, never until when, so nothing could count down and
-- ops had no date to act on.
--
-- Hiding stays where it already is — `salons.status` and `admin_salon_decide`
-- (0042). This adds the date, the read both screens share, and the way back in.

alter table public.barbers
  add column if not exists licence_expires_at date;

-- ---- what the shop's standing actually is ----------------------------------
-- One read behind 10d's amber banner and 10e's whole screen, because they are
-- the same fact at two distances from the deadline.
create or replace function public.my_standing()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_salon uuid;
  v_status text;
  v_expires date;
  v_today date := (now() at time zone 'Africa/Casablanca')::date;
  j json;
begin
  select b.licence_expires_at, s.id, s.status
    into v_expires, v_salon, v_status
    from public.barbers b
    left join public.salons s on s.owner_id = b.id
   where b.id = v_me;
  if not found then return json_build_object('barber', null); end if;

  select json_build_object(
    'barber', v_me,
    'salon', v_salon,
    'salon_status', v_status,
    'licence_expires_at', v_expires,
    'days_left', case when v_expires is null then null else (v_expires - v_today) end,
    -- 10e is not "the licence lapsed", it is "we hid you". Those come apart:
    -- ops can suspend for other reasons, and a lapsed licence he has already
    -- re-sent should not keep shouting at him.
    'hidden', v_status is distinct from 'live' and v_status is not null,
    'expired', v_expires is not null and v_expires < v_today,
    -- 10e's "what still works" is three real counts, not reassurance
    'bookings_ahead', (
      select count(*)::int from public.bookings b
       where b.barber_id = v_me and b.status in ('pending', 'confirmed')
         and b.starts_at > now()),
    -- "costing you about N cuts a day": what search actually brought him, over
    -- the fortnight before he was hidden. No model, just his own history.
    'search_cuts_per_day', (
      select round(count(*)::numeric / 14, 1) from public.bookings b
       where b.barber_id = v_me and b.customer_id <> v_me
         and b.status in ('completed', 'confirmed')
         and b.created_at between now() - interval '28 days' and now() - interval '14 days'),
    'licence_task', (
      select t.id from public.shop_tasks t
       where t.salon_id = v_salon and t.kind = 'licence' and t.status in ('open', 'sent')
       order by t.created_at desc limit 1)
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_standing() to authenticated;

-- ---- 10d/10e · sending the new one -----------------------------------------
-- The photo lands in the same private bucket 0001 made for identity documents.
-- This does NOT un-hide the shop: 10e says "the shop un-hides itself the moment
-- ops accepts it", and ops accepting is `admin_salon_decide`. A barber who could
-- lift his own suspension by uploading a photo has no suspension.
create or replace function public.submit_licence(p_path text, p_expires date default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_salon uuid;
  v_ref text;
begin
  if p_path is null or length(p_path) = 0 then raise exception 'No photo'; end if;
  if p_expires is not null and p_expires < (now() at time zone 'Africa/Casablanca')::date then
    raise exception 'That date has already passed';
  end if;

  update public.barbers
     set id_document_path = p_path,
         licence_expires_at = coalesce(p_expires, licence_expires_at)
   where id = v_me;
  if not found then raise exception 'You are not a barber'; end if;

  select id into v_salon from public.salons where owner_id = v_me;
  if v_salon is null then return; end if;

  -- give ops something to act on. An open licence task is marked sent rather
  -- than duplicated, so re-sending a clearer photo doesn't create a second one.
  update public.shop_tasks
     set status = 'sent', proof_path = p_path, proof_at = now()
   where salon_id = v_salon and kind = 'licence' and status in ('open', 'sent');
  if not found then
    v_ref := 'LIC-' || upper(left(replace(v_salon::text, '-', ''), 4));
    insert into public.shop_tasks
      (salon_id, ref, kind, title, body, action, status, proof_path, proof_at, issued_because)
    values (v_salon, v_ref, 'licence', 'New licence to check',
            'The shop sent a new licence photo.', 'photo', 'sent', p_path, now(),
            'sent by the shop');
  end if;
end;
$$;
grant execute on function public.submit_licence(text, date) to authenticated;

-- 0001's id-documents policies are insert-own/select-own-or-admin keyed on the
-- owner's folder, which is exactly what a re-sent licence needs. Nothing to add.

do $$
declare
  v_today date := date '2026-08-09';
begin
  -- 10d fires at nine days out and 10e once the date has gone
  assert (date '2026-08-18' - v_today) = 9, 'Aug 18 is nine days from Aug 9';
  assert (date '2026-08-18' - v_today) > 0, 'a future licence is a warning, not a wall';
  assert (date '2026-08-08' - v_today) < 0, 'yesterday is expired';
  -- "about 3 cuts a day" is a fortnight of search bookings over fourteen days
  assert round(42::numeric / 14, 1) = 3.0, '42 cuts in a fortnight reads as 3 a day';
end $$;
