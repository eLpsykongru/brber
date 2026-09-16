-- 0117_signed_in_only: every RPC granted to `authenticated` was callable by anon
-- as well. Decided with the owner (2026-09-16): close it.
--
-- Two failed applies are written into this file, because each one was a fact
-- nobody could read off the migrations:
--
--   1. 2026-09-16, "190 signed-in functions are still open to anon". The first
--      cut revoked EXECUTE from PUBLIC alone. On Supabase that closes nothing:
--      anon does not reach a function through PUBLIC, it holds a grant of its
--      own, because the project's default privileges say
--
--          alter default privileges in schema public
--            grant all on functions to postgres, anon, authenticated, service_role;
--
--      so every function carries an explicit anon grant. Both have to go.
--
--   2. 2026-09-16, "188 signed-in functions are still open to anon" — after
--      revoking from `public, anon`, with no error on any statement. A REVOKE
--      only removes privileges **granted by the role running it**: an ACL entry
--      records its grantor (`anon=X/postgres`), and a revoke by anyone else is a
--      no-op with a warning, not an error. So the revoke is made once per
--      grantor actually in the ACL, through PostgreSQL 14's `GRANTED BY`.
--
--   3. 2026-09-16, same 188, now with the ACL in the message: "running as
--      postgres, pg 17.6, example: cash_dist(…) owned by supabase_admin, acl
--      {=X/supabase_admin, …, anon=X/supabase_admin, …}". The 188 were never
--      ours. `cash_dist` is btree_gist's, and btree_gist sits in `public` here
--      because 0015's `no_double_booking` exclusion constraint needs it. An
--      extension's functions are owned by `supabase_admin` and granted by
--      `supabase_admin`, so `postgres` cannot revoke them — and should not: they
--      are index-support and distance helpers with nothing about any person in
--      them, and the constraint that keeps two customers out of one chair is
--      built on top of them. Every extension's functions are left alone from
--      here, and counted in the notice so the number is not a guess.
--
-- What this does, function by function, in the public schema:
--   · granted to `authenticated`  →  EXECUTE revoked from PUBLIC **and** anon,
--     for every grantor holding the entry, and granted explicitly to
--     `service_role` so the page's own server keeps what it already reached.
--     Signed-in users keep the function through their own grant, which is the
--     one that was always meant to be the only one.
--   · `public_queue` and `nearby_open_shop` (0110, 0115) → left alone. They are
--     the queue page with no account, and `public_queue` is the only call the app
--     itself makes with no session (QueueLinkScreen, QL-16).
--   · named inside an RLS policy → left alone. A policy's expression runs as the
--     querying role, so revoking anon's EXECUTE on `is_admin()` would turn an
--     anon read of every table whose policy calls it into "permission denied for
--     function" — a bigger outage than the hole being shut. These are the gates
--     themselves (`is_admin`, `is_agent`): to anon they answer false, and they
--     return nothing about anybody.
--
-- Still not closed, and named in BACKLOG: a function with no grant line of its
-- own keeps the default PUBLIC EXECUTE. The notice counts them rather than
-- leaving the number to a guess.
--
-- Safe to run twice: it revokes what is there and grants what belongs.

do $$
declare
  r record;
  g text;
  v_closed int := 0;
  v_kept int := 0;
  v_still boolean;
  v_stuck text := '';
  v_ungranted int;
  v_extension int;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'no `authenticated` role here (not a Supabase database) — nothing to close';
    return;
  end if;

  for r in
    select p.oid,
           p.oid::regprocedure::text as sig,
           p.proname in ('public_queue', 'nearby_open_shop') as page,
           exists (select 1 from pg_policies pol
                    where pol.schemaname = 'public'
                      and (coalesce(pol.qual, '') like '%' || p.proname || '(%'
                           or coalesce(pol.with_check, '') like '%' || p.proname || '(%')) as in_policy
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prokind = 'f' and p.proacl is not null
       -- an extension's own functions are supabase_admin's, not ours (failure 3)
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       and exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee = 'authenticated'::regrole and a.privilege_type = 'EXECUTE')
  loop
    if r.page or r.in_policy then
      v_kept := v_kept + 1;
      continue;
    end if;

    -- as whoever is running this, which is enough when they granted it
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);

    -- and again per grantor when the entry was somebody else's to give
    select exists (
      select 1 from pg_proc p, aclexplode(p.proacl) a
       where p.oid = r.oid and a.privilege_type = 'EXECUTE'
         and (a.grantee = 0 or a.grantee = 'anon'::regrole))
      into v_still;

    if v_still then
      for g in
        select distinct a.grantor::regrole::text
          from pg_proc p, aclexplode(p.proacl) a
         where p.oid = r.oid and a.privilege_type = 'EXECUTE'
           and (a.grantee = 0 or a.grantee = 'anon'::regrole)
      loop
        begin
          execute format('revoke execute on function %s from public, anon granted by %s', r.sig, g);
        exception when others then
          -- one line per grantor we cannot act for; the check below decides
          if position(g in v_stuck) = 0 then
            v_stuck := v_stuck || format('granted by %s → %s; ', g, sqlerrm);
          end if;
        end;
      end loop;
    end if;

    v_closed := v_closed + 1;
  end loop;

  select count(*) into v_ungranted
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f' and p.proacl is null;

  select count(*) into v_extension
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
   where ns.nspname = 'public' and p.prokind = 'f';

  raise notice '% functions revoked; % left open on purpose (the page and the policy gates); '
    '% belong to extensions in public and stay as supabase_admin left them; '
    '% still carry the default PUBLIC grant because nothing was ever granted on them',
    v_closed, v_kept, v_extension, v_ungranted;
  if v_stuck <> '' then raise notice 'could not revoke as: %', left(v_stuck, 500); end if;
end $$;

-- ---- checked at apply time ---------------------------------------------------
-- The failure is the diagnosis: it says how many are open, who this ran as, and
-- what one of their ACLs actually looks like, because that is the thing no
-- migration in this repo could have told anybody.
do $$
declare
  v_open int;
  v_names text;
  s record;
  v_page int;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then return; end if;

  select count(*), string_agg(x.sig, ', ' order by x.sig) into v_open, v_names
    from (
      select p.oid::regprocedure::text as sig
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.prokind = 'f' and p.proacl is not null
         and p.proname not in ('public_queue', 'nearby_open_shop')
         and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
         and not exists (select 1 from pg_policies pol
                          where pol.schemaname = 'public'
                            and (coalesce(pol.qual, '') like '%' || p.proname || '(%'
                                 or coalesce(pol.with_check, '') like '%' || p.proname || '(%'))
         and exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 'authenticated'::regrole and a.privilege_type = 'EXECUTE')
         and exists (select 1 from aclexplode(p.proacl) a
                      where a.privilege_type = 'EXECUTE'
                        and (a.grantee = 0 or a.grantee = 'anon'::regrole))
    ) x;

  if v_open > 0 then
    select p.proname as name, pg_get_userbyid(p.proowner) as owner, p.proacl::text as acl
      into s
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prokind = 'f' and p.proacl is not null
       and p.proname not in ('public_queue', 'nearby_open_shop')
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       and exists (select 1 from aclexplode(p.proacl) a
                    where a.privilege_type = 'EXECUTE'
                      and (a.grantee = 0 or a.grantee = 'anon'::regrole))
     order by p.proname
     limit 1;
    raise exception
      '% still open to anon. running as "%" (session "%"), pg %. example: %(…) owned by %, acl %',
      v_open, current_user, session_user, current_setting('server_version'),
      coalesce(s.name, '?'), coalesce(s.owner, '?'), coalesce(s.acl, 'null');
  end if;

  -- the read that started this, confirmed live on 2026-09-13: full names to anyone
  assert not exists (
    select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace,
      aclexplode(p.proacl) a
     where ns.nspname = 'public' and p.proname = 'salon_queue_estimate'
       and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole)),
    'salon_queue_estimate is still open to anon';

  -- and the two the page really does call without a session still answer
  select count(*) into v_page
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('public_queue', 'nearby_open_shop')
     and exists (select 1 from aclexplode(p.proacl) a
                  where a.grantee = 'anon'::regrole and a.privilege_type = 'EXECUTE');
  assert v_page = 2, 'the queue page must still read the line with no session';
end $$;
