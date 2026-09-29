-- 0135_founder_admins: for now the desk is two accounts, both Adil's.
--
--   · adil.boudraa3@gmail.com — HQ, full access ('*'). The first Head of Ops, so
--     it is the name asks are addressed to.
--   · adil.boudraa@sterncut.ma — full access too. Two heads, because one head can
--     never change or re-enrol their own account (0062/0133 refuse self-edits).
--     Narrow it on the Team page from the gmail account when the desk grows.
--   · Every other admin steps down. What each one held is written to
--     admin_cap_grants first, so it can be given back.
--
-- 0133 lets only @sterncut.ma addresses be staff. The gmail address is not one,
-- so the rule becomes "@sterncut.ma, or on staff_email_allowlist" — a table,
-- written by migration only, so letting another outside address in is a
-- reviewed change, never a click.
--
-- An account that doesn't exist yet is invited instead: the invite promotes it
-- the first time it signs in to admin.sterncut.ma (0133's admin_claim_invite),
-- once its email is confirmed.
--
-- !! A barber (or agent) account is never promoted: the app decides "barber" from
-- !! profiles.role, and an admin role would hide his barber screens. Staff use an
-- !! account of their own.

-- ---- who may be staff at all --------------------------------------------------
create table if not exists public.staff_email_allowlist (
  email text primary key check (email = lower(email)),
  note text not null,
  added_at timestamptz not null default now()
);
alter table public.staff_email_allowlist enable row level security;
drop policy if exists "staff_email_allowlist_select" on public.staff_email_allowlist;
create policy "staff_email_allowlist_select" on public.staff_email_allowlist for select to authenticated using (public.is_admin());
grant select on public.staff_email_allowlist to authenticated;

insert into public.staff_email_allowlist (email, note)
values ('adil.boudraa3@gmail.com', 'Founder, HQ — before the team is on @sterncut.ma')
on conflict (email) do nothing;

create or replace function public.staff_email_ok(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(coalesce(p_email, '')) ~ '^[^@\s]+@sterncut\.ma$'
      or exists (select 1 from public.staff_email_allowlist where email = lower(btrim(coalesce(p_email, ''))));
$$;

create or replace function public.is_admin()
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and public.staff_email_ok(auth.jwt() ->> 'email')
     and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- invites follow the same rule. They are only ever written by the functions
-- below (no insert grant), which check staff_email_ok, so the table keeps no
-- domain check of its own. An invite may have no inviter: the first admin of a
-- desk that has none is invited by this migration.
alter table public.staff_invites drop constraint if exists staff_invites_email_check;
alter table public.staff_invites alter column invited_by drop not null;

-- ---- a barber is never promoted ----------------------------------------------
create or replace function public.staff_promote(p_user uuid, p_role text, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_before text[]; v_was text;
begin
  select admin_caps, role into v_before, v_was from public.profiles where id = p_user;
  if v_was in ('barber', 'agent') then
    raise exception 'That account works in the app as a %. Staff sign in with an account of their own.', v_was;
  end if;
  update public.profiles set role = 'admin', admin_caps = public.staff_caps(p_role) where id = p_user;
  insert into public.admin_cap_grants (admin_id, changed_by, before_caps, after_caps)
  values (p_user, coalesce(p_by, p_user), coalesce(v_before, '{}'), public.staff_caps(p_role));
end $$;
revoke all on function public.staff_promote(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.admin_invite_colleague__direct(p_email text, p_role text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_user uuid;
begin
  if not public.admin_can('*') then raise exception 'Only the Head of Ops adds colleagues'; end if;
  if not public.staff_email_ok(v_email) then raise exception 'Only @sterncut.ma addresses can be staff'; end if;
  if public.staff_caps(p_role) is null then raise exception 'Pick one of the four roles'; end if;
  insert into public.staff_invites (email, role, invited_by) values (v_email, p_role, auth.uid())
  on conflict (email) do update set role = excluded.role, invited_by = excluded.invited_by,
                                    invited_at = now(), accepted_at = null, accepted_by = null;
  select u.id into v_user from auth.users u
   where lower(u.email) = v_email and u.email_confirmed_at is not null and u.deleted_at is null;
  if v_user is not null then
    perform public.staff_promote(v_user, p_role, auth.uid());
    update public.staff_invites set accepted_at = now(), accepted_by = v_user where email = v_email;
  end if;
  return json_build_object('email', v_email, 'accepted', v_user is not null);
end $$;

-- a barber signing in on the staff tab is told no, not half-promoted
create or replace function public.admin_claim_invite()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_email text; v_ok timestamptz; v_role text;
begin
  select lower(email), email_confirmed_at into v_email, v_ok from auth.users where id = auth.uid();
  if v_ok is null then return false; end if;
  select role into v_role from public.staff_invites where email = v_email and accepted_at is null;
  if v_role is null then return false; end if;
  if (select role from public.profiles where id = auth.uid()) in ('barber', 'agent') then return false; end if;
  perform public.staff_promote(auth.uid(), v_role, (select invited_by from public.staff_invites where email = v_email));
  update public.staff_invites set accepted_at = now(), accepted_by = auth.uid() where email = v_email;
  return true;
end $$;
grant execute on function public.admin_claim_invite() to authenticated;

-- ---- the two, and nobody else -------------------------------------------------
do $$
declare
  v_hq uuid; v_work uuid; v_by uuid; r record;
  v_hq_role text; v_work_role text;
begin
  select u.id, p.role into v_hq, v_hq_role from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = 'adil.boudraa3@gmail.com' and u.deleted_at is null;
  select u.id, p.role into v_work, v_work_role from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = 'adil.boudraa@sterncut.ma' and u.deleted_at is null;

  if v_hq_role in ('barber', 'agent') then
    raise notice 'adil.boudraa3@gmail.com is a % in the app — not promoted. Use another account for the desk.', v_hq_role;
    v_hq := null;
  end if;
  if v_work_role in ('barber', 'agent') then
    raise notice 'adil.boudraa@sterncut.ma is a % in the app — not promoted.', v_work_role;
    v_work := null;
  end if;
  v_by := coalesce(v_hq, v_work);

  if v_hq is not null then perform public.staff_promote(v_hq, 'head', v_hq); end if;
  if v_work is not null then perform public.staff_promote(v_work, 'head', v_by); end if;

  -- whichever doesn't exist yet is invited, and promoted at its first sign-in
  if v_hq is null and v_hq_role is null then
    insert into public.staff_invites (email, role, invited_by) values ('adil.boudraa3@gmail.com', 'head', v_by)
    on conflict (email) do nothing;
    raise notice 'adil.boudraa3@gmail.com has no account yet: sign up in the app with it, confirm the email, then sign in to admin.sterncut.ma.';
  end if;
  if v_work is null and v_work_role is null then
    insert into public.staff_invites (email, role, invited_by) values ('adil.boudraa@sterncut.ma', 'head', v_by)
    on conflict (email) do nothing;
    raise notice 'adil.boudraa@sterncut.ma has no account yet: create it (Supabase → Authentication → Add user, auto-confirm), then sign in to admin.sterncut.ma.';
  end if;

  -- everyone else steps down — but only once one of the two holds the desk,
  -- so this can never leave the platform with no admin at all
  if v_by is not null then
    for r in select id, admin_caps from public.profiles
              where role = 'admin' and id not in (coalesce(v_hq, v_by), coalesce(v_work, v_by)) loop
      insert into public.admin_cap_grants (admin_id, changed_by, before_caps, after_caps)
      values (r.id, v_by, r.admin_caps, '{}');
      update public.profiles set role = 'customer' where id = r.id;   -- 0062's trigger clears the caps
    end loop;
  else
    raise notice 'Neither account exists yet, so the current admins stay until one of them signs in.';
  end if;
end $$;

do $$
begin
  assert public.staff_email_ok('adil.boudraa3@gmail.com'), 'the HQ address is allowed';
  assert public.staff_email_ok('Adil.Boudraa@sterncut.ma'), 'any sterncut.ma address is allowed';
  assert not public.staff_email_ok('someone@gmail.com'), 'other outside addresses are not';
  assert not public.staff_email_ok('x@sterncut.ma.evil.com'), 'the domain is matched whole';
end $$;
