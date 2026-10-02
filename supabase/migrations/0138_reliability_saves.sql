-- 0138_reliability_saves: HOP-01's "Save & apply" could never save.
--
-- 0066's admin_save_reliability tells the customers whose mark has gone with
--   insert into public.notifications (user_id, kind, …) select distinct …, 'moderation', …
-- and DISTINCT makes Postgres settle the literal's type as text before the insert can
-- coerce it, so every call failed: column "kind" is of type notif_kind but expression is
-- of type text. notif_kind is 0032's enum, older than 0066, so this never worked — the
-- reliability numbers have only ever been the launch defaults. (0127/0128 cast the same
-- literal; this one was missed.)
--
-- The body below is 0066's exactly, with that one cast. admin_save_reliability is gated
-- (0133, key platform_rule), so it goes into the __direct half: the wrapper, the gate and
-- the revoked execute stay as they are.

create or replace function public.admin_save_reliability__direct(
  p_late_min int, p_mark_days int, p_clean int default null, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_before json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select json_build_object('late_after_min', late_after_min, 'mark_days', mark_days,
                           'clear_after_clean', clear_after_clean)
    into v_before from public.platform_settings;

  update public.platform_settings
     set late_after_min = p_late_min, mark_days = p_mark_days,
         clear_after_clean = p_clean, updated_at = now(), updated_by = auth.uid();

  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(), v_before,
          json_build_object('late_after_min', p_late_min, 'mark_days', p_mark_days,
                            'clear_after_clean', p_clean),
          p_note);

  -- "604 customers · your mark has gone". A rule change that silently unlocks
  -- someone's deposit is a rule change they will never find out about.
  insert into public.notifications (user_id, kind, title, body)
  select distinct m.customer_id, 'moderation'::public.notif_kind, 'Your mark has gone',
         'Deposits are back to the usual 40%.'
    from public.customer_marks m
   where m.cleared_at is null
     and public.customer_deposit_pct(m.customer_id) = 40;
end;
$$;

-- the statement that failed, typed the way the function now writes it
do $$
begin
  perform 1 from (select distinct null::uuid, 'moderation'::public.notif_kind) x;
  assert (select 'moderation'::public.notif_kind) = 'moderation', 'the kind is the enum, not text';
end $$;
