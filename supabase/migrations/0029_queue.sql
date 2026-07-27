-- 0029_queue: QUEUE MODE (the strategy bet, trigger pulled 2026-07-22).
-- DECIDED same day: the queue is NOT a separate rail — it's a live view over the
-- barber's confirmed day. Book → barber confirms → your ticket appears; walk-ins
-- the barber quick-adds are bookings too, so they slot into the same queue.
-- The barber "runs the queue" with the lifecycle he already has (0018:
-- Confirm → Check in → Start → Complete). No new table.

-- (drops from the first cut of 0029, in case it was ever applied)
drop function if exists public.join_queue(uuid, uuid);
drop function if exists public.queue_add_walkin(text, uuid);
drop function if exists public.leave_queue(uuid);
drop function if exists public.queue_set_status(uuid, text);
drop function if exists public._next_ticket_no(uuid);
drop table if exists public.queue_tickets cascade;

-- A customer with a confirmed booking today may watch that barber's day queue.
-- Names are trimmed server-side (first name + initial); walk-ins show their name.
create or replace function public.barber_day_queue(p_barber uuid)
returns table (
  booking_id uuid,
  label text,
  service_name text,
  duration_min int,
  starts_at timestamptz,
  stage text  -- waiting | in_chair | done
)
language sql security definer set search_path = ''
as $$
  select
    b.id,
    case
      when b.walk_in_name is not null then b.walk_in_name
      when b.customer_id = auth.uid() then 'You'
      else split_part(coalesce(p.full_name, 'Client'), ' ', 1)
        || case when split_part(coalesce(p.full_name, ''), ' ', 2) <> ''
           then ' ' || left(split_part(p.full_name, ' ', 2), 1) || '.' else '' end
    end,
    s.name,
    s.duration_min,
    b.starts_at,
    case
      when b.completed_at is not null then 'done'
      when b.started_at is not null then 'in_chair'
      else 'waiting'
    end
  from public.bookings b
  left join public.profiles p on p.id = b.customer_id
  left join public.services s on s.id = b.service_id
  where b.barber_id = p_barber
    and b.status = 'confirmed'
    and b.starts_at >= date_trunc('day', now())
    and b.starts_at < date_trunc('day', now()) + interval '1 day'
    -- gate: only someone in today's book (or the barber himself) may watch it
    and exists (
      select 1 from public.bookings m
      where m.barber_id = p_barber
        and (m.customer_id = auth.uid() or p_barber = auth.uid())
        and m.status = 'confirmed'
        and m.starts_at >= date_trunc('day', now())
        and m.starts_at < date_trunc('day', now()) + interval '1 day'
    )
  order by b.starts_at;
$$;

grant execute on function public.barber_day_queue(uuid) to authenticated;
