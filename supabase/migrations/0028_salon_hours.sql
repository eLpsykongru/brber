-- 0028_salon_hours: salon opening hours as an envelope. A barber's weekly hours
-- (availability) must sit inside the salon's open–close window, so if the shop is
-- 09:00–23:00 a co-barber can set 10:00–21:00 but not 08:00 or 23:30. Enforced by a
-- trigger on availability (a barber can write those rows directly, so UI isn't enough).
--
-- Default is all-day (0–1440) = no constraint, so existing one-man salons aren't
-- suddenly clamped. The owner narrows it in Salon → Settings → Opening hours.
-- Narrowing later doesn't retro-trim rows already saved wider — it applies on next edit.

alter table public.salons
  add column open_min int not null default 0 check (open_min between 0 and 1439),
  add column close_min int not null default 1440 check (close_min between 1 and 1440);
alter table public.salons add constraint salons_hours_order check (close_min > open_min);
-- 0011 already grants owners table-level update on salons, so open/close are settable.

create or replace function public.availability_within_salon()
returns trigger language plpgsql set search_path = '' as $$
declare v_open int; v_close int;
begin
  select s.open_min, s.close_min into v_open, v_close
  from public.barbers b join public.salons s on s.id = b.salon_id
  where b.id = new.barber_id;
  if v_open is null then return new; end if;               -- solo barber, no salon
  if v_open = 0 and v_close = 1440 then return new; end if; -- all-day = no envelope
  if new.start_min < v_open or new.end_min > v_close then
    raise exception 'Hours must be within salon opening hours (% – %)',
      lpad((v_open / 60)::text, 2, '0') || ':' || lpad((v_open % 60)::text, 2, '0'),
      lpad((v_close / 60)::text, 2, '0') || ':' || lpad((v_close % 60)::text, 2, '0');
  end if;
  return new;
end;
$$;

create trigger availability_envelope before insert or update on public.availability
  for each row execute function public.availability_within_salon();
