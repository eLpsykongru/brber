-- 0106_push_no_null_category: the 400 that has been there since 0032.
--
-- Expo rejects an explicit null:
--   {"code":"VALIDATION_ERROR", "0.categoryId": Expected string, received null}
-- and 0032 built every message with
--   'categoryId', case when kind = 'booking_request' then 'BOOKING_REQUEST' else null end
-- so the key was present and null on everything else. A booking request went
-- out; a wallet top-up, a cancellation, a queue call and every reminder came
-- back 400 and were swallowed by `exception when others then null`.
--
-- The absent key and the null key are the same thing in jsonb_build_object and
-- very much not the same thing to Expo. jsonb_strip_nulls is the whole fix:
-- one call, and it also drops the null ids inside `data` (a probe has no
-- notificationId, a wallet push has no bookingId), which Expo tolerates but
-- which were never meant to be on the wire either.
--
-- Nothing to backfill. Those pushes are gone; the inbox rows they belong to
-- were always written, so nothing was lost beyond the buzz.

create or replace function public.push_body(
  p_user uuid, p_title text, p_body text, p_kind text default null,
  p_notification uuid default null, p_booking uuid default null)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'to', t.token,
    'title', p_title,
    'body', coalesce(p_body, ''),
    'sound', 'default',
    -- null here means "this kind has no banner actions", which is said by
    -- leaving the key out, not by sending the word null
    'categoryId', case when p_kind = 'booking_request' then 'BOOKING_REQUEST'
                       when p_kind = 'cancellation' then 'BOOKING_CANCELLED' end,
    'data', jsonb_strip_nulls(jsonb_build_object(
              'notificationId', p_notification, 'kind', p_kind, 'bookingId', p_booking))
  ))), '[]'::jsonb)
  from public.push_tokens t where t.user_id = p_user;
$$;
revoke execute on function public.push_body(uuid, text, text, text, uuid, uuid) from public, authenticated;

do $$
declare v_user uuid; v jsonb;
begin
  select user_id into v_user from public.push_tokens limit 1;

  -- with no token registered anywhere there is no message to inspect, and the
  -- check is honestly skipped rather than quietly passed
  if v_user is null then
    raise notice '0106: no push token in this database yet, so the body was not exercised';
    return;
  end if;

  -- the bug: a kind with no banner actions must not carry the key at all
  v := public.push_body(v_user, 'Test', 'Body', 'wallet');
  assert jsonb_array_length(v) > 0, 'a registered token produces a message';
  -- jsonb_exists, not the ? operator: some drivers read ? as a placeholder
  assert not jsonb_exists(v->0, 'categoryId'),
    'a kind with no actions leaves categoryId out entirely, rather than sending null';
  assert not jsonb_exists(v->0->'data', 'bookingId'),
    'and a wallet push carries no bookingId key either';

  -- and the kinds that do have actions still name them, or the Accept/Decline
  -- buttons quietly stop existing on the lock screen
  v := public.push_body(v_user, 'Test', 'Body', 'booking_request', null, null);
  assert v->0->>'categoryId' = 'BOOKING_REQUEST', 'a request still gets its two buttons';
  v := public.push_body(v_user, 'Test', 'Body', 'cancellation', null, null);
  assert v->0->>'categoryId' = 'BOOKING_CANCELLED', 'and a cancellation still gets its two';

  -- the parts Expo requires are never stripped
  assert v->0->>'to' is not null and v->0->>'title' = 'Test' and v->0->>'sound' = 'default',
    'to / title / sound survive the strip';
end $$;
