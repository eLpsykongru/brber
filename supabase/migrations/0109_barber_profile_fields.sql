-- 0109_barber_profile_fields: BPR-06 and BPR-08 of "Barber - Profile.dc.html".
--
-- BPR-06 splits the barber's profile into what customers see and what only
-- Sterncut sees. Two customer-facing things had nowhere to live: the languages
-- spoken in the chair, and the name a barber went by before changing it.
--
-- BPR-08 rations the name. Once a barber is live, customers know the page by it,
-- so it changes at most once every sixty days, and for thirty days after a change
-- the page carries the old one ("formerly …") so regulars can still find it.
-- Enforced here rather than in the screen: the screen is not the only thing that
-- can write profiles.full_name.
--
-- Not here: BPR-08's owner consent for a name that contains a shop's name, and
-- the check against the name on the licence. There is no owner-side screen to
-- ask on and no licence name on file — both are in BACKLOG.

-- ---- BPR-06 · languages in the chair ---------------------------------------
alter table public.barbers
  add column if not exists languages text[] not null default '{}'
    check (languages <@ array['darija', 'ar', 'fr', 'en']::text[]);

-- add-only, like 0016 and 0017: the existing column grants stand
grant update (languages) on public.barbers to authenticated;

-- ---- BPR-08 · the name, rationed ----------------------------------------------
alter table public.profiles
  add column if not exists previous_name text,
  add column if not exists name_changed_at timestamptz;
-- deliberately no update grant on either: only the trigger below writes them

create or replace function public.profiles_name_lock()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.full_name is not distinct from old.full_name then return new; end if;

  -- a barber nobody can book yet has no customers who know the name
  if not exists (select 1 from public.barbers b
                 where b.id = new.id and b.status = 'approved') then
    return new;
  end if;

  -- ops correcting a name is not the barber spending their one change
  if public.is_admin() then return new; end if;

  if old.name_changed_at is not null
     and old.name_changed_at > now() - interval '60 days' then
    raise exception 'Your name can change again on %',
      to_char((old.name_changed_at + interval '60 days') at time zone 'Africa/Casablanca',
              'FMDD FMMonth YYYY');
  end if;

  new.previous_name := old.full_name;
  new.name_changed_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_name_lock on public.profiles;
create trigger profiles_name_lock
  before update of full_name on public.profiles
  for each row execute function public.profiles_name_lock();
