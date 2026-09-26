-- 0132_open_offer: BDY-06's "Open it to everyone" on a gap offer that expired unclaimed.
--
-- CancelledGap updated slot_offers directly, but the table only grants SELECT and has
-- no update policy (0049): the tap changed nothing, said nothing, and the gap never
-- reached the barber's public page. A function does it now, with the checks the
-- screen was taking on trust: his own offer, nobody has taken it, it wasn't
-- withdrawn, and the slot is still ahead. It stays open until the slot starts.

create or replace function public.open_offer_to_all(p_offer uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o record;
begin
  select * into o from public.slot_offers where id = p_offer;
  if not found then raise exception 'Offer not found'; end if;
  if o.barber_id is distinct from auth.uid() then raise exception 'Not your offer'; end if;
  if o.claimed_at is not null then raise exception 'Somebody already took it'; end if;
  if o.cancelled_at is not null then raise exception 'This offer was withdrawn'; end if;
  if o.starts_at <= now() then raise exception 'That slot has passed'; end if;
  update public.slot_offers set public_too = true, expires_at = o.starts_at where id = p_offer;
end;
$$;

-- default privileges hand anon EXECUTE on anything new (0117): take it back by name
revoke execute on function public.open_offer_to_all(uuid) from public, anon;
grant execute on function public.open_offer_to_all(uuid) to authenticated;

-- ---- checked at apply time ---------------------------------------------------
do $$
begin
  begin
    perform public.open_offer_to_all('00000000-0000-0000-0000-000000000000');
    raise exception 'opened an offer that does not exist';
  exception when raise_exception then
    assert sqlerrm = 'Offer not found', 'no offer: ' || sqlerrm;
  end;
end $$;
