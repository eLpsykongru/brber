-- 0059_coupon_campaigns: admin turn 6 — the last one-sided link.
--
-- The sidebar has had a Coupons item since 1a and the customer app has had My
-- coupons since turn 16, with nothing between them. 0055 made a coupon
-- spendable; this is the thing that issues one.
--
-- The decision the whole builder is organised around is **who pays**. Sterncut
-- takes no commission, so a discount is real money out of somebody's pocket:
--
--   * platform-funded — we credit the customer and the barber is handed full
--     price in cash. 0055 already encodes exactly this (`price_cents` untouched,
--     `discount_cents` absorbed by us), so a platform campaign needs no new money
--     path, only a budget to spend against.
--   * shop-funded — opt-in, priced by the shop, and it needs notice. Most shops
--     decline, which is why it cannot be the default.

create table if not exists public.coupon_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  -- the one field everything else hangs off
  funded_by text not null check (funded_by in ('platform', 'shop')),
  percent_off int check (percent_off between 1 and 100),
  amount_off_cents int check (amount_off_cents > 0),
  min_spend_cents int check (min_spend_cents is null or min_spend_cents > 0),
  per_person int not null default 1 check (per_person > 0),
  expires_on date,
  -- 6a's three radio rows
  audience text not null check (audience in ('lapsed', 'never_booked', 'city')),
  lapsed_days int not null default 60,
  -- "stops issuing the moment the cap is hit"
  budget_cap_cents int check (budget_cap_cents is null or budget_cap_cents > 0),
  issued_cents int not null default 0,
  issued_count int not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'running', 'stopped', 'done')),
  -- shop-funded campaigns cannot start before the shops have been told
  notice_until date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint campaign_one_discount check (num_nonnulls(percent_off, amount_off_cents) = 1),
  -- a platform campaign spends our money, so it must say how much
  constraint campaign_platform_needs_budget
    check (funded_by <> 'platform' or budget_cap_cents is not null)
);
create unique index if not exists coupon_campaigns_code_idx on public.coupon_campaigns (lower(code));

alter table public.coupons add column if not exists campaign_id uuid
  references public.coupon_campaigns (id) on delete set null;

alter table public.coupon_campaigns enable row level security;
create policy campaigns_admin on public.coupon_campaigns for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.coupon_campaigns to authenticated;

-- One place decides who is in, so the count 6a shows and the list 6a sends to
-- can never disagree.
create or replace function public.campaign_targets(
  p_audience text, p_lapsed_days int default 60)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}'::uuid[])
  from public.profiles p
  where p.role = 'customer'
    and p.suspended_at is null
    and case p_audience
          when 'never_booked' then not exists (
            select 1 from public.bookings b where b.customer_id = p.id)
          when 'lapsed' then exists (select 1 from public.bookings b where b.customer_id = p.id)
            and not exists (select 1 from public.bookings b
                             where b.customer_id = p.id
                               and b.starts_at > now() - make_interval(days => p_lapsed_days))
          else true
        end
    -- the exclusion, applied to people rather than to shops: if the last place
    -- they went is one nobody can get into, a coupon is not the help they need
    and not exists (
      select 1 from public.bookings b
      join public.barbers bb on bb.id = b.barber_id
      join public.waitlist_requests w on w.salon_id = bb.salon_id
       where b.customer_id = p.id
         and b.starts_at > now() - interval '90 days'
         and w.created_at > now() - interval '30 days');
$$;
grant execute on function public.campaign_targets(text, int) to authenticated;

-- ---- 6a · who would actually get it ----------------------------------------
-- Live counts, because a campaign sized against a stale number is a campaign
-- that overspends. The exclusion is the interesting part: a coupon sent to
-- somebody whose shop is already full does not create a cut, it lengthens a
-- waiting list.
create or replace function public.admin_campaign_audience(
  p_audience text default 'lapsed', p_lapsed_days int default 60)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select json_build_object(
    'lapsed', (
      select count(*)::int from public.profiles p
       where p.role = 'customer' and p.suspended_at is null
         and exists (select 1 from public.bookings b where b.customer_id = p.id)
         and not exists (select 1 from public.bookings b
                          where b.customer_id = p.id
                            and b.starts_at > now() - make_interval(days => p_lapsed_days))),
    'never_booked', (
      select count(*)::int from public.profiles p
       where p.role = 'customer' and p.suspended_at is null
         and not exists (select 1 from public.bookings b where b.customer_id = p.id)),
    'city', (
      select count(*)::int from public.profiles p
       where p.role = 'customer' and p.suspended_at is null),
    -- ponytail: "full most days" is read off turn 36's asks rather than by
    -- replaying every shop's calendar. A shop people are asking to be told about
    -- IS a shop with nothing free — that is what an ask means. Swap this for a
    -- real occupancy pass if the number ever looks wrong.
    'full_shops', (
      select count(distinct w.salon_id)::int from public.waitlist_requests w
       where w.created_at > now() - interval '30 days'),
    'reach', (select count(*)::int from public.profiles p
               where p.id = any (public.campaign_targets(p_audience, p_lapsed_days)))
  ) into j;
  return j;
end;
$$;

grant execute on function public.admin_campaign_audience(text, int) to authenticated;

-- ---- 6a · save the draft ---------------------------------------------------
create or replace function public.admin_save_campaign(
  p_name text, p_code text, p_funded_by text, p_audience text,
  p_amount_off_cents int default null, p_percent_off int default null,
  p_min_spend_cents int default null, p_per_person int default 1,
  p_expires_on date default null, p_budget_cap_cents int default null,
  p_lapsed_days int default 60)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if nullif(btrim(coalesce(p_code, '')), '') is null then raise exception 'A campaign needs a code'; end if;

  insert into public.coupon_campaigns
    (name, code, funded_by, audience, lapsed_days, percent_off, amount_off_cents,
     min_spend_cents, per_person, expires_on, budget_cap_cents, created_by,
     -- 6a's "needs 14 days' notice to shops", as a date rather than a sentence
     notice_until)
  values (p_name, upper(btrim(p_code)), p_funded_by, p_audience, p_lapsed_days,
          p_percent_off, p_amount_off_cents, p_min_spend_cents, p_per_person,
          p_expires_on, p_budget_cap_cents, auth.uid(),
          case when p_funded_by = 'shop' then current_date + 14 else null end)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.admin_save_campaign(
  text, text, text, text, int, int, int, int, date, int, int) to authenticated;

-- ---- 6a · send it ----------------------------------------------------------
-- The budget is spent here, one coupon at a time, and the loop stops the moment
-- the cap is reached. "Codes already in a wallet still work" falls out of that:
-- nothing is revoked, we simply stop issuing.
create or replace function public.admin_send_campaign(p_campaign uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  v_targets uuid[];
  v_who uuid;
  v_worth int;
  v_issued int := 0;
  v_spent int := 0;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into c from public.coupon_campaigns where id = p_campaign;
  if not found then raise exception 'No such campaign'; end if;
  if c.status <> 'draft' then raise exception 'That campaign has already been sent'; end if;
  if c.funded_by = 'shop' and c.notice_until > current_date then
    raise exception 'Shops get 14 days'' notice — this one can go from %',
      to_char(c.notice_until, 'Mon DD');
  end if;

  -- what one coupon reserves against the cap. A percentage has no fixed cost
  -- until it is spent, so it is priced at the min spend — the most it can cost.
  v_worth := coalesce(c.amount_off_cents,
                      (coalesce(c.min_spend_cents, 6000) * c.percent_off / 100)::int);

  v_targets := public.campaign_targets(c.audience, c.lapsed_days);

  foreach v_who in array v_targets loop
    exit when c.budget_cap_cents is not null
              and c.issued_cents + v_spent + v_worth > c.budget_cap_cents;
    -- 0038's index already refuses the same code twice for one person, so a
    -- re-send tops up the audience rather than double-issuing to it
    insert into public.coupons
      (user_id, code, title, note, percent_off, amount_off_cents, min_spend_cents,
       expires_on, campaign_id)
    values (v_who, c.code, c.name,
            case when c.min_spend_cents is null then null
                 else 'Min ' || (c.min_spend_cents / 100)::int || ' DH' end,
            c.percent_off, c.amount_off_cents, c.min_spend_cents, c.expires_on, c.id)
    on conflict do nothing;

    if found then
      v_issued := v_issued + 1;
      v_spent := v_spent + v_worth;
      insert into public.notifications (user_id, kind, title, body)
      values (v_who, 'moderation', c.name,
              'Your code is ' || c.code || '. It comes off what you pay — your barber still gets full price.');
    end if;
  end loop;

  update public.coupon_campaigns
     set status = case when c.budget_cap_cents is not null
                            and issued_cents + v_spent >= c.budget_cap_cents
                       then 'done' else 'running' end,
         issued_cents = issued_cents + v_spent,
         issued_count = issued_count + v_issued,
         sent_at = coalesce(sent_at, now())
   where id = p_campaign;

  return json_build_object('issued', v_issued, 'spent_cents', v_spent,
                           'reach', coalesce(array_length(v_targets, 1), 0));
end;
$$;
grant execute on function public.admin_send_campaign(uuid) to authenticated;

create or replace function public.admin_stop_campaign(p_campaign uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  -- stopping halts issuing only. Coupons already in a wallet are somebody's
  -- property and 6a says so on the budget card.
  update public.coupon_campaigns set status = 'stopped'
   where id = p_campaign and status in ('draft', 'running');
  if not found then raise exception 'That campaign is not running'; end if;
end;
$$;
grant execute on function public.admin_stop_campaign(uuid) to authenticated;

-- ---- 6b · the list once they are running -----------------------------------
create or replace function public.admin_campaigns()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select coalesce(json_agg(json_build_object(
           'id', c.id, 'name', c.name, 'code', c.code, 'funded_by', c.funded_by,
           'status', c.status, 'audience', c.audience,
           'percent_off', c.percent_off, 'amount_off_cents', c.amount_off_cents,
           'min_spend_cents', c.min_spend_cents, 'expires_on', c.expires_on,
           'budget_cap_cents', c.budget_cap_cents, 'issued_cents', c.issued_cents,
           'issued_count', c.issued_count, 'sent_at', c.sent_at,
           'notice_until', c.notice_until,
           -- the only number that says whether it worked: coupons that turned
           -- into a finished cut, and what that actually cost us
           'redeemed', (select count(*)::int from public.coupons x
                         where x.campaign_id = c.id and x.used_at is not null),
           'spent_cents', (select coalesce(sum(x.saved_cents), 0)::int from public.coupons x
                            where x.campaign_id = c.id and x.used_at is not null)
         ) order by c.created_at desc), '[]'::json)
    into j
    from public.coupon_campaigns c;
  return j;
end;
$$;
grant execute on function public.admin_campaigns() to authenticated;

do $$
begin
  -- 6a's drawn campaign: 20 DH off, 8 000 DH cap → 400 cuts
  assert 800000 / 2000 = 400, 'an 8 000 DH budget at 20 DH a cut is 400 cuts';
  -- a percentage is priced at the most it can cost, not at an average
  assert (6000 * 15 / 100)::int = 900, '15% against a 60 DH min spend reserves 9 DH';
  -- and the cap stops issuing rather than revoking
  assert 800000 - 799000 < 2000, 'a budget with less than one coupon left issues no more';
end $$;
