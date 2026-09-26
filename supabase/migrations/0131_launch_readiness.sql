-- 0131_launch_readiness: design_handoff_sterncut_launch parts 1 and 2 — the server
-- half of account deletion (DEL-01…06) and chat unread (MSG-01…08).
--
-- ---- 1 · deletion, as the handoff draws it ----------------------------------------
--
-- 0130 already erases the person and keeps the rows. The handoff moves four lines:
--   · more goes: chat messages and their photos, unused coupons, the barber's ID
--     document (the app removes the files; the rows go here);
--   · the rule differs by role. A customer is refused only while a booking with a
--     deposit is live — the rest of their upcoming bookings are cancelled on the way
--     out, so the barber is told and the chair frees. A barber has up to four
--     blockers, each with one way to clear it: client bookings ahead, a balance with
--     Sterncut either way, the shop's cash, and — owners only — a shop with other
--     barbers or an unpaid bill;
--   · a wallet balance can't be paid out, so it is forfeited: a `forfeit` row zeroes
--     it, and only after the customer ticked "I understand {amount} will be lost"
--     (p_accept_wallet_loss). Sterncut keeps it (decided with the owner 2026-09-26);
--     ledger_check counts it as leaving the wallets, or every forfeit would read as
--     drift;
--   · an owner whose shop has nobody else and owes nothing may leave, and the shop
--     closes with the account (decided 2026-09-26): status 'closed', bookings off,
--     the subscription cancelled so billing stops, pending join requests let go.
-- account_deletion_check() is the handoff's GET /account/deletion-check: the
-- screens draw from it, and delete_my_account() asks it again before doing anything.
--
-- ---- 2 · chat unread ----------------------------------------------------------------
--
-- A thread is a person, not a booking (lib/threads.ts), so the read mark is per
-- (reader, peer): chat_reads.last_read_at. Everything already said is marked read
-- here, or launch day would open on every old message as new.

-- ---- money: the forfeit ----------------------------------------------------------
alter table public.wallet_transactions alter column created_by drop not null;  -- a forfeit has no agent
alter table public.wallet_transactions drop constraint if exists wallet_transactions_kind_check;
alter table public.wallet_transactions add constraint wallet_transactions_kind_check
  check (kind in ('cash_topup', 'deposit', 'deposit_refund', 'referral', 'forfeit'));

-- callers only ever read `drift`; the new column says where forfeits went
drop function if exists public.ledger_check();
create function public.ledger_check()
returns table (cash_in bigint, platform_credits bigint, balances bigint,
               held bigint, to_shops bigint, forfeited bigint, drift bigint)
language sql stable security definer set search_path = ''
as $$
  with m as (
    select
      coalesce(sum(amount_cents) filter (where kind = 'cash_topup'), 0)::bigint as cash_in,
      coalesce(sum(amount_cents) filter (where kind = 'referral'), 0)::bigint   as credits,
      coalesce(-sum(amount_cents) filter (where kind = 'forfeit'), 0)::bigint   as forfeited,
      coalesce(sum(amount_cents), 0)::bigint                                    as balances
      from public.wallet_transactions
  ), h as (
    select
      coalesce(sum(amount_cents) filter (where state = 'held'), 0)::bigint    as held,
      coalesce(sum(amount_cents) filter (where state = 'to_shop'), 0)::bigint as to_shops
      from public.deposit_holds
  ), r as (
    select coalesce(sum(w.amount_cents), 0)::bigint as reversed
      from public.wallet_transactions w
      join public.deposit_holds dh on dh.booking_id = w.booking_id
     where w.kind = 'deposit_refund' and dh.state = 'to_shop'
  )
  select m.cash_in, m.credits, m.balances, h.held, (h.to_shops - r.reversed), m.forfeited,
         (m.cash_in + m.credits) - (m.balances + h.held + (h.to_shops - r.reversed) + m.forfeited)
    from m, h, r;
$$;
revoke all on function public.ledger_check() from public, authenticated, anon;

-- ---- a shop that closed with its owner's account ---------------------------------
alter table public.salons drop constraint if exists salons_status_check;
alter table public.salons add constraint salons_status_check
  check (status in ('pending', 'live', 'suspended', 'rejected', 'closed'));

-- ---- the check ---------------------------------------------------------------------
create or replace function public.account_deletion_check()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_role text;
  v_b record;
  v_s record;
  v_owned record;
  v_money int;
  v_till uuid;
  v_blockers json[] := '{}';
  v_barber json;
  v_n int;
  v_names json;
  v_bill int;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select p.role into v_role from public.profiles p where p.id = v_me and p.deleted_at is null;
  if v_role is null then raise exception 'This account is already deleted'; end if;

  if v_role = 'barber' then
    select b.id, b.salon_id, b.salon_status into v_b from public.barbers b where b.id = v_me;

    -- 1 · client bookings ahead (and his own deposit bookings elsewhere, which
    --     refuse the delete just the same)
    select count(*) into v_n from public.bookings k
     where k.status in ('pending', 'confirmed') and k.completed_at is null and k.ends_at > now()
       and (k.barber_id = v_me or (k.customer_id = v_me and coalesce(k.deposit_cents, 0) > 0));
    v_blockers := v_blockers || json_build_object('key', 'bookings', 'open', v_n > 0, 'n', v_n);

    -- 2 · the one number from BAC-01, plus any shortfall he still owes (0128).
    --     Positive: he owes Sterncut.
    v_money := coalesce((public.my_account() ->> 'net_cents')::int, 0)
      + coalesce((select sum(f.amount_cents) from public.barber_shortfalls f
                   where f.barber_id = v_me and f.status = 'open'), 0)::int;
    v_blockers := v_blockers || json_build_object('key', 'money', 'open', v_money <> 0, 'cents', v_money);

    -- 3 · the shop's cash, for anyone in a shop. A barber hands the drawer over
    --     before he goes; an owner holds it by default and only has to empty it.
    if v_b.salon_id is not null and v_b.salon_status = 'approved' then
      select s.id, s.owner_id into v_s from public.salons s where s.id = v_b.salon_id;
      v_till := public.till_of(v_s.id);
      v_blockers := v_blockers || json_build_object(
        'key', 'drawer',
        'open', (v_till = v_me and (v_s.owner_id <> v_me or not public.drawer_clear(v_s.id)))
                or exists (select 1 from public.drawer_transfers t
                            where t.salon_id = v_s.id and t.state in ('pending', 'mismatch')
                              and v_me in (t.from_id, t.to_id)),
        'cents', case when v_till = v_me then public.drawer_cents(v_s.id) else 0 end,
        'holder', (select p.full_name from public.profiles p where p.id = v_till),
        'is_owner', v_s.owner_id = v_me);
    end if;

    -- 4 · owners: a shop with other barbers, or an unpaid bill, goes through support
    select s.id, s.name into v_owned from public.salons s where s.owner_id = v_me limit 1;
    if v_owned.id is not null then
      select coalesce(json_agg(split_part(coalesce(p.full_name, ''), ' ', 1) order by p.full_name), '[]')
        into v_names
        from public.barbers b join public.profiles p on p.id = b.id
       where b.salon_id = v_owned.id and b.salon_status = 'approved' and b.id <> v_me;
      select coalesce(sum(st.balance_cents - st.pending_cents), 0)::int into v_bill
        from public.subscription_invoice_state st
       where st.salon_id = v_owned.id and st.status = 'open';
      v_blockers := v_blockers || json_build_object(
        'key', 'shop', 'open', json_array_length(v_names) > 0 or v_bill > 0,
        'shop', v_owned.name, 'names', v_names, 'bill_cents', greatest(v_bill, 0));
    end if;

    v_barber := json_build_object(
      'blockers', array_to_json(v_blockers),
      'bookings', (select count(*) from public.bookings k where k.barber_id = v_me),
      'reviews', (select count(*) from public.reviews r where r.barber_id = v_me));
  end if;

  return json_build_object(
    'role', v_role,
    'deposit_bookings', coalesce((
      select json_agg(json_build_object(
               'id', k.id, 'deposit_cents', k.deposit_cents, 'starts_at', k.starts_at,
               'service', sv.name, 'barber', bp.full_name, 'shop', sa.name) order by k.starts_at)
        from public.bookings k
        left join public.services sv on sv.id = k.service_id
        left join public.profiles bp on bp.id = k.barber_id
        left join public.barbers bb on bb.id = k.barber_id
        left join public.salons sa on sa.id = bb.salon_id
       where k.customer_id = v_me and k.customer_id <> k.barber_id
         and k.status in ('pending', 'confirmed') and k.completed_at is null and k.ends_at > now()
         and coalesce(k.deposit_cents, 0) > 0), '[]'),
    'wallet_cents', (select coalesce(sum(w.amount_cents), 0) from public.wallet_transactions w
                      where w.user_id = v_me),
    -- what goes: coupons nothing refers to. One a booking carries is that booking's record.
    'coupons', (select count(*) from public.coupons c
                 where c.user_id = v_me and c.used_at is null
                   and not exists (select 1 from public.bookings k where k.coupon_id = c.id)),
    'bookings', (select count(*) from public.bookings k
                  where k.customer_id = v_me and k.customer_id <> k.barber_id),
    'reviews', (select count(*) from public.reviews r where r.customer_id = v_me),
    'barber', v_barber);
end;
$$;

-- ---- the delete ----------------------------------------------------------------
-- A new argument, so the old signature goes (0057: a defaulted argument beside an
-- existing overload makes PostgREST refuse the call).
drop function if exists public.delete_my_account(text);
create or replace function public.delete_my_account(p_confirm text, p_accept_wallet_loss boolean default false)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_role text;
  v_check json;
  v_wallet int;
  v_owned uuid;
  v_imgs json;
  r record;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if upper(btrim(coalesce(p_confirm, ''))) <> 'DELETE' then
    raise exception 'Type DELETE to confirm';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_me and p.deleted_at is null;
  if v_role is null then raise exception 'This account is already deleted'; end if;
  if v_role not in ('customer', 'barber') then
    raise exception 'Staff accounts are closed by ops, not from the app';
  end if;

  -- the same answer the screen drew from, asked again now
  v_check := public.account_deletion_check();
  if json_array_length(v_check -> 'deposit_bookings') > 0 then
    raise exception 'A booking with a deposit is still live';
  end if;
  if v_check -> 'barber' is not null and exists (
       select 1 from json_array_elements(v_check -> 'barber' -> 'blockers') x
        where (x ->> 'open')::boolean) then
    raise exception 'Something still has to be cleared first';
  end if;
  v_wallet := (v_check ->> 'wallet_cents')::int;
  if v_wallet > 0 and not coalesce(p_accept_wallet_loss, false) then
    raise exception 'The wallet balance has to be accepted as lost';
  end if;

  -- a wallet can't be paid out in cash: it is forfeited, on the record
  if v_wallet > 0 then
    insert into public.wallet_transactions (user_id, kind, amount_cents)
    values (v_me, 'forfeit', -v_wallet);
  end if;

  -- the rest of a customer's upcoming bookings: cancelled the ordinary way, so the
  -- barber is told and the chair frees (none of these holds a deposit, see above)
  for r in select k.id from public.bookings k
            where k.customer_id = v_me and k.customer_id <> k.barber_id
              and k.status in ('pending', 'confirmed') and k.completed_at is null
              and k.starts_at > now() loop
    perform public.cancel_booking(r.id, 'Account deleted');
  end loop;

  -- a shop with nobody else in it and nothing owed closes with its owner
  select s.id into v_owned from public.salons s where s.owner_id = v_me limit 1;
  if v_owned is not null then
    update public.salons set status = 'closed', accepting_bookings = false where id = v_owned;
    update public.subscriptions set cancelled_at = now() where salon_id = v_owned and cancelled_at is null;
    update public.barbers set salon_id = null, salon_status = 'pending', salon_role = 'barber'
     where salon_id = v_owned and id <> v_me;
  end if;

  -- the person goes; the rows stay
  update public.profiles set
    full_name = null, phone = null, avatar_url = null, dob = null, usual_service = null,
    preferred_barber_id = null, referral_code = null, previous_name = null,
    name_changed_at = null, deleted_at = now()
  where id = v_me;

  update public.barbers set
    salon_id = null, salon_status = 'pending', salon_role = 'barber',
    pay_model = 'rent', commission_pct = 55, rent_cents = 0, chair_label = null,
    bio = null, specialty = null, years_experience = null, languages = '{}',
    id_document_path = null,
    short_code = public.new_barber_code(),   -- not null (0110): a fresh code kills the old link
    accepting_bookings = false
  where id = v_me;
  update public.services set is_active = false where barber_id = v_me;

  -- chat: what he said, and the photos he sent (the app removes the files)
  select coalesce(json_agg(m.image_path) filter (where m.image_path is not null), '[]')
    into v_imgs from public.messages m where m.sender_id = v_me;
  delete from public.messages where sender_id = v_me;
  delete from public.coupons c
   where c.user_id = v_me and c.used_at is null
     and not exists (select 1 from public.bookings k where k.coupon_id = c.id);

  delete from public.push_tokens where user_id = v_me;
  delete from public.wishlists where customer_id = v_me;
  delete from public.waitlist_requests where customer_id = v_me;
  delete from public.chat_reads where user_id = v_me;
  update public.searches set customer_id = null where customer_id = v_me;

  -- sign-in, for good. A far date rather than 'infinity', which Auth cannot parse.
  delete from auth.identities where user_id = v_me;
  delete from auth.sessions where user_id = v_me;
  update auth.users set
    email = null, phone = null, encrypted_password = null,
    raw_user_meta_data = '{}'::jsonb, banned_until = now() + interval '100 years',
    updated_at = now()
  where id = v_me;

  return json_build_object('chat_images', v_imgs);
end;
$$;

-- ---- chat unread ------------------------------------------------------------------
create table if not exists public.chat_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  peer_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);
alter table public.chat_reads enable row level security;
drop policy if exists chat_reads_own on public.chat_reads;
create policy chat_reads_own on public.chat_reads for select to authenticated
  using (user_id = auth.uid());
revoke all on public.chat_reads from anon;
revoke insert, update, delete on public.chat_reads from authenticated;
grant select on public.chat_reads to authenticated;

-- everything said before today counts as read
insert into public.chat_reads (user_id, peer_id, last_read_at)
select x.u, x.p, now() from (
  select k.customer_id as u, k.barber_id as p from public.bookings k
   where k.customer_id <> k.barber_id and exists (select 1 from public.messages m where m.booking_id = k.id)
  union
  select k.barber_id, k.customer_id from public.bookings k
   where k.customer_id <> k.barber_id and exists (select 1 from public.messages m where m.booking_id = k.id)
) x
on conflict do nothing;

-- per thread: how many of the peer's messages are newer than my read mark, and the
-- mark itself (the thread draws its NEW divider from it before it marks read)
create or replace function public.chat_unread()
returns table (peer_id uuid, unread int, last_read_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select k.id, case when k.customer_id = auth.uid() then k.barber_id else k.customer_id end as peer
      from public.bookings k
     where (k.customer_id = auth.uid() or k.barber_id = auth.uid()) and k.customer_id <> k.barber_id
  )
  select t.peer, count(m.id) filter (where m.created_at > coalesce(r.last_read_at, '-infinity'))::int,
         r.last_read_at
    from mine t
    join public.messages m on m.booking_id = t.id and m.sender_id <> auth.uid()
    left join public.chat_reads r on r.user_id = auth.uid() and r.peer_id = t.peer
   group by t.peer, r.last_read_at;
$$;

create or replace function public.mark_chat_read(p_peer uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.chat_reads (user_id, peer_id, last_read_at) values (auth.uid(), p_peer, now())
  on conflict (user_id, peer_id) do update set last_read_at = now();
end;
$$;

-- ---- BCF-02b · who the cash is for, before it is taken ------------------------------
-- The top-up sheet names the customer, their wallet and their visits before the agent
-- confirms, so a wrong digit is caught while the cash is still in the customer's hand.
-- The same match as agent_cash_topup (0127: the last nine digits, exactly one account)
-- and the same gate: only the shop's cash agent asks. Null when nothing (or more than
-- one account) matches — the sheet then shows no card, and the top-up says why.
create or replace function public.agent_find_customer(p_phone text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_id uuid;
  v_n int;
begin
  if not exists (select 1 from public.salons s where coalesce(s.cash_agent_id, s.owner_id) = auth.uid()) then
    raise exception 'Only the shop''s cash agent can take cash top-ups';
  end if;
  if length(v_digits) < 9 then return null; end if;
  select count(*), min(p.id::text)::uuid into v_n, v_id from public.profiles p
   where p.deleted_at is null and right(regexp_replace(p.phone, '\D', '', 'g'), 9) = v_digits;
  if v_n <> 1 then return null; end if;
  return (select json_build_object(
    'name', coalesce(p.full_name, ''),
    'wallet_cents', (select coalesce(sum(w.amount_cents), 0) from public.wallet_transactions w where w.user_id = v_id),
    'visits', (select count(*) from public.bookings k
                where k.customer_id = v_id and k.barber_id = auth.uid() and k.completed_at is not null))
    from public.profiles p where p.id = v_id);
end;
$$;

-- default privileges hand anon EXECUTE on anything new (0117): take it back by name
revoke execute on function public.agent_find_customer(text) from public, anon;
grant execute on function public.agent_find_customer(text) to authenticated;
revoke execute on function public.account_deletion_check() from public, anon;
grant execute on function public.account_deletion_check() to authenticated;
revoke execute on function public.delete_my_account(text, boolean) from public, anon;
grant execute on function public.delete_my_account(text, boolean) to authenticated;
revoke execute on function public.chat_unread() from public, anon;
grant execute on function public.chat_unread() to authenticated;
revoke execute on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- ---- the files that go through Storage ------------------------------------------
-- ID documents had no delete policy; chat photos had none either, and a folder is a
-- booking there, not a person, so the uploader is the test (owner_id).
drop policy if exists "id_docs_delete_own" on storage.objects;
create policy "id_docs_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'id-documents' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "chat_images_delete_own" on storage.objects;
create policy "chat_images_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images' and owner_id = auth.uid()::text);

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  begin
    perform public.account_deletion_check();
    raise exception 'checked with nobody signed in';
  exception when raise_exception then
    assert sqlerrm = 'Not signed in', 'no session: ' || sqlerrm;
  end;
  begin
    perform public.delete_my_account('DELETE');
    raise exception 'deleted with nobody signed in';
  exception when raise_exception then
    assert sqlerrm = 'Not signed in', 'no session: ' || sqlerrm;
  end;
  -- no forfeit exists yet, so the new column reads zero and the drift is unchanged
  assert (select forfeited from public.ledger_check()) = 0, 'forfeited before any forfeit';
end $$;
