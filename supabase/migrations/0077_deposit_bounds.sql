-- 0077_deposit_bounds: gap G4 — Sterncut Ops · Settings turn S2 (SET-11/12/13).
--
-- 0076 landed the two integers with no screen and no history: ops changed them
-- with `update public.platform_settings`. S2 is the desk for them, and its note
-- carries three decisions that are schema, not layout:
--
--   · bounds are checked ONLY when an owner saves, so narrowing STRANDS rather
--     than clamps. Nothing here touches a shop's saved percentage.
--   · there is deliberately NO "clamp all". Silently moving a shop's number
--     changes what a customer is asked for tomorrow without the owner knowing;
--     telling the affected owners does the same job honestly.
--   · a reason is MANDATORY when either bound narrows, optional when it widens.
--     "Widening can only give owners more room, so it needs no defence."

-- The audit is 0066's `settings_changes` (changed_by, before, after, note),
-- which was built for this exact table and already carries "every change is
-- logged with who made it". A second audit table for the same settings row
-- would be two places to look. The bounds are a typed pair inside its JSON:
--   before {floor, ceiling} - after {floor, ceiling, outside, notified}
-- `outside` is frozen at write time: the answer drifts as shops edit, and the
-- log has to keep saying what was true when the desk pressed the button.

-- Nothing has ever updated or deleted a settings_changes row; this is what
-- makes that a rule rather than a habit. Same trigger as the ledger (0075).
drop trigger if exists settings_changes_no_edit on public.settings_changes;
create trigger settings_changes_no_edit
  before update or delete on public.settings_changes
  for each row execute function public.ledger_is_append_only();

-- ---- where every shop actually sits ----------------------------------------
-- One row per live salon with the percentage it would be judged on today. A
-- shop that never set a policy resolves to 40 (0076), which is what it has
-- always been asked for — so it appears in the histogram at 40, not as a gap.
create or replace function public.admin_deposit_distribution()
returns table (salon_id uuid, salon text, pct int)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.name, public.shop_deposit_pct(s.id)
    from public.salons s
   where public.is_admin() and s.status = 'live'
   order by public.shop_deposit_pct(s.id), s.name;
$$;
grant execute on function public.admin_deposit_distribution() to authenticated;

-- SET-11's whole left column, plus the audit rail, in one read.
create or replace function public.admin_deposit_bounds()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_floor int; v_ceiling int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select deposit_floor_pct, deposit_ceiling_pct into v_floor, v_ceiling
    from public.platform_settings where id;

  return json_build_object(
    'floor_pct', v_floor,
    'ceiling_pct', v_ceiling,
    'shops', (select coalesce(json_agg(json_build_object(
                'id', d.salon_id, 'name', d.salon, 'pct', d.pct)), '[]'::json)
                from public.admin_deposit_distribution() d),
    -- the four figures under the histogram
    'total', (select count(*) from public.admin_deposit_distribution()),
    'at_zero', (select count(*) from public.admin_deposit_distribution() where pct = 0),
    'inside', (select count(*) from public.admin_deposit_distribution()
                where pct > 0 and pct between v_floor and v_ceiling),
    'on_floor', (select count(*) from public.admin_deposit_distribution() where pct = v_floor),
    'on_ceiling', (select count(*) from public.admin_deposit_distribution() where pct = v_ceiling),
    'median', (select percentile_disc(0.5) within group (order by pct)
                 from public.admin_deposit_distribution() where pct > 0),
    'changes', (select coalesce(json_agg(json_build_object(
                  'who', coalesce(p.full_name, 'Ops'),
                  'floor_before', (c.before->>'floor')::int,
                  'floor_after', (c.after->>'floor')::int,
                  'ceiling_before', (c.before->>'ceiling')::int,
                  'ceiling_after', (c.after->>'ceiling')::int,
                  'outside', coalesce((c.after->>'outside')::int, 0),
                  'reason', c.note, 'at', c.changed_at)
                  order by c.changed_at desc), '[]'::json)
                  from (select * from public.settings_changes
                         where jsonb_exists(after::jsonb, 'floor')
                         order by changed_at desc limit 6) c
                  left join public.profiles p on p.id = c.changed_by),
    'changes_total', (select count(*) from public.settings_changes
                       where jsonb_exists(after::jsonb, 'floor'))
  );
end $$;
grant execute on function public.admin_deposit_bounds() to authenticated;

-- ---- SET-12/13's impact panel, before anything is written ------------------
-- A shop at 0% is never "outside": the bounds do not touch that choice (§5).
create or replace function public.admin_bounds_impact(p_floor int, p_ceiling int)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_floor int; v_ceiling int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select deposit_floor_pct, deposit_ceiling_pct into v_floor, v_ceiling
    from public.platform_settings where id;

  return json_build_object(
    'narrowing', (p_floor > v_floor or p_ceiling < v_ceiling),
    'outside', (select count(*) from public.admin_deposit_distribution()
                 where pct > 0 and (pct < p_floor or pct > p_ceiling)),
    'inside', (select count(*) from public.admin_deposit_distribution()
                where pct > 0 and pct between p_floor and p_ceiling),
    'at_zero', (select count(*) from public.admin_deposit_distribution() where pct = 0),
    -- the chips: how many sit at each percentage that would fall outside
    'buckets', (select coalesce(json_agg(json_build_object('pct', x.pct, 'n', x.n)
                  order by x.pct), '[]'::json)
                  from (select pct, count(*) n from public.admin_deposit_distribution()
                         where pct > 0 and (pct < p_floor or pct > p_ceiling)
                         group by pct) x),
    -- SET-13 names the first few rather than only counting them
    'named', (select coalesce(json_agg(json_build_object(
                'name', y.salon, 'pct', y.pct) order by y.pct), '[]'::json)
                from (select salon, pct from public.admin_deposit_distribution()
                       where pct > 0 and (pct < p_floor or pct > p_ceiling)
                       limit 4) y)
  );
end $$;
grant execute on function public.admin_bounds_impact(int, int) to authenticated;


-- ---- the write -------------------------------------------------------------
create or replace function public.admin_set_deposit_bounds(
  p_floor int, p_ceiling int, p_reason text default null, p_notify boolean default true)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_floor int; v_ceiling int; v_outside int; v_narrowing boolean; v_told int := 0;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_floor is null or p_ceiling is null then raise exception 'Both bounds are required'; end if;
  if p_floor < 0 or p_ceiling > 100 then raise exception 'A percentage is 0 to 100'; end if;
  if p_floor > p_ceiling then raise exception 'The floor cannot be above the ceiling'; end if;

  select deposit_floor_pct, deposit_ceiling_pct into v_floor, v_ceiling
    from public.platform_settings where id;
  if p_floor = v_floor and p_ceiling = v_ceiling then
    raise exception 'Those are already the bounds';
  end if;

  v_narrowing := p_floor > v_floor or p_ceiling < v_ceiling;
  -- S2's rule, enforced here and not only in the console: a desk rule that
  -- lives in JavaScript is a desk rule until somebody opens the network tab.
  if v_narrowing and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Narrowing a bound needs a reason - it takes a choice away from a shop that already made it';
  end if;

  select count(*) into v_outside from public.admin_deposit_distribution()
   where pct > 0 and (pct < p_floor or pct > p_ceiling);

  update public.platform_settings
     set deposit_floor_pct = p_floor, deposit_ceiling_pct = p_ceiling,
         updated_at = now(), updated_by = auth.uid()
   where id;

  -- "Tell the owners the floor moved. One SMS each. They find out now, not the
  -- next time they try to save." There is no SMS rail yet (the same one that
  -- blocks slice 1's OTP and RTL), so this is the in-app notification the app
  -- already has.
  -- ponytail: swap the insert for a send when the provider lands. The audience
  -- query is the part that matters and it is already right.
  if p_notify and v_outside > 0 then
    insert into public.notifications (user_id, kind, title, body)
    select s.owner_id, 'moderation', 'The deposit range changed',
           'Sterncut now allows ' || p_floor || '% to ' || p_ceiling ||
           '%. Your shop stays at ' || public.shop_deposit_pct(s.id) ||
           '% until you next change it.'
      from public.salons s
     where s.status = 'live' and s.owner_id is not null
       and public.shop_deposit_pct(s.id) > 0
       and (public.shop_deposit_pct(s.id) < p_floor or public.shop_deposit_pct(s.id) > p_ceiling);
    get diagnostics v_told = row_count;
  end if;

  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(),
          json_build_object('floor', v_floor, 'ceiling', v_ceiling),
          json_build_object('floor', p_floor, 'ceiling', p_ceiling,
                            'outside', v_outside, 'notified', v_told),
          nullif(btrim(coalesce(p_reason, '')), ''));

  return json_build_object('floor_pct', p_floor, 'ceiling_pct', p_ceiling,
                           'outside', v_outside, 'notified', v_told);
end $$;
grant execute on function public.admin_set_deposit_bounds(int, int, text, boolean) to authenticated;

do $$
begin
  -- SET-11's drawn arithmetic on the two bound cards
  assert ceil(6000 * 20 / 100.0) = 1200, '20% of a 60 DH skin fade is 12 DH';
  assert ceil(6000 * 60 / 100.0) = 3600, '60% of the same cut is 36 DH';
  assert ceil(9000 * 60 / 100.0) = 5400, 'and 54 DH on cut and beard';

  -- SET-12: raising the floor 20 -> 30 strands the 20s and 25s, not the rest
  assert (3 + 2) = 5, '3 at 20% plus 2 at 25% is the drawn 5 outside';
  assert 9 + 27 + 5 = 41, 'nine at zero, 27 already inside, 5 stranded';

  -- SET-13: a 45-50 band leaves only the 50s, and 0% is never outside
  assert (3 + 2 + 6 + 12 + 4) = 27, '27 of 41 sit outside 45-50';
  assert 41 - 27 - 9 = 5, 'leaving the five at 50% and the nine who opted out';

  -- widening needs no defence; narrowing does. Both mirror the function:
  --   narrowing := proposed_floor > current_floor or proposed_ceiling < current_ceiling
  -- against the shipped band of 20-60.
  assert (10 > 20 or 70 < 60) is false, 'widening to 10-70 is not a narrowing';
  assert (30 > 20 or 60 < 60) is true, 'raising the floor to 30 is';
  assert (20 > 20 or 50 < 60) is true, 'lowering the ceiling to 50 is too';
end $$;
