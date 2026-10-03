-- 0146_barber_moved: RVW-12's "31 of his old customers are told, once", and the push
-- gap it ran into.
--
-- 1. A barber taken on through Chairs for rent (0144) tells his past customers where
--    he went: one inbox line each, never a campaign — no offer, no discount ("a barber
--    they know is at a shop nearby. That sentence is the whole campaign."). Past = a
--    completed visit in the last twelve months. Never his walk-ins (his own id stands
--    in as their customer), never a deleted account, never the owner taking him on,
--    never anyone who switched the notice off (notification_prefs.tell_barber_moves).
--    The ask keeps how many were told, for the owner's chair.
--
-- 2. notif_should_push (0108; the zone since 0139) ended its switch with `else false`,
--    so every kind that has no switch of its own — shop_status, moderation, digest —
--    stopped buzzing for anyone who had ever saved a
--    notification setting, while an account that never had still got them. "Payouts
--    are paused" (0141) or "Hamza asked for Chair 4" (0144) reached an owner's
--    lock screen only if he had never opened Settings. Those kinds now follow the
--    same default as an account with no settings row; everything else is unchanged.

alter table public.notification_prefs
  add column if not exists tell_barber_moves boolean not null default true;

alter table public.chair_asks add column if not exists told int;

create or replace function public.notif_should_push(p_user uuid, p_kind public.notif_kind, p_urgent boolean)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := public.morocco_tz();
  p record;
  local_now timestamp;
  now_min int;
  is_barber boolean;
  working boolean;
  cutting boolean;
begin
  select * into p from public.notification_prefs where user_id = p_user;
  if not found then
    -- no row yet = defaults; the quiet ones stay quiet, everything else pushes
    return p_kind not in ('review', 'offer');
  end if;

  if not (case p_kind
    when 'booking_request' then p.push_booking_request
    when 'reschedule'      then p.push_booking_request
    when 'cancellation'    then p.push_cancellation
    when 'checked_in'      then p.push_checked_in
    when 'wallet'          then p.push_wallet
    when 'message'         then p.push_message
    when 'review'          then p.push_review
    when 'queue_next'      then p.push_queue_next
    when 'booking_answer'  then p.push_booking_answer
    when 'review_ask'      then p.push_review_ask
    when 'reminder'        then p.reminder_min <> 0
    when 'offer'           then p.push_offers
    else true end) then   -- 0146: a kind with no switch pushes, as it does with no row
    return false;
  end if;

  if p_urgent and p.urgent_always then return true; end if;

  is_barber := exists (select 1 from public.barbers b where b.id = p_user);
  if not is_barber then return true; end if;

  local_now := now() at time zone shop_tz;
  now_min := extract(hour from local_now)::int * 60 + extract(minute from local_now)::int;

  if p.quiet_outside_hours then
    select exists (
      select 1 from public.availability a
      where a.barber_id = p_user
        and a.weekday = extract(dow from local_now)::int
        and a.start_min <= now_min and a.end_min > now_min
    ) and not exists (
      select 1 from public.days_off d
      where d.barber_id = p_user and d.day = local_now::date
    ) into working;
    if not working then return false; end if;
  end if;

  if p.silent_while_cutting then
    select exists (
      select 1 from public.bookings b
      where b.barber_id = p_user and b.started_at is not null and b.completed_at is null
    ) into cutting;
    -- 0108: the one exception BNT-05 offers
    if cutting and not (p_kind = 'cancellation' and p.cancel_breaks_silence) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- 0144's take_chair_ask, and then his customers are told
create or replace function public.take_chair_ask(p_ask uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid; v_shop text; v_addr text; a public.chair_asks; c public.chairs;
  v_old uuid; v_old_status text; v_old_owner uuid; v_old_name text; v_name text; r record;
  v_told int;
begin
  select s.id, s.name, s.address into v_salon, v_shop, v_addr from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner takes a barber on'; end if;
  select * into a from public.chair_asks where id = p_ask and salon_id = v_salon;
  if not found or a.answer is not null then raise exception 'That ask has already been answered'; end if;
  select * into c from public.chairs where id = a.chair_id;
  if c.barber_id is not null then raise exception 'Somebody already sits in %', c.label; end if;
  select coalesce(p.full_name, 'He') into v_name from public.profiles p where p.id = a.barber_id;
  case public.chair_move_block(a.barber_id)
    when 'owner' then raise exception '% owns a shop on Sterncut, so he can''t take a chair here', v_name;
    when 'till' then raise exception '% holds his shop''s cash — he has to hand the drawer over before he can move', v_name;
    when 'handover' then raise exception 'A handover of %''s drawer is under way — he can move once it is done', v_name;
    else null;
  end case;

  select b.salon_id, b.salon_status into v_old, v_old_status from public.barbers b where b.id = a.barber_id;
  select s.owner_id, s.name into v_old_owner, v_old_name from public.salons s where s.id = v_old;

  -- 0025's guard lands anyone joining a shop he doesn't own 'pending'; the owner is
  -- the one taking him on, so the approval is the second step of the same act
  update public.barbers set salon_id = v_salon, pay_model = 'rent',
         rent_cents = coalesce(c.rent_cents, 0), rent_period = c.rent_period, chair_label = c.label
  where id = a.barber_id;
  update public.barbers set salon_status = 'approved', salon_role = 'barber' where id = a.barber_id;
  update public.chairs set barber_id = a.barber_id where id = c.id;   -- unlists it (0142)
  update public.chair_asks set answer = 'taken', answered_at = now() where id = p_ask;

  insert into public.notifications (user_id, kind, title, body)
  values (a.barber_id, 'shop_status', v_shop || ' took you on',
          c.label || ' is yours from today' || case when c.rent_cents > 0
            then ', at ' || round(c.rent_cents / 100.0) || ' DH a ' || c.rent_period else '' end
          || '. Your clients and your bookings come with you.');
  if v_old_owner is not null and v_old_status = 'approved' and v_old_owner <> auth.uid() then
    insert into public.notifications (user_id, kind, title, body)
    values (v_old_owner, 'shop_status', v_name || ' has left ' || v_old_name,
            'He took a chair at another shop. His chair at ' || v_old_name || ' is empty now.');
  end if;
  for r in update public.chair_asks set answer = 'declined', answered_at = now()
           where chair_id = c.id and answer is null returning barber_id loop
    insert into public.notifications (user_id, kind, title, body)
    values (r.barber_id, 'shop_status', c.label || ' at ' || v_shop || ' has gone',
            'Another barber took it. Other chairs are in Chairs for rent.');
  end loop;

  -- RVW-12: his past customers hear where he went, once
  with told as (
    insert into public.notifications (user_id, kind, title, body)
    select distinct bo.customer_id, 'shop_status'::public.notif_kind,
           v_name || ' now cuts at ' || v_shop,
           coalesce(nullif(btrim(v_addr), '') || '. ', '') || 'You can book him there as before.'
    from public.bookings bo
    join public.profiles pr on pr.id = bo.customer_id and pr.deleted_at is null
    left join public.notification_prefs np on np.user_id = bo.customer_id
    where bo.barber_id = a.barber_id
      and bo.customer_id <> a.barber_id
      and bo.customer_id <> auth.uid()
      and (bo.status = 'completed' or bo.completed_at is not null)
      and bo.starts_at > now() - interval '12 months'
      and coalesce(np.tell_barber_moves, true)
    returning 1
  )
  select count(*)::int into v_told from told;
  update public.chair_asks set told = v_told where id = p_ask;
end $$;
revoke all on function public.take_chair_ask(uuid) from public, anon;
grant execute on function public.take_chair_ask(uuid) to authenticated;
