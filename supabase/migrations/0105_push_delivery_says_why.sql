-- 0105_push_delivery_says_why: an empty answer that means "not signed in".
--
-- 0104's `push_delivery` filters on `is_admin() or user_id = auth.uid()`. Run
-- from the Supabase SQL editor that is `postgres`, where auth.uid() is null and
-- is_admin() is false, so it returns `[]` — the same `[]` it returns when the
-- rail is genuinely untouched. A diagnostic tool whose two most different
-- answers look identical is worse than no tool.
--
-- So it says which. It still shows nobody anybody else's rows: the editor is
-- reached with database credentials, not with a session, and `session_user`
-- is what tells those apart. PostgREST connects as the authenticator role and
-- then SET ROLEs to authenticated/anon, which leaves session_user alone —
-- current_user would be useless here, since security definer makes it the
-- owner in both cases.

create or replace function public.push_delivery(p_limit int default 20)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
  v_all boolean := session_user = 'postgres';   -- database access, not a session
begin
  if to_regclass('net._http_response') is null then
    return json_build_object('error', 'pg_net stores no responses in this project');
  end if;

  if not v_all and auth.uid() is null then
    return json_build_object('error',
      'No signed-in user, so there is nothing this call can show you. From the '
      || 'SQL editor read public.push_attempts directly; from the app, sign in first.');
  end if;

  execute format($q$
    select coalesce(json_agg(x order by (x->>'at') desc), '[]'::json) from (
      select json_build_object(
        'at', a.created_at,
        'user', a.user_id,
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
      where %s
      order by a.created_at desc
      limit %s
    ) t
  $q$,
    case when v_all then 'true' else 'public.is_admin() or a.user_id = auth.uid()' end,
    greatest(1, least(p_limit, 100))) into j;

  -- an empty array now means what it says: nothing has been attempted
  return coalesce(j, '[]'::json);
end;
$$;
grant execute on function public.push_delivery(int) to authenticated;

do $$
declare v json;
begin
  -- this block runs as postgres, which is exactly the case 0104 got wrong:
  -- it must come back as rows (possibly none), never as the not-signed-in note
  -- and the distinction it draws is real: auth.uid() is genuinely null here,
  -- so before this migration these exact conditions produced a silent []
  assert auth.uid() is null, 'no session in a migration, which is the whole point';

  v := public.push_delivery(1);
  assert v is not null, 'push_delivery answers rather than returning null';
  -- names session_user on failure: if this database connects as something other
  -- than postgres, that is the assumption above being wrong, not this call
  assert (v->>'error') is null or (v->>'error') like '%pg_net%',
    format('reading as %s it refused instead of showing rows: %s', session_user, v);
end $$;
