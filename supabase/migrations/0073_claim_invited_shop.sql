-- 0073_claim_invited_shop: barber turn 12 — Brahim claims the shop Nadia created.
--
-- The other end of admin 11a. 0072 let ops create a shop with `owner_id` null
-- and an invite token on it; this is how that shop gets an owner.
--
-- The turn's framing decides the shape: "the shop already exists and he has to
-- recognise it — so the first screen is a confirmation, not a form, and the very
-- first thing he can do is say that's not my shop." So there are two verbs, not
-- one, and declining is not an error path — it is a supported answer.
--
-- Everything Nadia typed is editable, "because she typed it on a phone in a
-- doorway", so claim_salon takes the three fields back and writes them.
--
-- Note the ordering inside claim_salon. `barbers_membership_guard` (0031) forces
-- salon_status='pending' when a barber attaches to a salon he does not own, so
-- ownership has to land on the salon BEFORE the barber row points at it.
-- Reversed, the owner would be left waiting for his own approval.

-- What the link opens onto. Matched by token when it came from the SMS, and by
-- phone otherwise — the invite was typed against his number in the first place,
-- so a barber who just signs up normally still finds his shop waiting.
create or replace function public.my_invite(p_token text default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  s record;
  v_phone text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select replace(coalesce(phone, ''), ' ', '') into v_phone
    from public.profiles where id = auth.uid();

  select sa.id, sa.name, sa.address, sa.district, sa.invited_name, sa.invited_phone,
         sa.invited_at, sa.invite_token, sa.float_cap_cents,
         coalesce(ip.full_name, 'Ops') as invited_by_name
    into s
    from public.salons sa
    left join public.profiles ip on ip.id = sa.invited_by
   where sa.status = 'pending'
     and sa.invited_by is not null
     and sa.claimed_at is null
     and sa.dropped_at is null
     and (
       (p_token is not null and upper(sa.invite_token) = upper(btrim(p_token)))
       or (p_token is null and v_phone <> ''
           and replace(coalesce(sa.invited_phone, ''), ' ', '') = v_phone)
     )
   order by sa.invited_at desc
   limit 1;

  if not found then return json_build_object('invite', null); end if;

  return json_build_object('invite', json_build_object(
    'salon', s.id, 'name', s.name, 'address', s.address, 'district', s.district,
    'owner_name', s.invited_name, 'owner_phone', s.invited_phone,
    'invited_at', s.invited_at, 'invited_by', s.invited_by_name,
    'token', s.invite_token,
    -- 12a's "THREE THINGS LEFT", in its order
    'left', json_build_array('licence', 'pin', 'services')));
end;
$$;
grant execute on function public.my_invite(text) to authenticated;

create or replace function public.claim_salon(
  p_token text default null,
  p_name text default null, p_address text default null, p_district text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_phone text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select replace(coalesce(phone, ''), ' ', '') into v_phone
    from public.profiles where id = auth.uid();

  select sa.id into v_salon
    from public.salons sa
   where sa.status = 'pending' and sa.invited_by is not null
     and sa.claimed_at is null and sa.dropped_at is null
     and ((p_token is not null and upper(sa.invite_token) = upper(btrim(p_token)))
          or (p_token is null and v_phone <> ''
              and replace(coalesce(sa.invited_phone, ''), ' ', '') = v_phone))
   limit 1;
  if v_salon is null then raise exception 'That invite is not open any more'; end if;

  -- he is a barber from this moment, whatever he signed up as
  insert into public.barbers (id) values (auth.uid())
  on conflict (id) do nothing;

  -- ownership first — see the note at the top about the membership guard
  update public.salons
     set owner_id = auth.uid(),
         claimed_at = now(),
         name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         address = coalesce(nullif(btrim(coalesce(p_address, '')), ''), address),
         district = coalesce(nullif(btrim(coalesce(p_district, '')), ''), district)
   where id = v_salon;

  update public.barbers
     set salon_id = v_salon, salon_role = 'owner', salon_status = 'approved',
         status = case when status = 'rejected' then 'pending' else status end
   where id = auth.uid();

  update public.profiles set role = 'barber'
   where id = auth.uid() and role = 'customer';

  return json_build_object('salon', v_salon);
end;
$$;
grant execute on function public.claim_salon(text, text, text, text) to authenticated;

-- "This isn't my shop." Not an error — the first thing 12a offers him. The shop
-- goes back to ops rather than being deleted: somebody stood in a doorway and
-- typed it, and the lead is still real even if the number was wrong.
create or replace function public.decline_invite(p_token text default null, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_phone text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select replace(coalesce(phone, ''), ' ', '') into v_phone
    from public.profiles where id = auth.uid();

  select sa.id into v_salon
    from public.salons sa
   where sa.status = 'pending' and sa.invited_by is not null
     and sa.claimed_at is null and sa.dropped_at is null
     and ((p_token is not null and upper(sa.invite_token) = upper(btrim(p_token)))
          or (p_token is null and v_phone <> ''
              and replace(coalesce(sa.invited_phone, ''), ' ', '') = v_phone))
   limit 1;
  if v_salon is null then raise exception 'That invite is not open any more'; end if;

  update public.salons
     set dropped_at = now(),
         review_note = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Owner says it is not his shop')
   where id = v_salon;
end;
$$;
grant execute on function public.decline_invite(text, text) to authenticated;

-- 12b. The licence is the one blocker ops cannot clear for him, and 0054 already
-- warns nine days out — this is just the write, on your own row only.
create or replace function public.set_my_licence(p_expires date, p_path text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_expires is null then raise exception 'The expiry date is the part we check'; end if;
  if p_expires < current_date then
    raise exception 'That licence has already run out';
  end if;
  update public.barbers
     set licence_expires_at = p_expires,
         id_document_path = coalesce(nullif(btrim(coalesce(p_path, '')), ''), id_document_path)
   where id = auth.uid();
  if not found then raise exception 'You are not a barber yet'; end if;
end;
$$;
grant execute on function public.set_my_licence(date, text) to authenticated;
