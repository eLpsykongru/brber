-- 0027_barber_earnings: a per-barber commission statement DERIVED from bookings —
-- weekly gross → barber share → shop cut. This is an accrual, not a settlement:
-- no money has moved through us (Phase 1 = pay at shop; the settlement/payout rail
-- is Phase 2, see 0022 + BACKLOG). So there is no 'paid' state, no invoice record,
-- and no `payouts` table yet — everything returned here is outstanding/unsettled.
-- Privacy rule holds: a rent barber's revenue is never returned (their book is theirs).

create or replace function public.salon_barber_earnings(p_barber uuid)
returns table (period_start date, bookings int, gross_cents int, barber_cents int, shop_cents int)
language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid;
  v_split int;
  v_model text;
  v_from timestamptz := timezone('Africa/Casablanca',
    date_trunc('week', timezone('Africa/Casablanca', now())) - interval '7 weeks');
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner can view payouts'; end if;
  select b.commission_pct, b.pay_model into v_split, v_model
  from public.barbers b where b.id = p_barber and b.salon_id = v_salon;
  if not found then raise exception 'Not a member of your salon'; end if;
  if v_model <> 'commission' then return; end if; -- rent barber's revenue stays private

  return query
  with wk as (
    select date_trunc('week', timezone('Africa/Casablanca', bo.starts_at))::date ws, bo.price_cents
    from public.bookings bo
    where bo.barber_id = p_barber
      and bo.status in ('confirmed', 'completed')
      and bo.starts_at >= v_from
  )
  select ws, count(*)::int, sum(price_cents)::int,
         (sum(price_cents) * v_split / 100)::int,
         (sum(price_cents) - sum(price_cents) * v_split / 100)::int
  from wk group by ws order by ws desc;
end;
$$;

grant execute on function public.salon_barber_earnings(uuid) to authenticated;
