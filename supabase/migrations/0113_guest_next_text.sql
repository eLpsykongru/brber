-- 0113_guest_next_text: QL-07's "you're next" text, for a ticket taken on the web.
-- Needs 0111.
--
-- An app customer hears it as a push (0037's queue_next). A guest has nobody to
-- push to, so the same news goes as a text — once per ticket, into `sms_outbox`
-- like every other text until an SMS account exists. The README allows a guest
-- two texts: this one, and one if the shop closes the line. That second one has
-- no copy in any design and is not built.
--
-- Who is next is asked again whenever the line moves: a cut starts or ends, a
-- booking leaves or is moved, an unconfirmed hold is swept away, a guest's ticket
-- is confirmed. The next person is the first confirmed booking today that has not
-- started. When that is a guest's ticket and he has not been told, he is told —
-- except the moment he joins a chair nobody is in, because then he is standing
-- in front of it.
--
-- Not 0037's pick, which skips every walk-in row and so never names a guest (and
-- tells an app customer behind a walk-in "you're next" early — left as it is).
--
-- The copy is QL-07's, in English: no French or Arabic exists for it yet. Two
-- changes, both so a text is one send and not two: plain "-" and "Ticket 07"
-- instead of the em dash and "Nº", which are outside the GSM alphabet — the same
-- call the owner made for the code text. QL-07's link to the ticket page waits
-- for the domain: a text outlives a temporary host, as a poster does.

create unique index if not exists sms_outbox_next_once on public.sms_outbox (booking_id) where kind = 'next';

create or replace function public.guest_next_check(p_barber uuid, p_joined uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  shop_tz constant text := 'Africa/Casablanca';
  v_today date := (now() at time zone shop_tz)::date;
  v_next uuid;
  t record;
  v_no int;
begin
  if p_barber is null then return; end if;

  select b.id into v_next
    from public.bookings b
   where b.barber_id = p_barber and b.status = 'confirmed'
     and b.started_at is null and b.completed_at is null
     and (b.starts_at at time zone shop_tz)::date = v_today
   order by b.starts_at, b.id
   limit 1;
  if v_next is null then return; end if;

  if v_next = p_joined and not exists (
       select 1 from public.bookings b
        where b.barber_id = p_barber and b.status = 'confirmed'
          and b.started_at is not null and b.completed_at is null
          and (b.starts_at at time zone shop_tz)::date = v_today) then
    return;
  end if;

  select gt.phone, gt.phone_key, b.starts_at, sa.name as shop, sa.address,
         split_part(coalesce(nullif(btrim(p.full_name), ''), 'Your barber'), ' ', 1) as barber
    into t
    from public.guest_tickets gt
    join public.bookings b on b.id = gt.booking_id
    join public.barbers bb on bb.id = b.barber_id
    join public.salons sa on sa.id = bb.salon_id
    join public.profiles p on p.id = b.barber_id
   where gt.booking_id = v_next and gt.verified_at is not null and gt.left_at is null;
  if not found then return; end if;

  -- Nº is the position in the day, 0029's count, as the ticket page shows it
  select count(*)::int into v_no from public.bookings d
   where d.barber_id = p_barber and d.status = 'confirmed'
     and (d.starts_at at time zone shop_tz)::date = v_today
     and (d.starts_at, d.id) <= (t.starts_at, v_next);

  insert into public.sms_outbox (kind, to_phone, phone_key, body, booking_id)
  values ('next', t.phone, t.phone_key,
          'You''re next at ' || t.shop || '. ' || t.barber || ' is finishing up - come to the chair now. '
            || coalesce(nullif(btrim(t.address), '') || '. ', '')
            || 'Ticket ' || lpad(v_no::text, 2, '0') || '.',
          v_next)
  on conflict (booking_id) where kind = 'next' do nothing;
end;
$$;

create or replace function public.guest_next_on_booking()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.guest_next_check(old.barber_id);
    return old;
  end if;
  if new.started_at is distinct from old.started_at
     or new.completed_at is distinct from old.completed_at
     or new.status is distinct from old.status
     or new.starts_at is distinct from old.starts_at then
    perform public.guest_next_check(new.barber_id);
  end if;
  return new;
end;
$$;

drop trigger if exists after_booking_guest_next on public.bookings;
create trigger after_booking_guest_next
  after update or delete on public.bookings
  for each row execute function public.guest_next_on_booking();

-- a ticket confirmed by its code (an update), or straight away by QL-10's switch (an insert)
create or replace function public.guest_next_on_ticket()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.verified_at is not null and (tg_op = 'INSERT' or old.verified_at is null) then
    perform public.guest_next_check(
      (select b.barber_id from public.bookings b where b.id = new.booking_id), new.booking_id);
  end if;
  return new;
end;
$$;

drop trigger if exists after_guest_ticket_verified on public.guest_tickets;
create trigger after_guest_ticket_verified
  after insert or update of verified_at on public.guest_tickets
  for each row execute function public.guest_next_on_ticket();

do $$
declare f text;
begin
  foreach f in array array['guest_next_check(uuid, uuid)', 'guest_next_on_booking()', 'guest_next_on_ticket()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  perform public.guest_next_check(null);
  perform public.guest_next_check('00000000-0000-0000-0000-000000000000');
  assert not exists (select 1 from public.sms_outbox
                      where kind = 'next' and booking_id is null and created_at > now() - interval '1 minute'),
    'nobody in the line, nobody told';
end $$;
