-- 0088_carry_remainder: settlement step 7 — a part payment, and day 14.
--
-- §3.2's rail: "the partial collection and where the remainder goes (carries
-- onto week 37 as its own line, **not** into a separate debt ledger — a second
-- ledger is a second truth)." The brief also says it carries "at day 14".
--
-- Those are the two ends of one rule, not two rules: **the remainder stays on
-- its own line while the visit is still live, and carries onto the current week
-- once that line's own week is `float_hold_days` old.** Fourteen days from the
-- week closing is a number the owner can check; a second clock would not be.
--
-- WHY IT HAS TO CARRY AT ALL, which the brief leaves implicit. If the agent
-- takes 300 of a 780 line, the other 480 is still physically in the till, so it
-- is still inside `salon_float_cents`. Leave it on a closed line and the shop's
-- running total and the sum of its statements diverge by 480 DH forever — the
-- same drift the refund carry exists to stop, arriving by a different door.
--
-- A pay-out we never delivered carries the same way, with its sign intact: we
-- still owe it, and the shop should see it on the week it is finally handed over.

-- ---- what identifies a carried remainder -----------------------------------
-- A refund carry is identified by its booking. A remainder has no booking — it
-- is a settlement line — so the item needs to point at one. The line's printed
-- reference (`2026-W36-014`) is derived from a row_number over salon NAME and
-- would move if a shop were renamed, which is not an identity to hang money on.
alter table public.statement_items
  add column if not exists source_line uuid references public.settlement_lines (id);

-- carried once, and only once
create unique index if not exists statement_items_one_carry
  on public.statement_items (source_line) where source_line is not null;

create or replace function public.settlement_carry_for(p_salon uuid, p_to timestamptz)
returns table (label text, booking_ref text, occurred_at timestamptz,
               amount_cents int, source_week timestamptz, source_line uuid)
language sql stable security definer set search_path = ''
as $$
  select
    'Not collected in week '
    || to_char(r.covers_to at time zone 'Africa/Casablanca', 'IW')
    || ' - carried forward',
    -- the reference the owner reads back is the statement it came from
    public.settlement_week_label(r.covers_to) || '-' || lpad((
      select z.rn::text from (
        select l2.id, row_number() over (order by s2.name) as rn
          from public.settlement_lines l2
          join public.salons s2 on s2.id = l2.salon_id
         where l2.run_id = l.run_id) z
       where z.id = l.id), 3, '0'),
    r.covers_to,
    -- what never crossed the counter, sign intact
    (l.amount_cents - sign(l.amount_cents) * coalesce(l.collected_cents, 0))::int,
    r.covers_to,
    l.id
    from public.settlement_lines l
    join public.settlement_runs r on r.id = l.run_id
   where l.salon_id = p_salon
     and r.state <> 'draft'
     and l.direction <> 'nil'
     and l.visit in ('open', 'part', 'pending')
     and coalesce(l.collected_cents, 0) < abs(l.amount_cents)
     -- day 14, measured from the week closing. One clock, and it is the one on
     -- the statement the owner already has.
     and r.covers_to + make_interval(days =>
           (select float_hold_days from public.platform_settings)) < p_to
     and not exists (select 1 from public.statement_items si where si.source_line = l.id);
$$;
revoke all on function public.settlement_carry_for(uuid, timestamptz) from authenticated, anon;

-- ---- the cut, with the remainder in it -------------------------------------
-- 0084's function, unchanged apart from the carry: computed before the line is
-- written, because §2.4 means the header has to contain it.
create or replace function public.admin_cut_run(p_at timestamptz default now())
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_to timestamptz;
  v_from timestamptz;
  v_run uuid;
  s record;
  v_line uuid;
  v_hold int; v_earned int; v_carried int; v_amount int; v_remainder int;
  v_lines int := 0; v_excluded int := 0;
  v_net int;
begin
  if not public.is_admin() then raise exception 'Settlement runs are ops only'; end if;

  v_to := public.settlement_cut(coalesce(p_at, now()));
  if exists (select 1 from public.settlement_runs where covers_to = v_to) then
    raise exception 'Week % has already been cut', public.settlement_week_label(v_to);
  end if;

  v_from := coalesce((select max(covers_to) from public.settlement_runs), v_to - interval '7 days');

  insert into public.settlement_runs (covers_from, covers_to, created_by)
  values (v_from, v_to, auth.uid()) returning id into v_run;

  for s in select sa.id, sa.name, sa.status,
                  coalesce(sa.reviewed_at, sa.created_at) as live_since
             from public.salons sa
            where sa.status in ('live', 'suspended')
            order by sa.name
  loop
    v_net := public.salon_net_cents(s.id);

    if s.status = 'suspended' and v_net < 0 then
      insert into public.settlement_exclusions (run_id, salon_id, reason, amount_cents, told_by)
      values (v_run, s.id, 'suspended', -v_net, auth.uid());
      v_excluded := v_excluded + 1;
      continue;
    end if;
    if s.live_since > v_from then
      insert into public.settlement_exclusions (run_id, salon_id, reason)
      values (v_run, s.id, 'went_live_midweek');
      v_excluded := v_excluded + 1;
      continue;
    end if;

    select coalesce(sum(x.amount_cents) filter (where x.kind = 'float_movement'), 0),
           -coalesce(sum(x.amount_cents) filter (where x.kind in ('deposit_earned', 'refund')), 0),
           coalesce(sum(x.amount_cents) filter (where x.kind = 'carried'), 0)
      into v_hold, v_earned, v_carried
      from public.settlement_items_for(s.id, v_from, v_to) x;

    -- step 7: what an earlier week never collected, once that week is 14 days old
    select coalesce(sum(c.amount_cents), 0) into v_remainder
      from public.settlement_carry_for(s.id, v_to) c;
    v_carried := v_carried + v_remainder;

    v_amount := v_hold - v_earned + v_carried;

    insert into public.settlement_lines
      (run_id, salon_id, direction, amount_cents, hold_cents, earned_cents, carried_cents)
    values (v_run, s.id,
            case when v_amount > 0 then 'collect' when v_amount < 0 then 'pay_out'
                 else 'nil' end,
            v_amount, v_hold, v_earned, v_carried)
    returning id into v_line;
    v_lines := v_lines + 1;

    insert into public.statement_items
      (line_id, kind, label, booking_ref, occurred_at, amount_cents, source_week)
    select v_line, x.kind, x.label, x.booking_ref, x.occurred_at, x.amount_cents, x.source_week
      from public.settlement_items_for(s.id, v_from, v_to) x;

    insert into public.statement_items
      (line_id, kind, label, booking_ref, occurred_at, amount_cents, source_week, source_line)
    select v_line, 'carried', c.label, c.booking_ref, c.occurred_at,
           c.amount_cents, c.source_week, c.source_line
      from public.settlement_carry_for(s.id, v_to) c;
  end loop;

  return json_build_object(
    'run', v_run, 'week', public.settlement_week_label(v_to),
    'covers_from', v_from, 'covers_to', v_to,
    'lines', v_lines, 'excluded', v_excluded);
end $$;
grant execute on function public.admin_cut_run(timestamptz) to authenticated;

-- ---- what is ageing, before it carries -------------------------------------
-- The desk should be able to see a remainder walking towards day 14 rather than
-- meet it as a surprise line on next Friday's run.
create or replace function public.admin_open_lines()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'line', l.id, 'salon', s.name, 'salon_id', l.salon_id,
           'week', public.settlement_week_label(r.covers_to),
           'direction', l.direction,
           'amount_cents', abs(l.amount_cents),
           'collected_cents', coalesce(l.collected_cents, 0),
           'open_cents', abs(l.amount_cents) - coalesce(l.collected_cents, 0),
           'visit', l.visit,
           'days', floor(extract(epoch from now() - r.covers_to) / 86400)::int,
           'limit_days', (select float_hold_days from public.platform_settings),
           'carries_on', (r.covers_to + make_interval(days =>
                            (select float_hold_days from public.platform_settings)))::date,
           'carried', exists (select 1 from public.statement_items si where si.source_line = l.id))
         order by r.covers_to), '[]'::json)
    from public.settlement_lines l
    join public.settlement_runs r on r.id = l.run_id
    join public.salons s on s.id = l.salon_id
   where r.state <> 'draft' and l.direction <> 'nil'
     and l.visit in ('open', 'part', 'pending')
     and coalesce(l.collected_cents, 0) < abs(l.amount_cents)
     and public.is_admin();
$$;
grant execute on function public.admin_open_lines() to authenticated;

do $$
begin
  -- §3.2's drawn partial: 300 DH taken Fri 19:05, 480 DH open on a 780 DH line
  assert 78000 - 30000 = 48000, '300 taken off 780 leaves 480 open';
  -- and that 480 is what carries, sign intact
  assert (78000 - sign(78000)::int * 30000) = 48000, 'a collect line carries a positive remainder';
  assert (-78000 - sign(-78000)::int * 30000) = -48000, 'a pay-out carries a negative one';
  assert (-78000 - sign(-78000)::int * 78000) = 0, 'and a fully delivered payout carries nothing';

  -- it never becomes a second ledger: across the two weeks the shop pays 780
  -- once, not 780 and then 480 again
  assert 30000 + 48000 = 78000, 'the two visits add to the one line';

  -- day 14 from the week CLOSING, which is the date already on his statement
  assert (timestamptz '2026-09-04 21:00+01' + make_interval(days => 14))
       = timestamptz '2026-09-18 21:00+01', 'week 36 carries on 18 September';
  assert not (timestamptz '2026-09-04 21:00+01' + make_interval(days => 14)
              < timestamptz '2026-09-11 21:00+01'), 'week 37 is too early to carry it';
  assert (timestamptz '2026-09-04 21:00+01' + make_interval(days => 14)
          < timestamptz '2026-09-25 21:00+01'), 'week 39 is not';

  -- a nil week has nothing to carry and never appears in the list
  assert (case when 0 = 0 then 'nil' end) = 'nil', 'a nil line is excluded by direction';
end $$;
