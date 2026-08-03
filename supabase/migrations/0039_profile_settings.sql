-- 0039_profile_settings: 19a Settings, 19b Edit profile, 20a Delete account,
-- 20b Language picker.

alter table public.profiles
  add column if not exists language text not null default 'fr'
    check (language in ('fr', 'ary', 'ar', 'en', 'es')),
  add column if not exists dob date,
  add column if not exists preferred_barber_id uuid references public.barbers (id) on delete set null,
  add column if not exists usual_service text;

-- 0010 granted a fixed column list; the new ones need adding to it
grant update (full_name, phone, avatar_url, language, dob, preferred_barber_id, usual_service)
  on public.profiles to authenticated;

-- ---- 20a · delete account --------------------------------------------------
-- The mock blocks deletion while a deposit is live, and says deposits are not
-- refunded on delete. Rather than take the money and run, this refuses until
-- the booking is settled — the customer can cancel it themselves, and if the
-- barber cancels they get the deposit back first.
create or replace function public.delete_my_account(p_confirm text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  live int;
begin
  if upper(btrim(coalesce(p_confirm, ''))) <> 'DELETE' then
    raise exception 'Type DELETE to confirm';
  end if;

  select count(*) into live
  from public.bookings b
  where b.customer_id = auth.uid()
    and b.status in ('pending', 'confirmed')
    and b.completed_at is null
    and b.starts_at > now()
    and coalesce(b.deposit_cents, 0) > 0;
  if live > 0 then
    raise exception 'You have a live booking with a deposit — cancel it or let it complete first';
  end if;

  -- profiles cascades to bookings, chats, coupons, wallet rows and reviews;
  -- deleting the auth user is what actually ends the account
  delete from public.profiles where id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;
grant execute on function public.delete_my_account(text) to authenticated;

-- 19b's "PREFERRED BARBER · 4 visits" and the delete sheet's summary. One round
-- trip instead of three, and the visit count stays server-side where the rows are.
create or replace function public.my_account_summary()
returns table (
  wallet_cents int,
  active_coupons int,
  live_deposit_cents int,
  top_barber_id uuid,
  top_barber_visits int
)
language sql stable security definer set search_path = ''
as $$
  select
    (select coalesce(sum(amount_cents), 0)::int
       from public.wallet_transactions where user_id = auth.uid()),
    (select count(*)::int from public.coupons
       where user_id = auth.uid() and used_at is null
         and (expires_on is null or expires_on >= current_date)),
    (select coalesce(sum(deposit_cents), 0)::int from public.bookings
       where customer_id = auth.uid() and status in ('pending', 'confirmed')
         and completed_at is null and starts_at > now()),
    t.barber_id, t.visits
  from (
    select b.barber_id, count(*)::int as visits
    from public.bookings b
    where b.customer_id = auth.uid() and b.completed_at is not null
    group by b.barber_id order by count(*) desc limit 1
  ) t
  right join (select 1) one on true;
$$;
grant execute on function public.my_account_summary() to authenticated;
