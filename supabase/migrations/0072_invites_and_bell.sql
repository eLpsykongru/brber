-- 0072_invites_and_bell: turn 11 (ops opens a shop) and turn 10 (the bell).
--
-- Turn 11's rule is the one that shapes the schema: **ops can start a shop but
-- cannot finish one.** The licence and the map pin have to come from the owner,
-- so an added shop is `pending` with an invite on it and is invisible to
-- customers until he claims it through the same checklist an applicant walks.
-- Otherwise ops becomes the shortcut around its own compliance.
--
-- That needs no new status: an invited shop is `pending` like any applicant, and
-- `invited_by` is what tells the two apart — which is exactly the column 11b's
-- "HOW IT STARTED" prints ("You added it" / "They applied" / "Rida added it").
--
-- Turn 10's rule: "Only money, compliance and applications ring. Everything else
-- waits in the sidebar." admin_bell() reads only those three sources, and splits
-- them by whether a person has to do something.

-- ---- 11 · a shop with no owner yet -----------------------------------------
-- owner_id has been NOT NULL since 0001 because a salon was always created by
-- the barber who owns it. An invited shop has no account behind it yet — the
-- invite is what creates one — so the column has to admit that gap.
alter table public.salons alter column owner_id drop not null;

alter table public.salons
  add column if not exists invited_name text,
  add column if not exists invited_phone text,
  add column if not exists invite_token text,
  add column if not exists invited_by uuid references public.profiles (id),
  add column if not exists invited_at timestamptz,
  add column if not exists invite_sent_at timestamptz,
  add column if not exists invite_reason text,
  add column if not exists claimed_at timestamptz,
  add column if not exists dropped_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'salons_invite_reason_check') then
    alter table public.salons add constraint salons_invite_reason_check
      check (invite_reason is null or invite_reason in ('recruited', 'walk_in', 'moved'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'salons_invite_token_key') then
    alter table public.salons add constraint salons_invite_token_key unique (invite_token);
  end if;
end $$;

-- 11a: name, address, district, owner name + phone, why, and the starting cap.
-- Everything else on the checklist is his to supply.
--
-- There is no SMS rail in this project (push is still blocked on pg_net, and SMS
-- was never built), so this does NOT claim to have sent anything: it stamps who
-- sent it and hands the message and link back for ops to send. A function that
-- pretended to dispatch would be a lie stored in a timestamp.
create or replace function public.admin_create_salon(
  p_name text, p_address text, p_district text,
  p_owner_name text, p_owner_phone text,
  p_reason text default 'recruited',
  p_cap_cents int default 150000,
  p_send boolean default true)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_token text;
  v_owner uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'The shop needs a name';
  end if;
  if nullif(btrim(coalesce(p_owner_phone, '')), '') is null then
    raise exception 'Without a number there is nobody to invite';
  end if;
  if p_cap_cents is null or p_cap_cents <= 0 then
    raise exception 'A float cap has to be a positive amount';
  end if;

  -- if that number already has an account, the shop is his the moment he opens it
  select id into v_owner from public.profiles
   where replace(coalesce(phone, ''), ' ', '') = replace(p_owner_phone, ' ', '')
   limit 1;

  loop
    v_token := upper(left(replace(gen_random_uuid()::text, '-', ''), 6));
    exit when not exists (select 1 from public.salons where invite_token = v_token);
  end loop;

  insert into public.salons (name, address, district, status, float_cap_cents,
                             owner_id, invited_name, invited_phone, invite_token,
                             invited_by, invited_at, invite_sent_at, invite_reason,
                             submitted_at)
  values (btrim(p_name), nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_district, '')), ''),
          'pending', p_cap_cents,
          (select id from public.barbers where id = v_owner),
          btrim(coalesce(p_owner_name, '')), btrim(p_owner_phone), v_token,
          auth.uid(), now(), case when p_send then now() end, p_reason, now())
  returning id into v_id;

  return json_build_object(
    'id', v_id, 'token', v_token,
    'link', 'sterncut.ma/c/' || v_token,
    'sms', 'Salam ' || coalesce(nullif(btrim(coalesce(p_owner_name, '')), ''), 'a sidi')
           || ' — Sterncut. ' || btrim(p_name)
           || ' is ready for you: open this link and add your licence and location. sterncut.ma/c/' || v_token);
end;
$$;
grant execute on function public.admin_create_salon(text, text, text, text, text, text, int, boolean) to authenticated;

-- 11b's table. "WAITING ON THEM FOR" is the applicant checklist, computed rather
-- than stored, so it can never drift from what actually blocks approval.
-- Invites older than 30 days are dropped automatically — done here on read
-- rather than on a schedule, because there is no pg_cron in this project yet.
create or replace function public.admin_invites()
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  update public.salons
     set dropped_at = now()
   where status = 'pending' and invited_by is not null
     and claimed_at is null and dropped_at is null
     and invited_at < now() - interval '30 days';

  select json_build_object(
    'counts', json_build_object(
      'all',     (select count(*)::int from public.salons where dropped_at is null),
      'live',    (select count(*)::int from public.salons where status = 'live'),
      'waiting', (select count(*)::int from public.salons where status = 'pending' and dropped_at is null),
      'hidden',  (select count(*)::int from public.salons where status = 'suspended')),
    'rows', (
      select coalesce(json_agg(json_build_object(
        'id', s.id, 'name', s.name, 'district', s.district, 'address', s.address,
        'owner', coalesce(nullif(btrim(coalesce(op.full_name, '')), ''), s.invited_name, '—'),
        'phone', coalesce(op.phone, s.invited_phone),
        -- 11b's "HOW IT STARTED"
        'origin', case when s.invited_by is null then 'applied'
                       when s.invited_by = auth.uid() then 'you'
                       else coalesce(ip.full_name, 'Ops') end,
        'invited_at', s.invited_at, 'sent_at', s.invite_sent_at,
        'claimed_at', s.claimed_at, 'token', s.invite_token,
        'since', coalesce(s.invited_at, s.submitted_at, s.created_at),
        'opened', s.claimed_at is not null,
        -- the checklist, in the order 11a lists it
        'missing', (
          select coalesce(json_agg(m), '[]'::json) from (
            select 'licence' as m where not exists (
              select 1 from public.barbers b where b.id = s.owner_id and b.licence_expires_at is not null)
            union all
            select 'pin' where s.lat is null or s.lng is null
            union all
            select 'services' where not exists (
              select 1 from public.services sv
              join public.barbers b2 on b2.id = sv.barber_id
              where b2.salon_id = s.id)
          ) x)
      ) order by coalesce(s.invited_at, s.submitted_at, s.created_at)), '[]'::json)
      from public.salons s
      left join public.profiles op on op.id = s.owner_id
      left join public.profiles ip on ip.id = s.invited_by
      where s.status = 'pending' and s.dropped_at is null)
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_invites() to authenticated;

create or replace function public.admin_invite_action(p_salon uuid, p_action text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_action not in ('resend', 'drop') then raise exception 'Bad action'; end if;

  select id, name, invited_name, invite_token, claimed_at into s
    from public.salons where id = p_salon;
  if not found then raise exception 'Salon not found'; end if;
  if s.invite_token is null then raise exception 'That shop applied itself — there is no invite to act on'; end if;

  if p_action = 'drop' then
    update public.salons set dropped_at = now() where id = p_salon;
    return json_build_object('dropped', true);
  end if;

  update public.salons set invite_sent_at = now() where id = p_salon;
  return json_build_object(
    'link', 'sterncut.ma/c/' || s.invite_token,
    'sms', 'Salam ' || coalesce(nullif(btrim(coalesce(s.invited_name, '')), ''), 'a sidi')
           || ' — Sterncut. ' || s.name
           || ' is ready for you: open this link and add your licence and location. sterncut.ma/c/' || s.invite_token);
end;
$$;
grant execute on function public.admin_invite_action(uuid, text) to authenticated;

-- ---- 10 · the bell ----------------------------------------------------------
-- "Mark all read" needs somewhere to remember the mark. One column, on the
-- admin doing the reading.
alter table public.profiles add column if not exists bell_seen_at timestamptz;

create or replace function public.admin_bell_seen()
returns void
language sql security definer set search_path = ''
as $$
  update public.profiles set bell_seen_at = now() where id = auth.uid();
$$;
grant execute on function public.admin_bell_seen() to authenticated;

-- The feed. Turn 10's rule is quoted at the bottom of 10a: "Only money,
-- compliance and applications ring. Everything else waits in the sidebar." So
-- exactly three sources feed the top half, and the split is on whether a person
-- has to do something — not on how important it looks.
create or replace function public.admin_bell()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_seen timestamptz;
  j json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select bell_seen_at into v_seen from public.profiles where id = auth.uid();

  select json_build_object(
    'seen_at', v_seen,
    -- who else is at the desk right now, so 10a can show the faces
    'desk', (select coalesce(json_agg(json_build_object(
               'name', coalesce(p.full_name, 'Ops'), 'holding', d.holding,
               'idle_min', floor(extract(epoch from (now() - d.last_seen_at)) / 60)::int,
               'me', d.user_id = auth.uid())), '[]'::json)
             from public.desk_presence d
             join public.profiles p on p.id = d.user_id
             where d.last_seen_at > now() - interval '15 minutes'),

    'act', (
      select coalesce(json_agg(x.e order by x.at desc), '[]'::json) from (
        -- money: an open case with an amount in dispute
        select c.created_at as at, json_build_object(
                 'kind', 'money', 'ref', c.case_no,
                 'title', coalesce(p.full_name, 'A customer') || '’s ' || (c.amount_cents / 100) || ' DH is disputed',
                 'detail', coalesce(c.detail, 'Opened from the app.'),
                 'at', c.created_at, 'action', 'TAKE ' || c.case_no,
                 'go', 'support', 'id', c.id,
                 'held_by', (select h.holder from public.case_holders() h where h.ref = c.case_no)) as e
          from public.support_cases c
          left join public.profiles p on p.id = c.user_id
         where c.status = 'open' and coalesce(c.amount_cents, 0) > 0
        union all
        -- compliance: proof came back and nobody has verified it
        select t.proof_at, json_build_object(
                 'kind', 'compliance', 'ref', t.ref,
                 'title', s.name || ' sent the ' || t.kind || ' proof',
                 'detail', t.title || ' · verify and the task closes.',
                 'at', t.proof_at, 'action', 'VERIFY THE PHOTO',
                 'go', 'compliance', 'id', t.id, 'held_by', null)
          from public.shop_tasks t
          join public.salons s on s.id = t.salon_id
         where t.proof_at is not null and t.status in ('open', 'sent')
        union all
        -- applications: everything the applicant owed is in, so it is ours now
        select coalesce(s.submitted_at, s.created_at), json_build_object(
                 'kind', 'application', 'ref', coalesce(s.invite_token, left(s.id::text, 4)),
                 'title', s.name || ' is ready for you',
                 'detail', 'Last blocker cleared. Nothing else is waiting on them.',
                 'at', coalesce(s.submitted_at, s.created_at), 'action', 'REVIEW & APPROVE',
                 'go', 'salons/pending', 'id', s.id, 'held_by', null)
          from public.salons s
         where s.status = 'pending' and s.dropped_at is null
           and s.lat is not null and s.lng is not null
           and exists (select 1 from public.barbers b
                        where b.id = s.owner_id and b.licence_expires_at is not null)
      ) x),

    'fyi', (
      select coalesce(json_agg(x.e order by x.at desc), '[]'::json) from (
        select s.reviewed_at as at, json_build_object(
                 'title', s.name || ' was auto-hidden',
                 'detail', coalesce(s.review_note, 'Licence overdue') || ' · no action needed',
                 'at', s.reviewed_at) as e
          from public.salons s
         where s.status = 'suspended' and s.reviewed_at is not null
        union all
        select f.created_at, json_build_object(
                 'title', (case when f.settled_by = auth.uid() then 'You collected '
                                else coalesce(sp.full_name, 'Ops') || ' collected ' end)
                          || round(f.amount_cents / 100.0) || ' DH from ' || s.name,
                 'detail', 'Code confirmed ' || to_char(f.created_at, 'HH24:MI'),
                 'at', f.created_at)
          from public.float_settlements f
          join public.salons s on s.id = f.salon_id
          left join public.profiles sp on sp.id = f.settled_by
      ) x limit 12)
  ) into j;
  return j;
end;
$$;
grant execute on function public.admin_bell() to authenticated;

-- 10b: "TAKE IT FROM RIDA". claim_case refuses when somebody else is in, which
-- is the whole point of it — this is the deliberate override, and it is a
-- different verb precisely so it cannot happen by accident. Both records show it.
create or replace function public.admin_take_case(p_ref text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_from text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select coalesce(p.full_name, 'Ops') into v_from
    from public.desk_presence d
    join public.profiles p on p.id = d.user_id
   where d.holding = p_ref and d.user_id <> auth.uid()
   limit 1;

  update public.desk_presence set holding = null
   where holding = p_ref and user_id <> auth.uid();

  insert into public.desk_presence (user_id, holding, entered_at, last_seen_at)
  values (auth.uid(), p_ref, now(), now())
  on conflict (user_id) do update set holding = p_ref, entered_at = now(), last_seen_at = now();

  return json_build_object('taken_from', v_from);
end;
$$;
grant execute on function public.admin_take_case(text) to authenticated;
