-- 0133_staff_site: admin.sterncut.ma, one site for staff and shop owners
-- (design_handoff_admin_owner_site). Four things the website needs from the
-- database, so that none of them is only a hidden button:
--
--   1. Staff sessions need the authenticator code. `is_admin()` now also requires
--      aal2 (a session that passed TOTP) and an @sterncut.ma email. It guards ~70
--      RLS policies and RPCs, so a stolen password alone reads nothing.
--      !! Every current admin must enrol an authenticator on the new site before
--      !! anything admin works again, and their auth email must end @sterncut.ma
--      !! (edit it in Supabase → Authentication → Users if it doesn't).
--   2. SET-03's permission matrix, enforced. Each gated `admin_*` write now runs
--      `staff_gate()` first: allowed → it runs; "ask" → it raises `ask:<key>` and
--      changes nothing, and the page files the ask with `admin_ask()`; "—" → it
--      raises `deny:<key>`. Only a '*' holder (Head of Ops) decides an ask, and the
--      approved call is re-run as her from the stored name and arguments.
--   3. Requests (`staff_asks`): the ask inbox, and the audit trail of refusals.
--   4. Shop slugs, so an owner's pages live at /{slug}/…, and `owner_shop(slug)`
--      answers not_found for any slug the caller doesn't own.
--
-- !! HOW THE GATE IS WIRED: each gated function `admin_x` is renamed
-- !! `admin_x__direct` (execute revoked) and a same-signature `admin_x` wrapper
-- !! calls the gate, then it. To change a gated function from now on, replace
-- !! `admin_x__direct`. Replacing `admin_x` would silently drop its gate —
-- !! .sqlcheck.cjs refuses a later migration that does it.

-- ---- 1 · staff sessions ------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and lower(coalesce(auth.jwt() ->> 'email', '')) like '%@sterncut.ma'
     and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.admin_can(p_cap text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_cap is not null and public.is_admin() and exists (
    select 1 from public.profiles
     where id = auth.uid()
       and (admin_caps @> array['*'] or admin_caps @> array[p_cap])
  );
$$;

-- The four roles the site names. A role is a reading of the capabilities, not a
-- second column that could disagree with them.
create or replace function public.staff_role(p_caps text[])
returns text language sql immutable as $$
  select case
    when p_caps @> array['*'] then 'head'
    when p_caps @> array['support'] then 'support'
    when p_caps @> array['moderation'] then 'mod'
    else 'field' end;
$$;

-- ---- 2 · the matrix ------------------------------------------------------------
-- One row per decision. `allow` acts directly, `ask` may ask Karima, anyone
-- else gets "—". '*' always acts. The first nine rows are SET-03 as drawn; the
-- last six cover the desk's other writes by domain (not drawn — see BACKLOG).
create table if not exists public.staff_actions (
  key text primary key,
  label text not null,
  did text not null,                 -- the same, done: SET-02's "last action"
  allow text[] not null default '{}',
  ask text[] not null default '{}',
  sort int not null default 0
);
insert into public.staff_actions (key, label, did, allow, ask, sort) values
  ('refund_small',  'Refund up to 200 DH',                'Refunded a customer',          '{support,shops}','{}',             1),
  ('refund_large',  'Refund above 200 DH',                'Refunded over 200 DH',         '{}',             '{support,shops}',2),
  ('verify_licence','Verify a shop licence',              'Verified a licence',           '{shops}',        '{}',             3),
  ('remove_review', 'Remove a review',                    'Moderated a review',           '{moderation}',   '{}',             4),
  ('suspend_shop',  'Suspend a shop',                     'Suspended or reopened a shop', '{}',             '{support,shops}',5),
  ('refuse_shop',   'Refuse a shop permanently',          'Refused a shop',               '{}',             '{}',             6),
  ('ban_customer',  'Ban or anonymise a customer',        'Sanctioned a customer',        '{}',             '{support}',      7),
  ('platform_rule', 'Change a platform rule',             'Changed a platform rule',      '{}',             '{}',             8),
  ('colleague',     'Add or remove a colleague',          'Changed the team',             '{}',             '{}',             9),
  ('money',         'Settle, release or write off money', 'Moved money',                  '{money}',        '{shops}',        10),
  ('support',       'Answer and close a case',            'Answered a case',              '{support}',      '{}',             11),
  ('moderation',    'Appeals and customer flags',         'Decided an appeal or flag',    '{moderation}',   '{}',             12),
  ('shops',         'Open shops, invites and tasks',      'Worked on a shop',             '{shops}',        '{}',             13),
  ('growth',        'Campaigns',                          'Ran a campaign',               '{growth}',       '{}',             14),
  ('incidents',     'Open or close an incident',          'Opened or closed an incident', '{incidents}',    '{}',             15)
on conflict (key) do update set label = excluded.label, did = excluded.did, allow = excluded.allow, ask = excluded.ask, sort = excluded.sort;

alter table public.staff_actions enable row level security;
drop policy if exists "staff_actions_select" on public.staff_actions;
create policy "staff_actions_select" on public.staff_actions for select to authenticated using (public.is_admin());
grant select on public.staff_actions to authenticated;

-- Which function is which decision. Two depend on their arguments (staff_key).
create table if not exists public.staff_rpcs (
  rpc text primary key,
  key text not null references public.staff_actions (key)
);
insert into public.staff_rpcs (rpc, key) values
  ('admin_support_resolve', 'refund_small'),  -- refund_large above 200 DH
  ('admin_salon_decide', 'verify_licence'),   -- suspend/restore, reject: see staff_key
  ('admin_review_decide', 'remove_review'),
  ('admin_set_suspension', 'ban_customer'),
  ('admin_set_caps', 'colleague'),
  ('admin_save_reliability', 'platform_rule'),
  ('admin_set_deposit_bounds', 'platform_rule'),
  ('admin_set_writeoff_alert', 'platform_rule'),
  ('admin_settle_float', 'money'), ('admin_settle_line', 'money'), ('admin_settle_all', 'money'),
  ('admin_cut_run', 'money'), ('admin_release_run', 'money'), ('admin_exclude_shop', 'money'),
  ('admin_carry_correction', 'money'), ('admin_plan_visits', 'money'),
  ('admin_resolve_drawer_transfer', 'money'), ('admin_write_off_transfer', 'money'),
  ('admin_write_off_shortfall', 'money'), ('admin_reverse_writeoff', 'money'),
  ('admin_write_off_invoice', 'money'), ('admin_record_subscription_cash', 'money'),
  ('admin_start_billing', 'money'), ('admin_run_billing', 'money'), ('admin_set_float_cap', 'money'),
  ('admin_support_reply', 'support'), ('admin_take_case', 'support'), ('admin_open_case', 'support'),
  ('admin_decide_appeal', 'moderation'), ('admin_reassign_appeal', 'moderation'), ('admin_clear_flag', 'moderation'),
  ('admin_create_salon', 'shops'), ('admin_invite_action', 'shops'), ('admin_issue_task', 'shops'),
  ('admin_task_action', 'shops'), ('admin_set_district', 'shops'), ('admin_request_drawer_count', 'shops'),
  ('admin_ops_call_open', 'shops'), ('admin_ops_call_action', 'shops'),
  ('admin_ops_call_agent_amount', 'shops'), ('admin_ops_call_owner_amount', 'shops'),
  ('admin_log_billing_call', 'shops'),
  ('admin_save_campaign', 'growth'), ('admin_send_campaign', 'growth'), ('admin_stop_campaign', 'growth'),
  ('admin_open_incident', 'incidents'), ('admin_close_incident', 'incidents')
on conflict (rpc) do update set key = excluded.key;
alter table public.staff_rpcs enable row level security;
drop policy if exists "staff_rpcs_select" on public.staff_rpcs;
create policy "staff_rpcs_select" on public.staff_rpcs for select to authenticated using (public.is_admin());
grant select on public.staff_rpcs to authenticated;

create or replace function public.staff_key(p_rpc text, p_args jsonb)
returns text language sql stable security definer set search_path = '' as $$
  select case p_rpc
    when 'admin_support_resolve' then
      case when coalesce((p_args ->> 'p_refund_cents')::int, 0) > 20000 then 'refund_large' else 'refund_small' end
    when 'admin_salon_decide' then
      case p_args ->> 'p_action' when 'reject' then 'refuse_shop'
                                 when 'suspend' then 'suspend_shop' when 'restore' then 'suspend_shop'
                                 else 'verify_licence' end
    else (select key from public.staff_rpcs where rpc = p_rpc) end;
$$;

-- 'allow' | 'ask' | 'deny' for the caller
create or replace function public.staff_verdict(p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not public.is_admin() then 'deny'
    when public.admin_can('*') then 'allow'
    when exists (select 1 from public.staff_actions a join public.profiles p on p.id = auth.uid()
                  where a.key = p_key and p.admin_caps && a.allow) then 'allow'
    when exists (select 1 from public.staff_actions a join public.profiles p on p.id = auth.uid()
                  where a.key = p_key and p.admin_caps && a.ask) then 'ask'
    else 'deny' end;
$$;
grant execute on function public.staff_verdict(text) to authenticated;

-- Every gated action that went through, by whom — SET-04's audit log and
-- SET-02's "last action". Written by the gate, so a call that fails afterwards
-- rolls its own row back: only what actually happened is on the record.
create table if not exists public.staff_audit (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.profiles (id),
  rpc text not null,
  key text not null,
  args jsonb not null default '{}',
  ask_id uuid,                        -- set when it ran because an ask was approved
  at timestamptz not null default now()
);
create index if not exists staff_audit_at_idx on public.staff_audit (at desc);
alter table public.staff_audit enable row level security;
drop policy if exists "staff_audit_select" on public.staff_audit;
create policy "staff_audit_select" on public.staff_audit for select to authenticated using (public.is_admin());
grant select on public.staff_audit to authenticated;

create or replace function public.staff_gate(p_rpc text, p_args jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text; v text;
begin
  -- service role, cron and the SQL editor have no uid; a non-admin gets the
  -- function's own "Admins only". The gate only sorts staff from staff.
  if auth.uid() is null or not public.is_admin() then return; end if;
  v_key := public.staff_key(p_rpc, p_args);
  v := public.staff_verdict(v_key);
  if v = 'allow' then
    insert into public.staff_audit (staff_id, rpc, key, args, ask_id)
    values (auth.uid(), p_rpc, v_key, p_args, nullif(current_setting('sterncut.ask', true), '')::uuid);
    return;
  end if;
  raise exception using errcode = '42501', message = v || ':' || v_key,
    detail = (select label from public.staff_actions where key = v_key);
end $$;

-- ---- Team & roles (SET-02) ----------------------------------------------------
-- There is no email rail and no sign-up here. Karima invites an address; the
-- person creates their account in the Sterncut app with it (confirmed email) and
-- the invite promotes them the first time they sign in to this site.
-- !! Needs "Confirm email" ON in Supabase Auth: with it off, anyone could
-- !! register a @sterncut.ma address and claim the invite.
create or replace function public.staff_caps(p_role text)
returns text[] language sql immutable as $$
  select case p_role when 'head' then '{*}'::text[] when 'support' then '{support}'::text[]
                     when 'mod' then '{moderation}'::text[] when 'field' then '{shops,growth}'::text[] end;
$$;

create table if not exists public.staff_invites (
  email text primary key check (email = lower(email) and email like '%@sterncut.ma'),
  role text not null check (role in ('head', 'support', 'mod', 'field')),
  invited_by uuid not null references public.profiles (id),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id)
);
alter table public.staff_invites enable row level security;
drop policy if exists "staff_invites_select" on public.staff_invites;
create policy "staff_invites_select" on public.staff_invites for select to authenticated using (public.is_admin());
grant select on public.staff_invites to authenticated;

-- promote one confirmed account; the grant is recorded the same way 0062's are
create or replace function public.staff_promote(p_user uuid, p_role text, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_before text[];
begin
  select admin_caps into v_before from public.profiles where id = p_user;
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
  if v_email !~ '^[^@\s]+@sterncut\.ma$' then raise exception 'Only @sterncut.ma addresses can be staff'; end if;
  if public.staff_caps(p_role) is null then raise exception 'Pick one of the four roles'; end if;
  insert into public.staff_invites (email, role, invited_by) values (v_email, p_role, auth.uid())
  on conflict (email) do update set role = excluded.role, invited_by = excluded.invited_by,
                                    invited_at = now(), accepted_at = null, accepted_by = null;
  -- already has a confirmed account: promote now
  select u.id into v_user from auth.users u
   where lower(u.email) = v_email and u.email_confirmed_at is not null and u.deleted_at is null;
  if v_user is not null then
    perform public.staff_promote(v_user, p_role, auth.uid());
    update public.staff_invites set accepted_at = now(), accepted_by = v_user where email = v_email;
  end if;
  return json_build_object('email', v_email, 'accepted', v_user is not null);
end $$;

create or replace function public.admin_set_role__direct(p_admin uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.staff_caps(p_role) is null then raise exception 'Pick one of the four roles'; end if;
  -- 0062's checks: no self-edits, never the last full-access admin
  perform public.admin_set_caps__direct(p_admin, public.staff_caps(p_role));
end $$;

create or replace function public.admin_remove_colleague__direct(p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_caps text[];
begin
  if not public.admin_can('*') then raise exception 'Only the Head of Ops removes colleagues'; end if;
  if p_admin = auth.uid() then raise exception 'Ask another Head of Ops to remove you'; end if;
  select admin_caps into v_caps from public.profiles where id = p_admin and role = 'admin';
  if v_caps is null then raise exception 'That person is not on the team'; end if;
  if v_caps @> array['*'] and (select count(*) from public.profiles where role = 'admin' and admin_caps @> array['*']) <= 1 then
    raise exception 'That is the last Head of Ops — promote someone else first';
  end if;
  update public.profiles set role = 'customer' where id = p_admin;   -- 0062's trigger clears the caps
  insert into public.admin_cap_grants (admin_id, changed_by, before_caps, after_caps)
  values (p_admin, auth.uid(), v_caps, '{}');
  delete from public.staff_invites where accepted_by = p_admin;
end $$;

-- "Karima re-enrols you in person": a lost phone clears the factor and every
-- session, so the next sign-in sets a new authenticator up from scratch
create or replace function public.admin_reset_factor__direct(p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.admin_can('*') then raise exception 'Only the Head of Ops re-enrols people'; end if;
  if p_admin = auth.uid() then raise exception 'Ask another Head of Ops to re-enrol you'; end if;
  if not exists (select 1 from public.profiles where id = p_admin and role = 'admin') then
    raise exception 'That person is not on the team';
  end if;
  delete from auth.mfa_factors where user_id = p_admin;
  delete from auth.sessions where user_id = p_admin;
end $$;

-- called by the sign-in page after the password step, before the code step
create or replace function public.admin_claim_invite()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_email text; v_ok timestamptz; v_role text;
begin
  select lower(email), email_confirmed_at into v_email, v_ok from auth.users where id = auth.uid();
  if v_ok is null then return false; end if;
  select role into v_role from public.staff_invites where email = v_email and accepted_at is null;
  if v_role is null then return false; end if;
  perform public.staff_promote(auth.uid(), v_role, (select invited_by from public.staff_invites where email = v_email));
  update public.staff_invites set accepted_at = now(), accepted_by = auth.uid() where email = v_email;
  return true;
end $$;
grant execute on function public.admin_claim_invite() to authenticated;

insert into public.staff_rpcs (rpc, key) values
  ('admin_invite_colleague', 'colleague'), ('admin_set_role', 'colleague'), ('admin_remove_colleague', 'colleague'),
  ('admin_reset_factor', 'colleague')
on conflict (rpc) do update set key = excluded.key;

-- The wrappers (see the header). Idempotent: an existing function is renamed
-- to __direct once; the wrapper is (re)built from __direct every time, so a
-- function first written as __direct (the four above) gets one too.
do $gen$
declare r record; v_oid oid; v_ident text; v_obj text; v_call text; v_void boolean;
begin
  for r in select rpc from public.staff_rpcs loop
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (r.rpc, r.rpc || '__direct')) > 2 then
      raise exception '% is overloaded; the gate wraps one signature', r.rpc;
    end if;
    select oid into v_oid from pg_proc where pronamespace = 'public'::regnamespace and proname = r.rpc || '__direct';
    if v_oid is null then
      select oid into v_oid from pg_proc where pronamespace = 'public'::regnamespace and proname = r.rpc;
      if v_oid is null then raise exception 'staff_rpcs names % but no such function exists', r.rpc; end if;
      execute format('alter function public.%I(%s) rename to %I', r.rpc, pg_get_function_identity_arguments(v_oid), r.rpc || '__direct');
    end if;
    if (select proretset from pg_proc where oid = v_oid) then raise exception '% returns a set; the gate cannot wrap it', r.rpc; end if;
    -- proargnames lists OUT columns too; the wrapper passes plain inputs only
    if (select proargmodes from pg_proc where oid = v_oid) is not null then raise exception '% has OUT or VARIADIC arguments; the gate cannot wrap it', r.rpc; end if;
    v_ident := pg_get_function_identity_arguments(v_oid);
    v_void := (select prorettype = 'void'::regtype from pg_proc where oid = v_oid);
    select string_agg(format('%L, %I', n, n), ', ' order by i), string_agg(format('%I => %I', n, n), ', ' order by i)
      into v_obj, v_call
      from pg_proc p, unnest(p.proargnames) with ordinality as a(n, i) where p.oid = v_oid;
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.rpc || '__direct', v_ident);
    execute format($w$create or replace function public.%I(%s) returns %s language plpgsql security definer set search_path = '' as $b$
begin
  perform public.staff_gate(%L, jsonb_build_object(%s));
  %s public.%I(%s);
end $b$
$w$,
      r.rpc, pg_get_function_arguments(v_oid), pg_get_function_result(v_oid),
      r.rpc, coalesce(v_obj, ''),
      case when v_void then 'perform' else 'return' end, r.rpc || '__direct', coalesce(v_call, ''));
    execute format('revoke all on function public.%I(%s) from public, anon', r.rpc, v_ident);
    execute format('grant execute on function public.%I(%s) to authenticated', r.rpc, v_ident);
  end loop;
end $gen$;

-- run a stored call by name with its jsonb arguments (named, so defaults apply).
-- Only reachable from admin_decide_ask; never granted.
create or replace function public.staff_run(p_rpc text, p_args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_oid oid; v_void boolean; v_cols text; v_call text; v_out jsonb;
begin
  select p.oid, p.prorettype = 'void'::regtype into v_oid, v_void
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = p_rpc
     and exists (select 1 from public.staff_rpcs where rpc = p_rpc);
  if v_oid is null then raise exception 'Not an action that can be asked for'; end if;
  select string_agg(format('%I %s', n, format_type(t, null)), ', ' order by i),
         string_agg(format('%I => t.%I', n, n), ', ' order by i) filter (where p_args ? n)
    into v_cols, v_call
    from pg_proc p, unnest(p.proargnames, p.proargtypes::oid[]) with ordinality as a(n, t, i) where p.oid = v_oid;
  -- a void result is cast to text first: to_jsonb has no void overload
  execute format('select to_jsonb(public.%I(%s)%s)%s', p_rpc, coalesce(v_call, ''),
                 case when v_void then '::text' else '' end,
                 case when v_cols is null then '' else format(' from jsonb_to_record($1) as t(%s)', v_cols) end)
    using p_args into v_out;
  return case when v_void then null else v_out end;
end $$;
revoke all on function public.staff_run(text, jsonb) from public, anon, authenticated;

-- ---- 3 · Requests --------------------------------------------------------------
create table if not exists public.staff_asks (
  id uuid primary key default gen_random_uuid(),
  rpc text not null references public.staff_rpcs (rpc),
  args jsonb not null default '{}',
  key text not null references public.staff_actions (key),
  title text not null,               -- "Suspend Le Fade Tanger"
  place text,                        -- the section it came from: "Salons"
  path text,                         -- the page the asker was on, so Karima sees it
  reason text not null check (length(btrim(reason)) > 0),
  asked_by uuid not null references public.profiles (id),
  asked_at timestamptz not null default now(),
  state text not null default 'waiting' check (state in ('waiting', 'done', 'refused', 'withdrawn')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  note text,
  result jsonb
);
create index if not exists staff_asks_waiting_idx on public.staff_asks (asked_at) where state = 'waiting';
alter table public.staff_asks enable row level security;
drop policy if exists "staff_asks_select" on public.staff_asks;
create policy "staff_asks_select" on public.staff_asks for select to authenticated using (public.is_admin());
grant select on public.staff_asks to authenticated;
-- written only through the functions below

create or replace function public.admin_ask(
  p_rpc text, p_args jsonb, p_title text, p_reason text, p_place text default null, p_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_key text; v uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  v_key := public.staff_key(p_rpc, coalesce(p_args, '{}'));
  if v_key is null then raise exception 'Not an action that can be asked for'; end if;
  case public.staff_verdict(v_key)
    when 'allow' then raise exception 'You can do this yourself — no need to ask';
    when 'deny' then raise exception 'Your role cannot ask for this';
    else null;
  end case;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why — the reasoning is what Karima decides on'; end if;
  -- the same ask twice is one ask
  select id into v from public.staff_asks
   where state = 'waiting' and rpc = p_rpc and args = coalesce(p_args, '{}');
  if v is not null then return v; end if;
  insert into public.staff_asks (rpc, args, key, title, place, path, reason, asked_by)
  values (p_rpc, coalesce(p_args, '{}'), v_key, btrim(p_title), p_place, p_path, btrim(p_reason), auth.uid())
  returning id into v;
  return v;
end $$;
grant execute on function public.admin_ask(text, jsonb, text, text, text, text) to authenticated;

create or replace function public.admin_decide_ask(p_ask uuid, p_approve boolean, p_note text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare a public.staff_asks; v_out jsonb;
begin
  if not public.admin_can('*') then raise exception 'Only the Head of Ops decides asks'; end if;
  select * into a from public.staff_asks where id = p_ask for update;
  if not found then raise exception 'No such ask'; end if;
  if a.state <> 'waiting' then raise exception 'This ask was already %', a.state; end if;
  if a.asked_by = auth.uid() then raise exception 'You cannot decide your own ask'; end if;
  if p_approve then
    perform set_config('sterncut.ask', p_ask::text, true);   -- the audit row points back at this ask
    v_out := public.staff_run(a.rpc, a.args);   -- raises → nothing changes, the ask stays waiting
    perform set_config('sterncut.ask', '', true);
  end if;
  update public.staff_asks
     set state = case when p_approve then 'done' else 'refused' end,
         decided_by = auth.uid(), decided_at = now(), note = nullif(btrim(p_note), ''), result = v_out
   where id = p_ask;
  return json_build_object('state', case when p_approve then 'done' else 'refused' end, 'result', v_out);
end $$;
grant execute on function public.admin_decide_ask(uuid, boolean, text) to authenticated;

create or replace function public.admin_withdraw_ask(p_ask uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.staff_asks set state = 'withdrawn', decided_at = now()
   where id = p_ask and asked_by = auth.uid() and state = 'waiting';
  if not found then raise exception 'Only a waiting ask of your own can be withdrawn'; end if;
end $$;
grant execute on function public.admin_withdraw_ask(uuid) to authenticated;

create or replace function public.admin_requests()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return json_build_object(
    'waiting', coalesce((select json_agg(x order by x.asked_at) from (
      select a.id, a.title, a.place, a.path, a.key, k.label, a.reason, a.asked_at,
             coalesce(p.full_name, 'Staff') as asked_by, a.asked_by = auth.uid() as mine
        from public.staff_asks a join public.staff_actions k on k.key = a.key
        left join public.profiles p on p.id = a.asked_by
       where a.state = 'waiting') x), '[]'),
    'decided', coalesce((select json_agg(x order by x.decided_at desc) from (
      select a.id, a.title, a.place, a.path, a.key, k.label, a.reason, a.asked_at, a.state, a.note, a.decided_at,
             coalesce(p.full_name, 'Staff') as asked_by, coalesce(d.full_name, '') as decided_by,
             a.asked_by = auth.uid() as mine
        from public.staff_asks a join public.staff_actions k on k.key = a.key
        left join public.profiles p on p.id = a.asked_by
        left join public.profiles d on d.id = a.decided_by
       where a.state <> 'waiting' and a.decided_at > now() - interval '30 days'
       order by a.decided_at desc limit 50) x), '[]'));
end $$;
grant execute on function public.admin_requests() to authenticated;

-- who is signed in, and what each decision means for them — the shell's one read
create or replace function public.admin_me()
returns json language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into p from public.profiles where id = auth.uid();
  return json_build_object(
    'id', p.id, 'name', coalesce(p.full_name, 'Staff'), 'email', auth.jwt() ->> 'email',
    'caps', p.admin_caps, 'role', public.staff_role(p.admin_caps),
    -- the ask copy names her: "Karima has to agree", "With Karima"
    'head', (select coalesce(h.full_name, 'the Head of Ops') from public.profiles h
              where h.role = 'admin' and h.admin_caps @> array['*'] order by h.created_at, h.id limit 1),
    'verdicts', (select json_object_agg(key, public.staff_verdict(key)) from public.staff_actions),
    'asks_waiting', (select count(*) from public.staff_asks
                      where state = 'waiting' and (public.admin_can('*') or asked_by = auth.uid())));
end $$;
grant execute on function public.admin_me() to authenticated;

-- SET-02: the people, their role, whether their second factor is set, and the
-- last thing they did or asked for
create or replace function public.admin_team()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return json_build_object(
    'people', coalesce((select json_agg(x order by x.is_head desc, x.name) from (
      select p.id, coalesce(p.full_name, 'Staff') as name, u.email::text as email,
             public.staff_role(p.admin_caps) as role, p.admin_caps @> array['*'] as is_head, p.id = auth.uid() as is_me,
             exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified') as two_factor,
             la.what as last_action, la.at as last_at
        from public.profiles p join auth.users u on u.id = p.id
        left join lateral (
          select z.what, z.at from (
            select k.did as what, a.at from public.staff_audit a join public.staff_actions k on k.key = a.key where a.staff_id = p.id
            union all
            select 'Asked to ' || lower(left(s.title, 1)) || substr(s.title, 2), s.asked_at from public.staff_asks s where s.asked_by = p.id
          ) z order by z.at desc limit 1) la on true
       where p.role = 'admin') x), '[]'),
    'invites', coalesce((select json_agg(x order by x.invited_at desc) from (
      select i.email, i.role, i.invited_at, coalesce(b.full_name, 'Staff') as invited_by
        from public.staff_invites i left join public.profiles b on b.id = i.invited_by
       where i.accepted_at is null) x), '[]'));
end $$;
grant execute on function public.admin_team() to authenticated;

-- SET-04: what the team did, what it asked for and was refused, and every phone
-- lookup — newest first. p_kind: money | suspensions | refused | rules | null.
create or replace function public.admin_audit(p_kind text default null, p_staff uuid default null, p_days int default 30)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return json_build_object(
    'rows', coalesce((select json_agg(x order by x.at desc) from (
      -- done: the verb from the call where it says more than the row's label
      select 'did' as kind, a.at, a.staff_id, coalesce(p.full_name, 'Staff') as who, a.key,
             case a.rpc
               when 'admin_salon_decide' then case a.args ->> 'p_action' when 'suspend' then 'suspended' when 'restore' then 'reopened'
                                                when 'approve' then 'approved' when 'reject' then 'refused' else 'decided on' end
               when 'admin_review_decide' then case a.args ->> 'p_action' when 'remove' then 'removed a review of' else 'kept a review of' end
               when 'admin_set_suspension' then case when (a.args ->> 'p_suspend')::boolean then 'banned' else 'lifted the ban on' end
               when 'admin_support_resolve' then case when coalesce((a.args ->> 'p_refund_cents')::int, 0) > 0
                                                  then 'refunded ' || ((a.args ->> 'p_refund_cents')::int / 100) || ' DH on a case' else 'closed a case' end
               else lower(left(k.did, 1)) || substr(k.did, 2) end as what,
             coalesce(s.name, cp.full_name, rs.name, a.args ->> 'p_email') as subject,
             case when a.ask_id is not null then 'Asked by ' || coalesce(ap.full_name, 'a colleague') || ': “' || aa.reason || '”' end as note
        from public.staff_audit a
        join public.staff_actions k on k.key = a.key
        left join public.profiles p on p.id = a.staff_id
        left join public.salons s on s.id::text = a.args ->> 'p_salon'
        left join public.profiles cp on cp.id::text = coalesce(a.args ->> 'p_customer', a.args ->> 'p_admin', a.args ->> 'p_barber')
        left join public.reviews rv on rv.id::text = a.args ->> 'p_review'
        left join public.barbers rb on rb.id = rv.barber_id
        left join public.salons rs on rs.id = rb.salon_id
        left join public.staff_asks aa on aa.id = a.ask_id
        left join public.profiles ap on ap.id = aa.asked_by
       where a.at > v_since
      union all
      -- asked, and what came of it
      select case when q.state = 'refused' then 'refused' else 'asked' end, q.asked_at, q.asked_by, coalesce(p.full_name, 'Staff'), q.key,
             'asked to ' || lower(left(q.title, 1)) || substr(q.title, 2), null,
             case q.state when 'refused' then 'refused by ' || coalesce(d.full_name, 'the Head of Ops') || coalesce(' — “' || q.note || '”', '')
                          when 'waiting' then 'waiting · “' || q.reason || '”'
                          when 'done' then 'done by ' || coalesce(d.full_name, 'the Head of Ops')
                          else 'withdrawn' end
        from public.staff_asks q
        left join public.profiles p on p.id = q.asked_by
        left join public.profiles d on d.id = q.decided_by
       where q.asked_at > v_since
      union all
      select 'lookup', l.at, l.staff_id, coalesce(p.full_name, 'Staff'), 'lookup',
             'looked up a phone number', '…' || right(l.phone, 4),
             l.found || case when l.found = 1 then ' match' else ' matches' end
        from public.staff_lookups l left join public.profiles p on p.id = l.staff_id
       where l.at > v_since
    ) x
    where (p_staff is null or x.staff_id = p_staff)
      and (p_kind is null
        or (p_kind = 'money' and x.key in ('money', 'refund_small', 'refund_large'))
        or (p_kind = 'suspensions' and x.key in ('suspend_shop', 'ban_customer', 'refuse_shop'))
        or (p_kind = 'refused' and x.kind = 'refused')
        or (p_kind = 'rules' and x.key in ('platform_rule', 'colleague')))), '[]'),
    'refused', (select count(*) from public.staff_asks where state = 'refused' and asked_at > v_since),
    -- "Hicham has asked for a refund above his limit three times this month and
    -- been refused twice": the same ask, refused twice or more, is a pattern
    'pattern', (select json_build_object('who', coalesce(p.full_name, 'Staff'), 'staff_id', q.asked_by, 'label', k.label,
                                         'asked', count(*), 'refused', count(*) filter (where q.state = 'refused'))
                  from public.staff_asks q join public.staff_actions k on k.key = q.key
                  left join public.profiles p on p.id = q.asked_by
                 where q.asked_at > v_since
                 group by q.asked_by, p.full_name, k.label
                having count(*) filter (where q.state = 'refused') >= 2
                 order by count(*) filter (where q.state = 'refused') desc limit 1));
end $$;
grant execute on function public.admin_audit(text, uuid, int) to authenticated;

-- ---- ⌘K ----------------------------------------------------------------------
-- The palette promises "Looking up a phone number is written to the audit
-- trail, with your name." admin_search (0071) is stable and writes nothing, so
-- the palette gets its own volatile search that keeps that promise.
create table if not exists public.staff_lookups (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.profiles (id),
  phone text not null,
  found int not null,
  at timestamptz not null default now()
);
alter table public.staff_lookups enable row level security;
drop policy if exists "staff_lookups_select" on public.staff_lookups;
create policy "staff_lookups_select" on public.staff_lookups for select to authenticated using (public.is_admin());
grant select on public.staff_lookups to authenticated;

create or replace function public.admin_find(p_q text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  q text := btrim(coalesce(p_q, ''));
  -- 0661… and +212 661… are the same line: compare national numbers
  digits text := regexp_replace(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '^(00212|212|0)', '');
  pat text := '%' || lower(btrim(coalesce(p_q, ''))) || '%';
  v_people json; v_n int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if length(q) < 2 then return json_build_object('salons', '[]'::json, 'barbers', '[]'::json, 'people', '[]'::json); end if;

  if length(digits) >= 6 then
    select coalesce(json_agg(x), '[]'), count(*) into v_people, v_n from (
      select p.id, coalesce(p.full_name, 'Customer') as name, p.role, p.phone
        from public.profiles p
       where regexp_replace(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '^(00212|212|0)', '') like '%' || digits || '%'
       order by p.full_name limit 8) x;
    insert into public.staff_lookups (staff_id, phone, found) values (auth.uid(), digits, v_n);
  else
    select coalesce(json_agg(x), '[]') into v_people from (
      select p.id, coalesce(p.full_name, 'Customer') as name, p.role, null::text as phone
        from public.profiles p
       where p.role = 'customer' and lower(coalesce(p.full_name, '')) like pat
       order by p.full_name limit 6) x;
  end if;

  return json_build_object(
    'logged', length(digits) >= 6,
    'people', v_people,
    'salons', (select coalesce(json_agg(x), '[]') from (
      select s.id, s.slug, s.name, s.address, s.district, s.status, coalesce(op.full_name, s.invited_name) as owner
        from public.salons s left join public.profiles op on op.id = s.owner_id
       where lower(s.name) like pat or lower(coalesce(s.address, '')) like pat
          or lower(coalesce(s.district, '')) like pat or lower(coalesce(op.full_name, '')) like pat
       order by s.name limit 8) x),
    'barbers', (select coalesce(json_agg(x), '[]') from (
      select b.id, coalesce(p.full_name, 'Barber') as name, s.slug as salon_slug, s.name as salon, s.owner_id = b.id as is_owner
        from public.barbers b join public.profiles p on p.id = b.id
        left join public.salons s on s.id = b.salon_id
       where lower(coalesce(p.full_name, '')) like pat or lower(coalesce(s.name, '')) like pat
       order by s.name, p.full_name limit 12) x));
end $$;
grant execute on function public.admin_find(text) to authenticated;

-- ---- 4 · shop slugs ----------------------------------------------------------
-- The owner's pages live at /{slug}/… beside the staff sections at the top
-- level, so a slug may never be a section's name.
create or replace function public.slug_reserved(p text)
returns boolean language sql immutable as $$
  select p = any (array['overview', 'requests', 'demand', 'salons', 'barbers', 'customers', 'bookings',
    'wallets', 'finance', 'support', 'reviews', 'compliance', 'coupons', 'settings', 'sign-in', 'sign-out',
    'lock', 'admin', 'api', 's', 'assets', 'static', 'new', 'owner', 'today']);
$$;

create or replace function public.slugify(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')), '[^a-z0-9]+', '-', 'g'), '-');
$$;

alter table public.salons add column if not exists slug text;

create or replace function public.salon_slug_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_base text; v text; n int := 1;
begin
  if new.slug is not null then return new; end if;
  v_base := left(public.slugify(new.name), 48);
  if v_base = '' then v_base := 'shop'; end if;
  if public.slug_reserved(v_base) then v_base := v_base || '-shop'; end if;
  v := v_base;
  while exists (select 1 from public.salons where slug = v and id <> new.id) loop
    n := n + 1; v := v_base || '-' || n;
  end loop;
  new.slug := v;
  return new;
end $$;
drop trigger if exists salons_slug_fill on public.salons;
create trigger salons_slug_fill before insert or update of slug on public.salons
  for each row execute function public.salon_slug_fill();

-- backfill oldest first, so the first shop of a name keeps the plain slug
do $$
declare r record;
begin
  for r in select id from public.salons where slug is null order by created_at, id loop
    update public.salons set slug = null where id = r.id;   -- the trigger fills it
  end loop;
end $$;

alter table public.salons alter column slug set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'salons_slug_key') then
    alter table public.salons add constraint salons_slug_key unique (slug);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salons_slug_shape') then
    alter table public.salons add constraint salons_slug_shape
      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and not public.slug_reserved(slug));
  end if;
end $$;

-- the owner's pages: the slug must be the caller's own shop, else not_found —
-- the same answer whether the shop exists or not
create or replace function public.owner_shop(p_slug text)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v json;
begin
  select json_build_object('id', s.id, 'slug', s.slug, 'name', s.name, 'address', s.address,
                           'district', s.district, 'status', s.status)
    into v from public.salons s where s.slug = p_slug and s.owner_id = auth.uid();
  if v is null then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  return v;
end $$;
grant execute on function public.owner_shop(text) to authenticated;

-- where an owner lands after signing in
create or replace function public.my_shops()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('slug', s.slug, 'name', s.name, 'address', s.address, 'status', s.status)
                  order by s.created_at), '[]')
    from public.salons s where s.owner_id = auth.uid();
$$;
grant execute on function public.my_shops() to authenticated;

-- ---- proof -------------------------------------------------------------------
do $$
begin
  assert public.slugify('Le Fade Tanger') = 'le-fade-tanger', 'slugify';
  assert public.slugify('Coiffure Rif — Béni Makada!') = 'coiffure-rif-beni-makada', 'slugify accents';
  assert public.slug_reserved('settings') and not public.slug_reserved('le-fade-tanger'), 'reserved';
  assert public.staff_role('{*}') = 'head' and public.staff_role('{support}') = 'support'
     and public.staff_role('{moderation}') = 'mod' and public.staff_role('{shops,growth}') = 'field', 'roles';
  assert public.staff_key('admin_support_resolve', '{"p_refund_cents": 20000}') = 'refund_small', '200 DH is small';
  assert public.staff_key('admin_support_resolve', '{"p_refund_cents": 20001}') = 'refund_large', 'over 200 DH asks';
  assert public.staff_key('admin_salon_decide', '{"p_action": "suspend"}') = 'suspend_shop', 'suspend';
  assert public.staff_key('admin_salon_decide', '{"p_action": "reject"}') = 'refuse_shop', 'refuse';
  -- every listed function exists and is wrapped
  assert not exists (select 1 from public.staff_rpcs r where to_regproc('public.' || r.rpc || '__direct') is null),
    'every staff rpc is wrapped';
  assert not exists (select 1 from public.salons where slug is null), 'every shop has a slug';
end $$;
