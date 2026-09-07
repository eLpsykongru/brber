-- 0104_push_visibility: find out why a push didn't arrive.
--
-- 0032 sends the Expo push inside `exception when others then null`, and it is
-- right to: a dead token or a network blip must never roll back the booking
-- that caused it. But the cost is that a rail which has never worked looks
-- exactly like a rail that works — nothing is written down either way.
--
-- So: keep the swallow, record the attempt. pg_net hands back a request id and
-- writes the reply into `net._http_response` a moment later; storing that id is
-- the whole difference between "no push came" and "Expo said the token is
-- unregistered". Two reads on top of it, and one probe you can fire at your own
-- phone without booking anything.

-- pg_net is not optional here. If it is missing, every push in this database
-- has been silently discarded since 0032, and the loud failure is the point.
do $$
begin
  if to_regproc('net.http_post') is null then
    raise exception 'pg_net is not installed. Supabase dashboard -> Database -> '
      'Extensions -> enable pg_net, then re-run this migration.';
  end if;
end $$;

-- ---- the attempt log ------------------------------------------------------
-- Append-only on purpose: this is evidence about a delivery, and nothing in
-- the app has any business rewriting it after the fact.
create table if not exists public.push_attempts (
  id           bigserial primary key,
  notification_id uuid references public.notifications (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  tokens       int not null,
  request_id   bigint,          -- null = pg_net refused before it got an id
  note         text,            -- why we didn't even try, when tokens = 0
  created_at   timestamptz not null default now()
);

create index if not exists push_attempts_user_idx
  on public.push_attempts (user_id, created_at desc);

alter table public.push_attempts enable row level security;

drop policy if exists push_attempts_own on public.push_attempts;
create policy push_attempts_own on public.push_attempts
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create or replace function public.push_attempts_readonly()
returns trigger language plpgsql as $$
begin
  raise exception 'push_attempts is what happened, not what you would like to have happened';
end;
$$;

drop trigger if exists push_attempts_no_edit on public.push_attempts;
create trigger push_attempts_no_edit
  before update or delete on public.push_attempts
  for each row execute function public.push_attempts_readonly();

-- ---- the body, shared -----------------------------------------------------
-- One builder, so the probe and the real dispatch cannot drift apart: a probe
-- that goes out differently from a booking's push proves nothing.
create or replace function public.push_body(
  p_user uuid, p_title text, p_body text, p_kind text default null,
  p_notification uuid default null, p_booking uuid default null)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', p_title,
    'body', coalesce(p_body, ''),
    'sound', 'default',
    'categoryId', case when p_kind = 'booking_request' then 'BOOKING_REQUEST'
                       when p_kind = 'cancellation' then 'BOOKING_CANCELLED' end,
    'data', jsonb_build_object('notificationId', p_notification, 'kind', p_kind,
                               'bookingId', p_booking)
  )), '[]'::jsonb)
  from public.push_tokens t where t.user_id = p_user;
$$;
revoke execute on function public.push_body(uuid, text, text, text, uuid, uuid) from public, authenticated;

-- ---- dispatch, now with a paper trail -------------------------------------
create or replace function public.push_dispatch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  urgent  boolean := false;
  starts  timestamptz;
  v_body  jsonb;
  v_count int;
  v_req   bigint;
begin
  if new.kind = 'cancellation' and new.booking_id is not null then
    select b.starts_at into starts from public.bookings b where b.id = new.booking_id;
    urgent := starts is not null and starts < now() + interval '2 hours';
  end if;

  -- a preference saying no is not a delivery failure, so it is not logged as one
  if not public.notif_should_push(new.user_id, new.kind, urgent) then
    return new;
  end if;

  -- new.kind is notif_kind; Postgres will not cast an enum to text to pick an
  -- overload, so the cast is load-bearing rather than decoration
  v_body := public.push_body(new.user_id, new.title, new.body, new.kind::text,
                             new.id, new.booking_id);
  v_count := jsonb_array_length(v_body);

  -- no token is the commonest reason a push "didn't work", and it is the one
  -- thing the old code could never tell you: he has simply never opened a
  -- build that can register one.
  if v_count = 0 then
    insert into public.push_attempts (notification_id, user_id, tokens, note)
    values (new.id, new.user_id, 0, 'no push token registered for this user');
    return new;
  end if;

  begin
    select net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := v_body
    ) into v_req;
  exception when others then
    -- ponytail: still best-effort. The inbox row is the durable record, and
    -- now the reason is too.
    insert into public.push_attempts (notification_id, user_id, tokens, note)
    values (new.id, new.user_id, v_count, left(sqlerrm, 300));
    return new;
  end;

  insert into public.push_attempts (notification_id, user_id, tokens, request_id)
  values (new.id, new.user_id, v_count, v_req);
  return new;
end;
$$;

-- ---- what came back -------------------------------------------------------
-- pg_net writes the reply asynchronously, so this is a read a second later,
-- not a return value. `net._http_response` is pruned by pg_net itself; an
-- attempt older than that window shows as 'expired', which is not a failure.
create or replace function public.push_delivery(p_limit int default 20)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare j json;
begin
  if to_regclass('net._http_response') is null then
    return json_build_object('error', 'pg_net stores no responses in this project');
  end if;

  execute format($q$
    select coalesce(json_agg(x order by (x->>'at') desc), '[]'::json) from (
      select json_build_object(
        'at', a.created_at,
        'tokens', a.tokens,
        'note', a.note,
        'status', r.status_code,
        -- Expo answers 200 with per-token tickets, so a 200 is not yet proof:
        -- an "error" ticket inside the body is how a dead token reads.
        'reply', left(r.content, 400),
        'state', case when a.note is not null then 'not sent'
                      when r.id is null then 'expired'
                      when r.status_code between 200 and 299 then 'accepted'
                      else 'refused' end
      ) as x
      from public.push_attempts a
      left join net._http_response r on r.id = a.request_id
      where public.is_admin() or a.user_id = auth.uid()
      order by a.created_at desc
      limit %s
    ) t
  $q$, greatest(1, least(p_limit, 100))) into j;
  return j;
end;
$$;
grant execute on function public.push_delivery(int) to authenticated;

-- ---- fire one at your own phone -------------------------------------------
-- No booking, no barber, no waiting for an event: the shortest loop between
-- "is the rail up" and knowing.
create or replace function public.push_probe(p_title text default 'Sterncut')
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_body  jsonb;
  v_count int;
  v_req   bigint;
begin
  v_body := public.push_body(auth.uid(), p_title, 'If you can read this, push works.', 'probe');
  v_count := jsonb_array_length(v_body);
  if v_count = 0 then
    return json_build_object('sent', false, 'tokens', 0,
      'why', 'No push token for this account. Expo Go cannot register one — '
             || 'sign in on a development build, on a real device, and allow notifications.');
  end if;

  -- deliberately NOT swallowed: a probe that fails quietly is worse than none
  select net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := v_body
  ) into v_req;

  insert into public.push_attempts (user_id, tokens, request_id)
  values (auth.uid(), v_count, v_req);

  return json_build_object('sent', true, 'tokens', v_count, 'request', v_req,
    'next', 'call push_delivery() in a second or two to see what Expo said');
end;
$$;
grant execute on function public.push_probe(text) to authenticated;

do $$
declare v_col text; v_fn text;
begin
  -- the bug that would silently kill every push: 0037 renamed the column and
  -- anything still reading barber_id would match nothing, forever, quietly
  select column_name into v_col from information_schema.columns
   where table_schema = 'public' and table_name = 'push_tokens' and column_name = 'user_id';
  assert v_col = 'user_id', 'push_tokens keys on the user, not the barber';

  assert not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'push_tokens' and column_name = 'barber_id'
  ), 'and the old column is gone, so nothing can read it by accident';

  -- the trigger still points at the function we just rewrote
  select p.proname into v_fn
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.notifications'::regclass and t.tgname = 'after_notification_insert';
  assert v_fn = 'push_dispatch', 'notifications still dispatch on insert';

  -- and an attempt, once written, is evidence. Asserted by the guard's
  -- existence rather than by writing a row: this table cannot be tidied up
  -- afterwards, which is the whole point of it.
  assert exists (
    select 1 from pg_trigger
     where tgrelid = 'public.push_attempts'::regclass and tgname = 'push_attempts_no_edit'
       and not tgisinternal
  ), 'nothing can rewrite a delivery attempt after the fact';
end $$;
