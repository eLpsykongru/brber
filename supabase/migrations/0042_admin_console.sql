-- 0042_admin_console: what the admin desk (admin/index.html, design doc
-- "Admin Dashboard.dc.html") can DO. Three BACKLOG triggers land here; the read
-- side is 0043.
--
--   · Reviews moderation (2a/2c) — 0031 let a shop flag a review. Nothing could
--     hold or remove one, and no decision was ever written down.
--   · Platform shop approval (1f) — 0025 approves a barber INTO a salon. Nobody
--     ever approved the salon itself; new salons now start 'pending'.
--   · Agent float settlement (1d) — 0022: "settlement/netting … first thing to
--     build when real cash volume appears." This is the PLATFORM half: Sterncut
--     collects the till. 0031's salon_settlements is the owner↔barber half and
--     is not touched.
--
-- The admin role is NOT new. 0001 already has profiles.role = 'admin' and
-- is_admin(), and handle_new_user() only ever writes customer/barber, so it can
-- never be self-assigned. Mint one from the SQL editor (service role):
--     update public.profiles set role = 'admin' where id = '<uuid>';

-- ---- 2a/2c · a review can be held, and removed on the record ---------------

alter table public.reviews
  add column state text not null default 'public'
    check (state in ('public', 'held', 'removed')),
  -- the vocabulary is 2c's radio list: no free-text removals
  add column removal_reason text
    check (removal_reason in ('no_visit', 'abusive', 'personal_details',
                              'off_service', 'spam', 'duplicate')),
  add column customer_note text,        -- 2c's "note to the customer", sent to the author
  add column moderated_at timestamptz,
  add column moderated_by uuid references public.profiles (id);

create index reviews_state_idx on public.reviews (state, created_at desc);

-- anything a shop already flagged under 0031 is waiting on us
update public.reviews set state = 'held' where flagged_at is not null;

-- A removed review leaves the public record. Its author still sees it (so the
-- takedown isn't silent) and 2b lists every one of them for us.
drop policy "reviews_select" on public.reviews;
create policy "reviews_select" on public.reviews for select to authenticated
  using (state <> 'removed' or customer_id = auth.uid() or public.is_admin());

-- Flagging now parks the review in the queue. 0031's version only date-stamped
-- it, which left a flagged review indistinguishable from an untouched one.
create or replace function public.review_flag(p_review uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_barber uuid;
begin
  select barber_id into v_barber from public.reviews where id = p_review;
  if v_barber is null then raise exception 'Review not found'; end if;
  if not public.review_can_moderate(v_barber) then raise exception 'Not your shop'; end if;
  update public.reviews
     set flagged_at = now(),
         state = case when state = 'public' then 'held' else state end
   where id = p_review;
end;
$$;

-- 2c's last line: "logged against you, Nadia Lahlou — visible to any admin and
-- in the monthly audit". That log is this table.
create table public.review_actions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  admin_id uuid not null references public.profiles (id),
  action text not null check (action in ('keep', 'remove')),
  reason text,
  note text,
  created_at timestamptz not null default now()
);
create index review_actions_idx on public.review_actions (review_id, created_at desc);

alter table public.review_actions enable row level security;
create policy review_actions_admin on public.review_actions for select to authenticated
  using (public.is_admin());
grant select on public.review_actions to authenticated;
-- no insert grant: rows only appear through admin_review_decide()

create or replace function public.admin_review_decide(
  p_review uuid, p_action text, p_reason text default null, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_action not in ('keep', 'remove') then raise exception 'Bad action'; end if;
  -- 2c: a removal always carries a policy reason. "The barber disagrees" isn't one.
  if p_action = 'remove' and coalesce(p_reason, '') = '' then
    raise exception 'A removal needs a policy reason';
  end if;

  update public.reviews
     set state          = case when p_action = 'remove' then 'removed' else 'public' end,
         removal_reason = case when p_action = 'remove' then p_reason end,
         customer_note  = case when p_action = 'remove' then v_note end,
         flagged_at     = null,
         moderated_at   = now(),
         moderated_by   = auth.uid()
   where id = p_review
   returning customer_id, barber_id into r;
  if not found then raise exception 'Review not found'; end if;

  insert into public.review_actions (review_id, admin_id, action, reason, note)
  values (p_review, auth.uid(), p_action, p_reason, v_note);

  -- 2c's "REMOVE & NOTIFY BOTH" — in-app rows now, push rides the same rail
  -- the moment a dev build exists (0037).
  if p_action = 'remove' then
    insert into public.notifications (user_id, kind, title, body) values
      (r.customer_id, 'moderation', 'Your review was taken down',
       coalesce(v_note, 'It did not meet our review policy.')),
      (r.barber_id, 'moderation', 'A review was removed from your profile',
       'Moderation took it down. Your rating has been updated.');
  end if;
end;
$$;
grant execute on function public.admin_review_decide(uuid, text, text, text) to authenticated;

-- ---- 1f · the platform approves the shop, not only the barber --------------

alter table public.salons
  add column status text not null default 'live'
    check (status in ('pending', 'live', 'suspended', 'rejected')),
  add column submitted_at timestamptz,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.profiles (id),
  add column review_note text;

create index salons_status_idx on public.salons (status, submitted_at);

-- Every shop that exists today keeps working: the default grandfathers them in
-- as 'live', same move as 0028's all-day opening window. Only shops created from
-- here on go through the queue.
update public.salons set submitted_at = created_at where submitted_at is null;

-- 0025's version defaulted the cash agent; a new shop is now also an application.
create or replace function public.salons_defaults()
returns trigger language plpgsql as $$
begin
  new.cash_agent_id := coalesce(new.cash_agent_id, new.owner_id);
  new.status        := 'pending';
  new.submitted_at  := coalesce(new.submitted_at, now());
  return new;
end;
$$;

-- A pending or rejected shop is not a storefront. Its owner still sees it (the
-- barber app would break otherwise) and so do we.
drop policy "salons_select" on public.salons;
create policy "salons_select" on public.salons for select to authenticated
  using (status = 'live' or owner_id = auth.uid() or public.is_admin());

create or replace function public.admin_salon_decide(
  p_salon uuid, p_action text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  v_status text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_action not in ('approve', 'reject', 'suspend', 'restore') then
    raise exception 'Bad action';
  end if;
  select id, owner_id, name, lat, lng into s from public.salons where id = p_salon;
  if not found then raise exception 'Salon not found'; end if;

  -- 1f: "Approve is locked until the map pin is confirmed — customers can't find
  -- a shop we can't place." The rule lives here, not in the console.
  if p_action in ('approve', 'restore') and (s.lat is null or s.lng is null) then
    raise exception 'Confirm the map pin before this shop goes live';
  end if;

  v_status := case p_action
                when 'approve' then 'live'
                when 'restore' then 'live'
                when 'reject'  then 'rejected'
                else 'suspended' end;

  update public.salons
     set status = v_status, reviewed_at = now(), reviewed_by = auth.uid(),
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_salon;

  insert into public.notifications (user_id, kind, title, body)
  values (s.owner_id, 'moderation',
          case v_status
            when 'live'      then s.name || ' is live'
            when 'rejected'  then 'Your shop application was declined'
            else s.name || ' has been suspended' end,
          coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                   case v_status
                     when 'live' then 'Customers can find you in Explore from now.'
                     else 'Reply to this to talk to us about it.' end));
end;
$$;
grant execute on function public.admin_salon_decide(uuid, text, text) to authenticated;

-- ---- 1d · the platform collects the till -----------------------------------
-- Bookkeeping, not a payment rail — exactly like 0022's cash top-ups. A row here
-- says "we took this much cash off this shop", nothing debits anything.

create table public.float_settlements (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id),
  amount_cents int not null check (amount_cents > 0),
  covers_to timestamptz not null default now(),
  settled_by uuid not null references public.profiles (id),   -- the admin who collected
  note text,
  created_at timestamptz not null default now()
);
create index float_settlements_idx on public.float_settlements (salon_id, created_at desc);

alter table public.float_settlements enable row level security;
-- we see everything; the agent sees what we took off him
create policy float_settlements_select on public.float_settlements for select to authenticated
  using (public.is_admin()
         or exists (select 1 from public.salons s
                    where s.id = float_settlements.salon_id and s.owner_id = auth.uid()));
grant select on public.float_settlements to authenticated;
-- no insert grant: rows only appear through admin_settle_float()

-- Float = cash that physically went into the drawer, minus what we have picked
-- up. Deposits and refunds move numbers inside a ledger we already own and never
-- touch the drawer, so only 'cash_topup' counts.
create or replace function public.salon_float_cents(p_salon uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select (
    coalesce((select sum(w.amount_cents) from public.wallet_transactions w
              where w.salon_id = p_salon and w.kind = 'cash_topup'), 0)
    - coalesce((select sum(f.amount_cents) from public.float_settlements f
                where f.salon_id = p_salon), 0)
  )::int;
$$;
grant execute on function public.salon_float_cents(uuid) to authenticated;

-- ponytail: the one check this money path leaves behind. The two coalesces are
-- the whole trick — a shop that never took cash has to read 0, because
-- admin_settle_float compares against this and `x > null` is null, which would
-- wave through a settlement of any size.
do $$
begin
  assert public.salon_float_cents('00000000-0000-0000-0000-000000000000') = 0,
    'float of a shop with no history must be 0, never null';
end $$;

create or replace function public.admin_settle_float(
  p_salon uuid, p_amount_cents int, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_float int;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Amount must be more than zero'; end if;
  v_float := public.salon_float_cents(p_salon);
  if p_amount_cents > v_float then
    raise exception 'That shop is only holding % DH', (v_float / 100.0)::numeric(12,2);
  end if;

  insert into public.float_settlements (salon_id, amount_cents, settled_by, note)
  values (p_salon, p_amount_cents, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.admin_settle_float(uuid, int, text) to authenticated;

-- ---- 1e · support answers from the desk ------------------------------------
-- 0038 shipped the customer half and said so: "there is no in-app support
-- console. Replies and resolutions come from the service role until support
-- volume earns a UI." This is that UI's backend.

-- An admin refunding a deposit is not a barber, and created_by pointed at
-- barbers. Repointing it at profiles is safe with no data migration: barbers.id
-- references profiles.id, so every id already in the column is a valid profile
-- (same argument as 0037's rename).
alter table public.wallet_transactions
  drop constraint wallet_transactions_created_by_fkey,
  add constraint wallet_transactions_created_by_fkey
    foreign key (created_by) references public.profiles (id);

create or replace function public.admin_support_reply(p_case uuid, p_body text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_user uuid;
  v_name text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if v_body is null then raise exception 'Nothing to send'; end if;
  select user_id into v_user from public.support_cases where id = p_case;
  if v_user is null then raise exception 'Case not found'; end if;
  select coalesce(full_name, 'Sterncut Support') into v_name
    from public.profiles where id = auth.uid();

  insert into public.support_messages (case_id, sender_id, author_name, body)
  values (p_case, auth.uid(), v_name, v_body);

  insert into public.notifications (user_id, kind, title, body)
  values (v_user, 'moderation', 'Support replied', v_body);
end;
$$;
grant execute on function public.admin_support_reply(uuid, text) to authenticated;

-- 1e's "REFUND 20 DH & CLOSE" — one call, because a refund that closes nothing
-- and a close that refunds nothing are the two ways this goes wrong.
create or replace function public.admin_support_resolve(
  p_case uuid, p_refund_cents int default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id, user_id, booking_id, status into c
    from public.support_cases where id = p_case;
  if not found then raise exception 'Case not found'; end if;
  if c.status = 'resolved' then raise exception 'Case is already closed'; end if;
  if coalesce(p_refund_cents, 0) < 0 then raise exception 'Bad refund amount'; end if;

  if coalesce(p_refund_cents, 0) > 0 then
    insert into public.wallet_transactions
      (user_id, salon_id, created_by, kind, amount_cents, booking_id)
    values (c.user_id,
            (select b.salon_id from public.bookings bk
               join public.barbers b on b.id = bk.barber_id
              where bk.id = c.booking_id),
            auth.uid(), 'deposit_refund', p_refund_cents, c.booking_id);
  end if;

  update public.support_cases
     set status = 'resolved', resolved_at = now(), refund_cents = p_refund_cents
   where id = p_case;

  insert into public.notifications (user_id, kind, title, body, amount_cents)
  values (c.user_id, 'moderation', 'Your case is resolved',
          case when coalesce(p_refund_cents, 0) > 0
               then (p_refund_cents / 100)::text || ' DH is back in your wallet.'
               else 'We have closed this case.' end,
          p_refund_cents);
end;
$$;
grant execute on function public.admin_support_resolve(uuid, int) to authenticated;
