-- 0143_pay_terms_private: a barber's pay terms are between him and his shop.
--
-- 0001 granted SELECT on the whole of public.barbers to every signed-in user, and its
-- row policy shows every approved barber — so a customer could read any barber's
-- pay_model, commission_pct and rent_cents (and since 0142 rent_period) straight off
-- the table. Every screen that shows terms already reads them through security
-- definer functions that check who is asking (salon_team, salon_report,
-- salon_barber_earnings, open_chairs …), so the table stops handing them out:
-- SELECT is granted column by column, and these four are left out.
--
-- FROM HERE ON, a new column on public.barbers is not readable from the app until a
-- migration says so:   grant select (new_column) on public.barbers to authenticated;
-- and select('*') on barbers fails for a signed-in user — name the columns.

revoke select on public.barbers from anon, authenticated;

do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'barbers'
    and column_name not in ('pay_model', 'commission_pct', 'rent_cents', 'rent_period');
  execute format('grant select (%s) on public.barbers to authenticated', v_cols);
end $$;

do $$
begin
  assert not has_column_privilege('authenticated', 'public.barbers', 'pay_model', 'select'), 'pay_model is still readable';
  assert not has_column_privilege('authenticated', 'public.barbers', 'commission_pct', 'select'), 'commission_pct is still readable';
  assert not has_column_privilege('authenticated', 'public.barbers', 'rent_cents', 'select'), 'rent_cents is still readable';
  assert not has_column_privilege('authenticated', 'public.barbers', 'rent_period', 'select'), 'rent_period is still readable';
  assert not has_column_privilege('anon', 'public.barbers', 'rent_cents', 'select'), 'anon still reads rent_cents';
  -- what the public pages filter on, and what the app reads of its own row
  assert has_column_privilege('authenticated', 'public.barbers', 'salon_status', 'select'), 'salon_status was lost';
  assert has_column_privilege('authenticated', 'public.barbers', 'id_document_path', 'select'), 'id_document_path was lost';
end $$;
