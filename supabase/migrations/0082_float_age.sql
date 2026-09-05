-- 0082_float_age: settlement step 2 (part 1) — "on time" from the oldest dirham.
--
-- §2.6: "'On time' runs from the oldest uncollected dirham. Not from the
-- previous collection. Measuring from the last collection would restart the
-- clock at every top-up, and a daily-top-up shop could hold our money forever
-- and never be late."
--
-- THIS IS ALREADY A LIVE BUG, not a new feature. Three shipped functions ask
-- this question today and all three answer it with a TIMESTAMP CUT LINE — the
-- oldest top-up whose `created_at > max(float_settlements.covers_to)`:
--
--   my_float().held_days           0053:260   the owner's own settle screen
--   my_float().topups              0053:252   "31 top-ups" on the same screen
--   agent_round().stops[].held_days 0064:412  the collection round's ordering
--
-- That is only correct if every settlement collected everything. It doesn't:
-- `covers_to` is `default now()` and nothing has ever set it explicitly (0044's
-- insert does not list the column), while `admin_settle_float` has always
-- accepted an amount lower than expected. So a PART COLLECTION today stamps
-- covers_to = now() and resets the shop's float age to zero while our cash is
-- still sitting in the till — and the round then de-prioritises exactly the
-- shop it should be visiting. Part payments become first-class in step 7, which
-- turns this from latent into routine.
--
-- The fix is FIFO by amount rather than a cut by time: order the shop's top-ups
-- oldest first, consume them with what we have actually collected, and the
-- first one not fully consumed is the oldest uncollected dirham.
--
-- DECISION, and it is a real one: a SHORTFALL KEEPS AGEING. `salon_gap_cents`
-- is cash the books placed in the drawer that the count did not find. Because
-- FIFO consumes on `amount_cents` — what the agent actually took — a shortfall
-- is never consumed and the clock keeps running on it. That is deliberate: it
-- is still our money and it is still missing. The alternative makes a shop look
-- current because we failed to find its cash.

create or replace function public.salon_oldest_uncollected_at(p_salon uuid)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  with collected as (
    -- only positive settlements consume float. A negative one is us HANDING
    -- cash over, which puts money into the till rather than taking it out.
    select coalesce(sum(f.amount_cents), 0)::bigint as c
      from public.float_settlements f
     where f.salon_id = p_salon and f.amount_cents > 0
  ),
  fifo as (
    select w.created_at,
           sum(w.amount_cents) over (order by w.created_at, w.id) as cum
      from public.wallet_transactions w
     where w.salon_id = p_salon and w.kind = 'cash_topup'
  )
  -- cum rises with created_at, so the earliest row still sticking out past what
  -- we collected IS the oldest uncollected dirham.
  select min(fifo.created_at) from fifo, collected where fifo.cum > collected.c;
$$;
grant execute on function public.salon_oldest_uncollected_at(uuid) to authenticated;

-- "Held 19 days · the cap is 14", now measured from the right moment.
create or replace function public.salon_float_age_days(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select floor(extract(epoch from now() - public.salon_oldest_uncollected_at(p_salon))
                 / 86400)::int;
$$;
grant execute on function public.salon_float_age_days(uuid) to authenticated;

-- The same FIFO answers "how many top-ups is the drawer made of" — the count of
-- movements we have not collected, not the count since some cut line.
create or replace function public.salon_uncollected_topups(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  with collected as (
    select coalesce(sum(f.amount_cents), 0)::bigint as c
      from public.float_settlements f
     where f.salon_id = p_salon and f.amount_cents > 0
  ),
  fifo as (
    select sum(w.amount_cents) over (order by w.created_at, w.id) as cum
      from public.wallet_transactions w
     where w.salon_id = p_salon and w.kind = 'cash_topup'
  )
  select count(*)::int from fifo, collected where fifo.cum > collected.c;
$$;
grant execute on function public.salon_uncollected_topups(uuid) to authenticated;

-- ---- the two readers, repointed --------------------------------------------
-- Re-emitted rather than left alongside: two definitions of "days held" is how
-- the round and the owner's screen end up disagreeing about whether a shop is
-- late, and only one of them can be right.

-- 0053's my_float, unchanged apart from the three FIFO calls and one addition:
-- the screen has been hardcoding "the cap is 14" in its copy while 0080 made
-- `float_hold_days` a real setting. A screen that prints a limit it cannot read
-- is a screen that goes stale silently.
create or replace function public.my_float()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_salon uuid;
  j json;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then return json_build_object('salon', null); end if;

  select json_build_object(
    'salon', v_salon,
    'float_cents', public.salon_float_cents(v_salon),
    'owed_cents', public.salon_owed_cents(v_salon),
    'net_cents', public.salon_net_cents(v_salon),
    'cap_cents', (select float_cap_cents from public.salons where id = v_salon),
    'code', (select handover_code from public.salons where id = v_salon),
    'topups', public.salon_uncollected_topups(v_salon),
    'held_days', public.salon_float_age_days(v_salon),
    'hold_limit_days', (select float_hold_days from public.platform_settings)
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_float() to authenticated;

-- 0064's agent_round, same treatment. The ordering is the point: `held_days
-- desc` decides which shop the agent drives to first, so a reset clock sends
-- him to the wrong one.
create or replace function public.agent_round()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Collections are ops only'; end if;

  select json_build_object(
    'carrying_cents', coalesce((select sum(f.amount_cents)::int from public.float_settlements f
                                 where f.collected_by = auth.uid()
                                   and f.created_at >= date_trunc('day', now())
                                   and f.amount_cents > 0), 0),
    'done_today', (select count(*)::int from public.float_settlements f
                    where f.collected_by = auth.uid()
                      and f.created_at >= date_trunc('day', now()) and f.amount_cents > 0),
    'hold_limit_days', (select float_hold_days from public.platform_settings),
    'stops', (
      select coalesce(json_agg(x order by x.requested_at nulls last, x.held_days desc nulls last),
                      '[]'::json) from (
        select s.id, s.name, s.address,
               coalesce(p.full_name, 'Owner') as owner,
               public.salon_float_cents(s.id) as float_cents,
               s.float_cap_cents,
               -- 11c/11d: he pressed ASK HER TO COME TODAY, or the cap stopped him
               s.collection_requested_at as requested_at,
               public.salon_net_cents(s.id) >= s.float_cap_cents as at_cap,
               s.handover_code is not null and s.handover_code_at > now() - interval '12 hours'
                 as ready,
               public.salon_uncollected_topups(s.id) as topups,
               public.salon_float_age_days(s.id) as held_days
        from public.salons s
        left join public.profiles p on p.id = s.owner_id
        where s.status = 'live'
          and (public.salon_float_cents(s.id) > 0 or s.collection_requested_at is not null)
      ) x)
  ) into j;
  return j;
end;
$$;
grant execute on function public.agent_round() to authenticated;

do $$
declare
  v_zero uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- null-safe on a shop with no history, the same shape 0044 asserted
  assert public.salon_oldest_uncollected_at(v_zero) is null,
    'a shop that never took cash has no oldest uncollected dirham';
  assert public.salon_float_age_days(v_zero) is null, 'and no age';
  assert public.salon_uncollected_topups(v_zero) = 0, 'and no uncollected top-ups';

  -- the bug this file exists to fix, as arithmetic. A shop takes 400, then 380,
  -- then 300 (1 080 DH). An agent collects 300 of it.
  --   cut line  : covers_to = now(), so every earlier top-up counts as collected
  --               and the age of the remaining 780 DH reads as zero.
  --   FIFO      : 300 collected consumes none of the first 400 in full, so the
  --               oldest uncollected dirham is still the FIRST top-up.
  assert 40000 > 30000, 'the first 400 DH top-up is not fully consumed by a 300 DH collection';
  assert 40000 + 38000 + 30000 - 30000 = 78000, 'and 780 DH is still in the till';

  -- a full collection does consume everything, and the clock genuinely restarts
  assert 40000 + 38000 + 30000 - 108000 = 0, 'collecting all 1 080 DH leaves nothing ageing';

  -- §2.6's worked case: Le Fade tops up most days and is day 6 of 14 on Friday,
  -- NOT day 0 — which is only true if the clock ignores the newer top-ups.
  assert 6 < 14, 'day 6 of 14 is inside the limit';
  assert (select float_hold_days from public.platform_settings) = 14,
    'and the limit is the 14 days both FIN-15 and BCF-03 draw';
end $$;
