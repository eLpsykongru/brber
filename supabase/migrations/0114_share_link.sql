-- 0114_share_link: BTD-11–13, the barber's half of the queue link. Needs 0111.
--
--   · BTD-11 sends the link through WhatsApp, the phone's own SMS app, or the
--     clipboard. The app hands it over and learns nothing after that — not
--     whether it was delivered, not whether it was opened. So a send is recorded
--     as what the app actually knows: who it was for, how, and when.
--   · BTD-12's "no ticket yet" is real, though: a ticket joined today, after the
--     send, on the number it went to — a guest's (0111) or an app customer's.
--   · BTD-13 needs the guest behind a walk-in row. `guest_tickets` has no policies
--     (0111), so a barber reads only his own chair's guests, through here.

create table if not exists public.queue_link_sends (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  points_at text not null check (points_at in ('chair', 'shop')),
  channel text not null check (channel in ('whatsapp', 'sms', 'copy')),
  to_name text,
  to_phone text,                           -- +2126… / +2127…, when a number was given
  phone_key text,
  sent_at timestamptz not null default now()
);
create index if not exists queue_link_sends_barber_idx on public.queue_link_sends (barber_id, sent_at desc);
alter table public.queue_link_sends enable row level security;   -- read through barber_link_today

create or replace function public.record_link_send(
  p_points_at text, p_channel text, p_to_name text default null, p_to_phone text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_phone text := public.guest_phone(p_to_phone);
  r public.queue_link_sends;
begin
  select b.salon_id into v_salon from public.barbers b
   where b.id = auth.uid() and b.status = 'approved' and b.salon_status = 'approved';
  if v_salon is null then raise exception 'Only a barber in a shop sends the line link'; end if;
  if coalesce(p_points_at, '') not in ('chair', 'shop') then raise exception 'Pick where the link points'; end if;
  if coalesce(p_channel, '') not in ('whatsapp', 'sms', 'copy') then raise exception 'Pick how it goes'; end if;

  insert into public.queue_link_sends (barber_id, salon_id, points_at, channel, to_name, to_phone, phone_key)
  values (auth.uid(), v_salon, p_points_at, p_channel,
          nullif(left(btrim(coalesce(p_to_name, '')), 40), ''), v_phone, right(v_phone, 9))
  returning * into r;
  return json_build_object('id', r.id, 'sent_at', r.sent_at);
end;
$$;

-- BTD-12: today's last send, and the ticket that came of it, if one did
create or replace function public.barber_link_today()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone shop_tz)::date;
  r public.queue_link_sends;
  v_taken json;
begin
  select * into r from public.queue_link_sends q
   where q.barber_id = auth.uid() and (q.sent_at at time zone shop_tz)::date = v_today
   order by q.sent_at desc limit 1;
  if not found then return null; end if;

  if r.phone_key is not null then
    select json_build_object('booking_id', b.id, 'at', coalesce(gt.verified_at, b.created_at))
      into v_taken
      from public.bookings b
      join public.barbers bb on bb.id = b.barber_id
      left join public.guest_tickets gt on gt.booking_id = b.id
      left join public.profiles p on p.id = b.customer_id and b.customer_id <> b.barber_id
     where bb.salon_id = r.salon_id
       and (r.points_at = 'shop' or b.barber_id = r.barber_id)
       and b.status = 'confirmed'
       and (b.starts_at at time zone shop_tz)::date = v_today
       and b.created_at >= r.sent_at
       and ((gt.verified_at is not null and gt.phone_key = r.phone_key)
            or right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = r.phone_key)
     order by b.created_at
     limit 1;
  end if;

  return json_build_object(
    'id', r.id, 'sent_at', r.sent_at, 'points_at', r.points_at, 'channel', r.channel,
    'to_name', r.to_name, 'to_phone', r.to_phone, 'taken', v_taken);
end;
$$;

-- BTD-13: the guests in his own chair today. The phone is the one thing he has
-- to reach somebody with no account, so it is his to see.
create or replace function public.barber_guests_today()
returns table (booking_id uuid, first_name text, phone text, source text,
               joined_at timestamptz, confirmed boolean)
language sql stable security definer set search_path = ''
as $$
  select gt.booking_id, gt.first_name, gt.phone, gt.source,
         coalesce(gt.verified_at, gt.created_at), gt.verified_at is not null
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
   where b.barber_id = auth.uid()
     and gt.left_at is null
     and (b.starts_at at time zone 'Africa/Casablanca')::date
         = (now() at time zone 'Africa/Casablanca')::date;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'record_link_send(text, text, text, text)', 'barber_link_today()', 'barber_guests_today()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  assert public.barber_link_today() is null, 'nobody signed in, no link';
  assert not exists (select 1 from public.barber_guests_today()), 'nobody signed in, no guests';
  begin
    perform public.record_link_send('chair', 'whatsapp');
    raise exception 'a link was recorded with nobody signed in';
  exception when raise_exception then
    assert sqlerrm = 'Only a barber in a shop sends the line link', 'nobody signed in sends nothing: ' || sqlerrm;
  end;
end $$;
