-- 0126_site_numbers: the only numbers the public website prints.
--
-- The website designs (Public - Website, Public - List Your Shop) print
-- "TANGER · 42 SALONS · 168 COIFFEURS", "1,4 j délai de réponse" and the price.
-- Every one of those was a fixture. A public page that states a count or a
-- reply time is making a claim, so it reads them here, from the rows — and a
-- price, so the website can never advertise a number the billing rail (0123)
-- would not charge a new shop.
--
-- Called by the website's server with the anon key, so it is granted to anon on
-- purpose: aggregates only, no name, no shop, nothing a visitor could not count
-- in the app. Same exception 0117 made for `public_queue`.

create or replace function public.site_numbers()
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    -- shops a client can find today
    'salons', (select count(*) from public.salons where status = 'live')::int,
    -- barbers on a live shop's page — the page's own rule (0123's on_shop_page)
    'barbers', (select count(*) from public.barbers b
                  join public.salons s on s.id = b.salon_id
                 where s.status = 'live' and public.on_shop_page(b))::int,
    -- "délai de réponse": the median time from an application to its decision,
    -- over the last 180 days. Null until there are five decisions to take a
    -- median of — one fast answer is not a promise.
    'reply_days', (select case when count(*) >= 5
                               then round((percentile_cont(0.5) within group (
                                      order by extract(epoch from reviewed_at - submitted_at) / 86400))::numeric, 1)
                          end
                     from public.salons
                    where submitted_at is not null and reviewed_at is not null
                      and reviewed_at >= now() - interval '180 days'
                      and reviewed_at >= submitted_at),
    -- today's list price for a new shop (0123)
    'monthly_cents', ps.sub_monthly_cents,
    'yearly_cents', ps.sub_yearly_cents,
    'cap', ps.sub_chair_cap,
    'sms_included', ps.sub_sms_included,
    -- null while the rate is unconfirmed: the site then prints no SMS price
    'sms_unit_cents', ps.sub_sms_unit_cents
  )
  from public.platform_settings ps
  limit 1;
$$;
revoke execute on function public.site_numbers() from public;
grant execute on function public.site_numbers() to anon, authenticated;

do $$
declare j json;
begin
  j := public.site_numbers();
  assert (j->>'monthly_cents')::int > 0 and (j->>'cap')::int > 0, 'the list price is readable';
  assert (j->>'salons') is not null and (j->>'barbers') is not null, 'the counts are never null';
end $$;
