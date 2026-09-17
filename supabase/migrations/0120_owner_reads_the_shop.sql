-- 0120_owner_reads_the_shop: the owner's shop screens read other barbers' bookings.
-- Needs nothing after 0031 — safe to apply on its own, before or after 0118/0119.
--
-- OSH-02 (dashboard), OSH-03 (all chairs), OSH-07 (wall display) and the owner's
-- barber detail read `bookings` straight from the app, filtered to the team. But
-- bookings' only read policy (0001) is "you are the customer or the barber", so
-- every other barber's rows came back empty, silently: WAITING, the take, each
-- chair's row, the day lanes and the wall's queue counted the owner's own chair
-- alone. 0025 already said so ("an owner can't otherwise see co-barbers'
-- bookings") and solved it for the Team tab with a definer read; this is the same
-- answer for the four screens.
--
-- A read, not a policy: a new SELECT policy would also widen every screen that
-- leans on RLS to mean "mine" (earnings, clients, the day), and an owner cuts hair
-- too. And 0025's rule holds here as it does in salon_team and salon_report: a rent
-- barber's takings are never shown to the owner, so his rows carry no price.

create or replace function public.shop_bookings(p_from timestamptz, p_to timestamptz, p_barber uuid default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_out json;
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then raise exception 'Only the salon owner sees the shop''s bookings'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '31 days' then
    raise exception 'Ask for at most a month at a time';
  end if;

  select coalesce(json_agg(json_build_object(
           'id', bk.id,
           'barber_id', bk.barber_id,
           'starts_at', bk.starts_at,
           'ends_at', bk.ends_at,
           'status', bk.status,
           -- 0025: never a rent barber's money; his own and a commission barber's, yes
           'price_cents', case when b.id = auth.uid() or b.salon_role = 'owner' or b.pay_model = 'commission'
                               then bk.price_cents end,
           'walk_in_name', bk.walk_in_name,
           'customer_id', bk.customer_id,
           'checked_in_at', bk.checked_in_at,
           'started_at', bk.started_at,
           'completed_at', bk.completed_at,
           'services', case when sv.id is not null then json_build_object('name', sv.name) end,
           'customer', case when bk.customer_id <> bk.barber_id
                            then json_build_object('full_name', cp.full_name) end)
         order by bk.starts_at, bk.id), '[]'::json)
    into v_out
    from public.bookings bk
    join public.barbers b on b.id = bk.barber_id
    left join public.services sv on sv.id = bk.service_id
    left join public.profiles cp on cp.id = bk.customer_id
   where b.salon_id = v_salon
     and (p_barber is null or bk.barber_id = p_barber)
     and bk.starts_at >= p_from and bk.starts_at < p_to;
  return v_out;
end;
$$;

-- default privileges hand anon EXECUTE on anything new (0117): take it back by name
revoke execute on function public.shop_bookings(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.shop_bookings(timestamptz, timestamptz, uuid) to authenticated;

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  begin
    perform public.shop_bookings(now(), now() + interval '1 day');
    raise exception 'read a shop''s bookings with nobody signed in';
  exception when raise_exception then
    assert sqlerrm like 'Only the salon owner%', 'nobody signed in, no bookings: ' || sqlerrm;
  end;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not exists (
      select 1 from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace,
        aclexplode(p.proacl) a
       where ns.nspname = 'public' and p.proname = 'shop_bookings'
         and a.privilege_type = 'EXECUTE'
         and (a.grantee = 0 or a.grantee = 'anon'::regrole)),
      'the shop''s bookings are not readable without signing in';
  end if;
end $$;
