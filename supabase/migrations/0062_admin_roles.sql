-- 0062_admin_roles: the deferred "Roles & permissions" item (BACKLOG "Salon
-- management" → post-launch), scoped to the ops desk rather than the salon.
--
-- Today every admin is total. `profiles.role = 'admin'` is one bit, and the desk
-- has grown to 34 `admin_*` RPCs spanning money, moderation, shop approval and
-- growth. A new support hire cannot answer a ticket without also being able to
-- settle a float or remove a review.
--
-- **The constraint that shapes this migration:** `is_admin()` is called from 70
-- places across 17 migrations — RLS policies on profiles, barbers, reviews,
-- bookings, storage, and the guard clause of nearly every admin RPC. Narrowing
-- `is_admin()` would rewrite all 70 and risk locking the desk out of its own
-- console. So this is strictly **additive**:
--
--   · `is_admin()` keeps its exact meaning — "is any kind of admin". Untouched.
--   · `admin_can(capability)` is the new, finer question. Nothing calls it yet.
--
-- That means **this migration changes no behaviour**. Every existing admin is
-- backfilled to '*' (all capabilities), so the desk works exactly as it did the
-- minute before. Wiring individual RPCs to `admin_can()` is the next step, done
-- domain by domain, each one a visible change rather than a silent narrowing.

-- ---- the catalogue -----------------------------------------------------------
-- A table rather than a check constraint so the console can render the checkbox
-- list from the DB, and so adding a capability later is an insert, not an ALTER.

create table public.admin_capabilities (
  key text primary key,
  label text not null,
  blurb text not null,
  sort int not null default 0
);

insert into public.admin_capabilities (key, label, blurb, sort) values
  ('*',          'Full access',   'Everything, including granting these capabilities to others.', 0),
  ('support',    'Support',       'Read and answer support cases, issue the refunds they resolve.', 1),
  ('moderation', 'Moderation',    'Reviews, appeals, customer flags and suspensions.',              2),
  ('shops',      'Shops',         'Salon approval, compliance tasks, licence checks, districts.',   3),
  ('money',      'Money',         'Agent float settlement and wallet movement.',                    4),
  ('growth',     'Growth',        'Coupon campaigns and the demand map.',                           5),
  ('incidents',  'Incidents',     'Open and close desk incidents, which freeze money actions.',      6);

-- the catalogue is public-read to any admin (the console lists it); never written
-- from the client — it changes by migration only, so no insert/update/delete grant.
alter table public.admin_capabilities enable row level security;
create policy "admin_caps_select" on public.admin_capabilities for select to authenticated
  using (public.is_admin());
grant select on public.admin_capabilities to authenticated;

-- ---- who holds what ----------------------------------------------------------
-- An array on profiles, not a join table: it is read on every capability check,
-- it is always read whole, and it is never queried "who has X" outside the staff
-- list. `'*'` is the superadmin marker.

alter table public.profiles
  add column admin_caps text[] not null default '{}';

-- every element must name a real capability.
-- security definer: this fires on every profile write, including a customer's own
-- name change, and it reads the RLS-protected catalogue above. As the caller it
-- would see zero rows for a non-admin and reject a legitimate write; as the owner
-- it reads the catalogue the same way for everybody.
create or replace function public.admin_caps_valid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare bad text;
begin
  -- capabilities belong to the admin role. Demoting an admin drops them rather
  -- than erroring: losing the role IS losing the powers, and making ops clear
  -- them in a separate statement first only invites a half-done demotion.
  if new.role <> 'admin' then
    new.admin_caps := '{}';
    return new;
  end if;

  if new.admin_caps is null then new.admin_caps := '{}'; end if;
  -- de-dupe so '{support,support}' can't misreport in the staff list
  select coalesce(array_agg(distinct c order by c), '{}') into new.admin_caps
    from unnest(new.admin_caps) c;

  select c into bad from unnest(new.admin_caps) c
   where not exists (select 1 from public.admin_capabilities k where k.key = c)
   limit 1;
  if bad is not null then raise exception 'No such admin capability: %', bad; end if;

  return new;
end;
$$;
create trigger profiles_admin_caps_valid before insert or update on public.profiles
  for each row execute function public.admin_caps_valid();

-- 0001 revoked blanket UPDATE on profiles and re-granted a fixed column list
-- (0039 refreshed it). `admin_caps` is deliberately absent from that list, so an
-- admin cannot widen their own powers from the client — only `admin_set_caps`
-- below can, and only for someone else.

-- backfill: everyone who is an admin today keeps everything. No behaviour change.
update public.profiles set admin_caps = '{*}' where role = 'admin';

-- ---- the check ---------------------------------------------------------------
-- security definer + stable, mirroring is_admin() so it is equally safe to call
-- from an RLS policy without recursing.

create or replace function public.admin_can(p_cap text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_cap is not null and exists (   -- a null capability grants nothing
    select 1 from public.profiles
     where id = auth.uid()
       and role = 'admin'
       and (admin_caps @> array['*'] or admin_caps @> array[p_cap])
  );
$$;
grant execute on function public.admin_can(text) to authenticated;

-- ---- the audit ---------------------------------------------------------------
-- Who widened whose powers is exactly the kind of thing that must not be a
-- guess, so it is written down the same way review_actions (0042) is.

create table public.admin_cap_grants (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id) on delete cascade,  -- the subject
  changed_by uuid not null references public.profiles (id),                  -- the superadmin
  before_caps text[] not null,
  after_caps text[] not null,
  created_at timestamptz not null default now()
);
create index admin_cap_grants_admin_idx on public.admin_cap_grants (admin_id, created_at desc);

alter table public.admin_cap_grants enable row level security;
create policy "admin_cap_grants_select" on public.admin_cap_grants for select to authenticated
  using (public.is_admin());
grant select on public.admin_cap_grants to authenticated;
-- written only by admin_set_caps (security definer); no insert grant.

-- ---- setting them ------------------------------------------------------------

create or replace function public.admin_set_caps(p_admin uuid, p_caps text[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_before text[];
  v_role text;
  v_supers int;
begin
  if not public.admin_can('*') then
    raise exception 'Only a full-access admin can set capabilities';
  end if;
  -- Granting yourself is the one move that has no check above it: a superadmin
  -- editing their own row can only ever narrow it, and narrowing yourself out of
  -- '*' by accident is how a desk ends up with nobody who can grant anything.
  if p_admin = v_me then
    raise exception 'Ask another full-access admin to change your own capabilities';
  end if;

  select role, admin_caps into v_role, v_before from public.profiles where id = p_admin;
  if v_role is null then raise exception 'No such user'; end if;
  if v_role <> 'admin' then raise exception 'That user is not an admin'; end if;

  -- never leave the desk without someone who can grant capabilities
  if v_before @> array['*'] and not coalesce(p_caps, '{}') @> array['*'] then
    select count(*) into v_supers from public.profiles
     where role = 'admin' and admin_caps @> array['*'];
    if v_supers <= 1 then
      raise exception 'That is the last full-access admin — promote someone else first';
    end if;
  end if;

  update public.profiles set admin_caps = coalesce(p_caps, '{}') where id = p_admin;

  insert into public.admin_cap_grants (admin_id, changed_by, before_caps, after_caps)
  values (p_admin, v_me, v_before, coalesce(p_caps, '{}'));
end;
$$;
grant execute on function public.admin_set_caps(uuid, text[]) to authenticated;

-- ---- the staff list ----------------------------------------------------------
-- What the console's Roles screen reads. Any admin may see who else is on the
-- desk and what they hold — opacity about who can remove your review is not a
-- security property, and it is what makes "ask another full-access admin" above
-- an actionable instruction rather than a dead end.

create or replace function public.admin_staff()
returns table (
  admin_id uuid, full_name text, email text,
  caps text[], is_super boolean, is_me boolean,
  last_change timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select
    p.id,
    coalesce(p.full_name, 'Admin'),
    u.email::text,
    p.admin_caps,
    p.admin_caps @> array['*'],
    p.id = auth.uid(),
    (select max(g.created_at) from public.admin_cap_grants g where g.admin_id = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'admin'
    and public.is_admin()   -- no rows at all to a non-admin caller
  order by (p.admin_caps @> array['*']) desc, coalesce(p.full_name, '');
$$;
grant execute on function public.admin_staff() to authenticated;

-- ---- proof -------------------------------------------------------------------
do $$
begin
  -- '*' answers yes to anything; a named capability answers only for itself
  assert (array['*']::text[] @> array['*']), 'superadmin holds the star';
  assert (array['support','moderation']::text[] @> array['support']),
    'a named capability is held';
  assert not (array['support']::text[] @> array['money']),
    'support does not imply money';
  -- the backfill is what makes this migration a no-op on the running desk
  assert not exists (select 1 from public.profiles where role = 'admin' and admin_caps = '{}'),
    'every existing admin kept full access';
  -- and nobody who isn't an admin came out of it holding anything
  assert not exists (select 1 from public.profiles
                      where role <> 'admin' and array_length(admin_caps, 1) is not null),
    'capabilities exist only on admins';
end $$;
