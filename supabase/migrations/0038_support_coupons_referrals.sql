-- 0038_support_coupons_referrals: turns 17 and 18 of the customer design.
--   17a/17b  report a problem → a support case with a case number
--   18b      the case thread
--   16a/17c  coupons, active and used/expired
--   18a      invite friends
--
-- BACKLOG TRIGGER PULLED — "Promotions": the deferred item said a 5% badge
-- "needs a promotions table and application to the price once a payment rail
-- exists". The rail landed in 0035. Note what the design actually asks for
-- though: a coupon is a code you SHOW AT THE SHOP ("Show at the shop" on every
-- 16a card), not something applied to the deposit. So redemption is recorded,
-- not computed — no coupon touches bookings.price_cents.

-- ---- coupons ---------------------------------------------------------------
-- One table, two roles for a row: user_id null = an unclaimed template that
-- "Have a code?" can claim; user_id set = somebody's coupon. Two tables would
-- duplicate every column to express the same thing.
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  salon_id uuid references public.salons (id) on delete cascade,
  code text not null,
  title text not null,                              -- "Hair Services at Le Fade Tanger"
  note text,                                        -- "Min 40 DH · new customers only"
  percent_off int check (percent_off between 1 and 100),
  amount_off_cents int check (amount_off_cents > 0),
  expires_on date,
  used_at timestamptz,
  saved_cents int,
  used_for text,                                    -- "Hot Towel Shave"
  created_at timestamptz not null default now(),
  -- exactly one of the two discount shapes
  constraint coupons_one_discount check (num_nonnulls(percent_off, amount_off_cents) = 1)
);
create index coupons_user_idx on public.coupons (user_id, created_at desc);
create unique index coupons_template_code_idx on public.coupons (lower(code)) where user_id is null;
create unique index coupons_held_once_idx on public.coupons (user_id, lower(code)) where user_id is not null;

alter table public.coupons enable row level security;
-- only your own. Templates stay invisible: a code you have to be given is worth
-- less if the whole catalogue is one query away.
create policy coupons_select on public.coupons for select to authenticated
  using (user_id = auth.uid());
grant select on public.coupons to authenticated;
-- no insert grant: coupons arrive by claiming a code or as a referral reward

-- "Have a code?" on 16a. Copies the template onto the caller.
create or replace function public.claim_coupon(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  new_id uuid;
begin
  select * into t from public.coupons
    where user_id is null and lower(code) = lower(btrim(p_code));
  if not found then raise exception 'That code is not valid'; end if;
  if t.expires_on is not null and t.expires_on < current_date then
    raise exception 'That code has expired';
  end if;
  if exists (select 1 from public.coupons c
             where c.user_id = auth.uid() and lower(c.code) = lower(t.code)) then
    raise exception 'That code is already in your coupons';
  end if;

  insert into public.coupons
    (user_id, salon_id, code, title, note, percent_off, amount_off_cents, expires_on)
  values (auth.uid(), t.salon_id, t.code, t.title, t.note,
          t.percent_off, t.amount_off_cents, t.expires_on)
  returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.claim_coupon(text) to authenticated;

-- ---- support cases ---------------------------------------------------------
create sequence public.support_case_seq start 4821;   -- 17b's "#R-4821"

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  case_no text not null unique default 'R-' || lpad(nextval('public.support_case_seq')::text, 4, '0'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  reason text not null check (reason in
    ('no_show', 'wrong_amount', 'wrong_service', 'hygiene', 'other')),
  detail text,
  photo_path text,                                  -- inside the existing chat-images bucket
  amount_cents int,                                 -- 17b's "amount in dispute"
  status text not null default 'open' check (status in ('open', 'resolved')),
  refund_cents int,                                 -- 18b's resolution card
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index support_cases_user_idx on public.support_cases (user_id, created_at desc);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,  -- null = Sterncut Support
  author_name text,                                 -- "Nadia" on a support reply
  body text not null,
  created_at timestamptz not null default now()
);
create index support_messages_case_idx on public.support_messages (case_id, created_at);

alter table public.support_cases enable row level security;
alter table public.support_messages enable row level security;
create policy support_cases_own on public.support_cases for select to authenticated
  using (user_id = auth.uid());
create policy support_messages_own on public.support_messages for select to authenticated
  using (exists (select 1 from public.support_cases c
                 where c.id = case_id and c.user_id = auth.uid()));
create policy support_messages_reply on public.support_messages for insert to authenticated
  with check (sender_id = auth.uid()
    and exists (select 1 from public.support_cases c
                where c.id = case_id and c.user_id = auth.uid()));
grant select on public.support_cases to authenticated;
grant select, insert on public.support_messages to authenticated;
-- ponytail: there is no in-app support console. Replies and resolutions come
-- from the service role (Supabase dashboard) until support volume earns a UI.

-- 17a → 17b. The opening message is the customer's own words, so the thread in
-- 18b reads from the top without a special case for the first bubble.
create or replace function public.file_support_case(
  p_booking uuid, p_reason text, p_detail text default null,
  p_photo text default null, p_amount_cents int default null)
returns setof public.support_cases
language plpgsql security definer set search_path = ''
as $$
declare
  c public.support_cases%rowtype;
begin
  if p_booking is not null and not exists (
    select 1 from public.bookings b where b.id = p_booking and b.customer_id = auth.uid()
  ) then
    raise exception 'Not your booking';
  end if;

  insert into public.support_cases (user_id, booking_id, reason, detail, photo_path, amount_cents)
  values (auth.uid(), p_booking, p_reason, nullif(btrim(coalesce(p_detail, '')), ''),
          p_photo, p_amount_cents)
  returning * into c;

  if c.detail is not null then
    insert into public.support_messages (case_id, sender_id, body)
    values (c.id, auth.uid(), c.detail);
  end if;

  return next c;   -- the whole row, so the client never rebuilds it by hand
end;
$$;
grant execute on function public.file_support_case(uuid, text, text, text, int) to authenticated;

-- ---- referrals -------------------------------------------------------------
alter table public.profiles add column if not exists referral_code text unique;
alter table public.wallet_transactions drop constraint wallet_transactions_kind_check;
alter table public.wallet_transactions add constraint wallet_transactions_kind_check
  check (kind in ('cash_topup', 'deposit', 'deposit_refund', 'referral'));

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  invitee_id uuid not null unique references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  constraint referrals_not_self check (referrer_id <> invitee_id)
);
create index referrals_referrer_idx on public.referrals (referrer_id, created_at desc);

alter table public.referrals enable row level security;
create policy referrals_own on public.referrals for select to authenticated
  using (referrer_id = auth.uid() or invitee_id = auth.uid());
grant select on public.referrals to authenticated;

-- 18a's code. Generated on first view and kept: it goes out on paper and in
-- WhatsApp messages, so it must never change under someone.
create or replace function public.my_referral_code()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  existing text;
  base text;
  candidate text;
  n int := 0;
begin
  select referral_code into existing from public.profiles where id = auth.uid();
  if existing is not null then return existing; end if;

  select upper(regexp_replace(split_part(coalesce(full_name, 'friend'), ' ', 1), '[^a-zA-Z]', '', 'g'))
    into base from public.profiles where id = auth.uid();
  base := left(coalesce(nullif(base, ''), 'FRIEND'), 8);

  loop
    candidate := base || (20 + n)::text;
    exit when not exists (select 1 from public.profiles p where p.referral_code = candidate);
    n := n + 1;
    if n > 500 then candidate := base || substr(md5(random()::text), 1, 4); exit; end if;
  end loop;

  update public.profiles set referral_code = candidate where id = auth.uid();
  return candidate;
end;
$$;
grant execute on function public.my_referral_code() to authenticated;

-- The invitee side. "Your friend gets 20 DH off their first cut" — issued here
-- as a coupon; the referrer's 20 DH lands after the first completed visit.
create or replace function public.redeem_referral(p_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ref uuid;
begin
  select id into ref from public.profiles
    where referral_code = upper(btrim(p_code)) and id <> auth.uid();
  if ref is null then raise exception 'That invite code is not valid'; end if;
  if exists (select 1 from public.referrals r where r.invitee_id = auth.uid()) then
    raise exception 'You have already used an invite code';
  end if;
  if exists (select 1 from public.bookings b
             where b.customer_id = auth.uid() and b.completed_at is not null) then
    raise exception 'Invite codes are for your first visit';
  end if;

  insert into public.referrals (referrer_id, invitee_id) values (ref, auth.uid());
  insert into public.coupons (user_id, code, title, note, amount_off_cents, expires_on)
  values (auth.uid(), 'WELCOME20', 'Any service, any salon',
    'Invite reward · first visit', 2000, current_date + 60);
end;
$$;
grant execute on function public.redeem_referral(text) to authenticated;

-- The referrer's side, paid once the friend has actually been.
create or replace function public.reward_referrer()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  reward constant int := 2000;   -- 20 DH, matching 18a's headline
  r record;
begin
  if new.completed_at is null or old.completed_at is not null then return new; end if;

  select * into r from public.referrals
    where invitee_id = new.customer_id and status = 'pending';
  if not found then return new; end if;

  update public.referrals set status = 'rewarded', rewarded_at = now() where id = r.id;
  insert into public.wallet_transactions
    (user_id, salon_id, created_by, kind, amount_cents, booking_id)
  values (r.referrer_id, (select salon_id from public.barbers where id = new.barber_id),
          new.barber_id, 'referral', reward, new.id);
  return new;
end;
$$;

create trigger after_booking_reward_referrer
  after update on public.bookings
  for each row execute function public.reward_referrer();

-- the ledger notification already fans out by kind; teach it the new one
create or replace function public.notify_wallet_topup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who text;
  shop text;
begin
  select coalesce(p.full_name, 'a customer') into who
    from public.profiles p where p.id = new.user_id;
  select s.name into shop from public.salons s where s.id = new.salon_id;

  if new.kind = 'cash_topup' then
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (new.created_by, 'wallet',
      'Wallet top-up · ' || (new.amount_cents / 100) || ' DH',
      'You credited ' || who, new.amount_cents);
    insert into public.notifications (user_id, kind, title, body, amount_cents)
    values (new.user_id, 'wallet',
      (new.amount_cents / 100) || ' DH added to your wallet',
      coalesce(shop, 'Your barber') || ' took the cash', new.amount_cents);

  elsif new.kind = 'deposit_refund' then
    insert into public.notifications (user_id, kind, title, body, booking_id, amount_cents)
    values (new.user_id, 'wallet',
      (new.amount_cents / 100) || ' DH back in your wallet',
      coalesce(shop, 'The salon') || ' cancelled — deposit refunded',
      new.booking_id, new.amount_cents);

  elsif new.kind = 'referral' then
    insert into public.notifications (user_id, kind, title, body, booking_id, amount_cents)
    values (new.user_id, 'wallet',
      (new.amount_cents / 100) || ' DH referral reward',
      'Your friend has had their first cut', new.booking_id, new.amount_cents);
  end if;
  -- a 'deposit' debit needs no push: the customer just pressed the button
  return new;
end;
$$;

-- ponytail: the one check this file leaves behind — the coupon shape rule is
-- the only non-obvious constraint here, and a coupon that is somehow both 10%
-- and 20 DH off would be argued about at the counter.
do $$
begin
  assert num_nonnulls(10, null) = 1, 'percent-only coupon is valid';
  assert num_nonnulls(null, 2000) = 1, 'amount-only coupon is valid';
  assert num_nonnulls(10, 2000) <> 1, 'a coupon cannot be both';
  assert num_nonnulls(null::int, null::int) <> 1, 'a coupon must be one or the other';
end $$;
