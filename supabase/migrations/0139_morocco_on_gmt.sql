-- 0139_morocco_on_gmt: Morocco has kept GMT (UTC+0) since 20 September 2026, and this
-- database still computes Africa/Casablanca as UTC+1.
--
-- Checked on the live project 2026-10-02:
--   select now() at time zone 'Africa/Casablanca' - now() at time zone 'UTC';  → 01:00:00
-- The server's time-zone data predates the change. So every function that does local-time
-- arithmetic with 'Africa/Casablanca' (62 of them) has run an hour fast since 20 Sep:
-- notifications and reminders print a booking's time an hour late, "today" turns at 23:00
-- the evening before, a shop reads open an hour early, and the Friday 21:00 cut lands at
-- 20:00. Phones and browsers already have the new rules, so they and the database disagree
-- by exactly that hour.
--
-- The decision now lives in one place:
--   morocco_tz() is 'UTC' while the server's data is stale and 'Africa/Casablanca' once it is
--   updated — the real zone is then right for every date, before and after the change, so
--   this heals itself with no further migration. While it reads 'UTC', moments before 20 Sep
--   2026 read an hour earlier than they used to: history only (labels and day boundaries of
--   past rows). Everything from 20 Sep on is right.
-- Every function that names the zone is re-created from its own live definition with the
-- literal swapped for morocco_tz() — in a loop, not pasted, so nothing else in 62 bodies can
-- drift from what is applied. Two changes ride along, both because the weeks already cut
-- were cut at the old offset (Friday 20:00 UTC) while the corrected clock cuts at 21:00 UTC:
--   · "the week a moment falls in" is the stored run that contains it (settlement_week_of)
--     wherever it is compared to stored weeks — recomputing the cut no longer matches them,
--     and corrections and carried lines would quietly find no week;
--   · cutting refuses when a run already ends within a day of the new cut, not only on an
--     exact match — otherwise a week cut at 20:00 UTC by the old clock could be followed by a
--     one-hour "week" ending at 21:00 UTC.

-- ---- 1 · the zone, decided once ------------------------------------------------------
create or replace function public.morocco_tz()
returns text
language sql stable parallel safe
set search_path = ''
as $$
  -- does this server know Morocco left UTC+1? A noon after the change is noon in Tangier.
  select case when (timestamptz '2026-10-01 12:00:00+00' at time zone 'Africa/Casablanca')
                   = timestamp '2026-10-01 12:00:00'
              then 'Africa/Casablanca' else 'UTC' end;
$$;
grant execute on function public.morocco_tz() to anon, authenticated;

-- ---- 2 · the week a moment falls in: the stored run's, when one contains it ------------
-- settlement_week_end (0137) recomputes the cut; a run that exists is the truth.
create or replace function public.settlement_week_of(p_at timestamptz)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select r.covers_to from public.settlement_runs r
      where p_at >= r.covers_from and p_at < r.covers_to
      order by r.covers_to limit 1),
    public.settlement_week_end(p_at));
$$;
revoke all on function public.settlement_week_of(timestamptz) from public, anon;
grant execute on function public.settlement_week_of(timestamptz) to authenticated;

-- ---- 3 · every function that names the zone, re-created from itself ---------------------
do $$
declare
  f record;
  v_def text;
  n int := 0;
begin
  for f in
    select p.oid, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and p.prosrc like '%Africa/Casablanca%' and p.proname <> 'morocco_tz'
     order by p.proname
  loop
    v_def := replace(pg_get_functiondef(f.oid), '''Africa/Casablanca''', 'public.morocco_tz()');
    -- the three readers that compare a moment's week with weeks already cut
    if f.proname in ('admin_corrections', 'admin_carry_correction__direct', 'settlement_items_for') then
      v_def := replace(v_def, 'public.settlement_week_end(', 'public.settlement_week_of(');
    end if;
    execute v_def;
    n := n + 1;
  end loop;
  raise notice '0139: % functions now take the zone from morocco_tz()', n;

  -- ---- 4 · the duplicate-week guard, by distance instead of equality ------------------------
  -- admin_cut_run is gated (0133), so its body is admin_cut_run__direct.
  v_def := pg_get_functiondef('public.admin_cut_run__direct(timestamptz)'::regprocedure);
  if position('where covers_to = v_to) then' in v_def) > 0 then
    execute replace(v_def, 'where covers_to = v_to) then',
                    'where covers_to > v_to - interval ''1 day'') then');
  end if;
end $$;

do $$
begin
  assert not exists (select 1 from pg_proc p
                      where p.pronamespace = 'public'::regnamespace
                        and p.prosrc like '%Africa/Casablanca%' and p.proname <> 'morocco_tz'),
    'no function names the zone but morocco_tz';
  assert position('covers_to > v_to - interval' in
                  pg_get_functiondef('public.admin_cut_run__direct(timestamptz)'::regprocedure)) > 0,
    'cutting refuses a run that ends within a day of one already cut';
  assert public.morocco_tz() in ('UTC', 'Africa/Casablanca'), 'one of the two';
  -- after 20 Sep 2026 both answers agree, stale server or not
  assert public.casa_day(timestamptz '2026-10-02 23:30:00+00') = date '2026-10-02',
    'half past eleven on 2 Oct is still 2 Oct in Tangier';
  assert public.settlement_cut(timestamptz '2026-10-09 21:30:00+00') = timestamptz '2026-10-09 21:00:00+00',
    'Friday''s cut is 21:00 in Tangier, which is 21:00 UTC now';
end $$;
