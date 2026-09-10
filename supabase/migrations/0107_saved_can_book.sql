-- 0107_saved_can_book: EXPL-26 — a saved name that cannot be booked says so,
-- and stays.
--
-- The bug this closes is a disappearance, not a missing label. `salons_select`
-- (0042) is `status = 'live' or owner or admin`, so a client-side join drops a
-- suspended shop out of the list entirely — which reads to the customer as
-- "you unsaved it for me", the one thing the design forbids. `my_wishlist` is
-- `security definer`, so it sees the row; this is it saying why instead.
--
-- Three fields per row, and all three are computed here rather than inferred
-- on the phone: the client has no way to see `salons.status` at all.
--
--   bookable     false when something actually refuses a booking
--   reason       why, in the customer's words. null when bookable
--   has_booking  is there a live booking at this shop / with this barber
--
-- `has_booking` exists so EXPL-26's "your Saturday booking still stands" is
-- printed only when there is one. Without it the sentence is a guess about
-- somebody's money.
--
-- What each refusal means, and where it is enforced:
--   b.status <> 'approved'      not a public storefront (0001 profiles_select)
--   b.salon_id is null          nowhere to book him — his page lives in a shop
--   sa.status <> 'live'         ops pulled the shop (0058, 0061)
--   b.salon_status <> 'approved' not approved at that shop (0025)
--   not b.accepting_bookings    his own switch (0016), read by 0065's slot scan
--
-- ponytail: no `bookable` column anywhere. This is five booleans about rows
-- that already exist, recomputed per read — a stored copy would be a fourth
-- place for "can he cut" to be true, and the other three already disagree
-- often enough.

create or replace function public.my_wishlist()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  j json;
begin
  select json_build_object(
    'barbers', (
      select coalesce(json_agg(json_build_object(
        'id', b.id, 'name', coalesce(p.full_name, 'Barber'),
        'salon', coalesce(sa.name, 'Independent'),
        -- removed reviews are excluded here the same way `reviews_select`
        -- (0042) excludes them everywhere else, so one saved card and the
        -- barber's own page can never print different stars
        'rating', coalesce((select round(avg(r.rating), 2) from public.reviews r
                             where r.barber_id = b.id and r.state <> 'removed'), 0),
        'free_today', public.barber_next_free_today(b.id),
        'bookable', (b.status = 'approved' and b.accepting_bookings
                     and b.salon_id is not null and b.salon_status = 'approved'
                     and sa.status = 'live'),
        'reason', case
          when b.status <> 'approved' then 'No longer on Sterncut'
          when b.salon_id is null then 'No shop on Sterncut'
          when sa.status <> 'live' then 'His shop is under review'
          when b.salon_status <> 'approved' then 'Not approved at this shop'
          when not b.accepting_bookings then 'Not taking bookings'
        end,
        'has_booking', exists (select 1 from public.bookings bk
                                where bk.barber_id = b.id
                                  and bk.customer_id = auth.uid()
                                  and bk.status = 'confirmed'
                                  and bk.starts_at > now())
      ) order by p.full_name), '[]'::json)
        from public.wishlists w
        join public.barbers b on b.id = w.barber_id
        join public.profiles p on p.id = b.id
        left join public.salons sa on sa.id = b.salon_id
       where w.customer_id = auth.uid() and w.barber_id is not null),
    'salons', (
      select coalesce(json_agg(json_build_object(
        'id', sa.id, 'name', sa.name, 'district', coalesce(sa.district, sa.address),
        'from_cents', (select min(sv.price_cents) from public.services sv
                        join public.barbers b2 on b2.id = sv.barber_id
                       where b2.salon_id = sa.id and sv.is_active),
        -- `open` and `bookable` are different questions and stay apart: shut
        -- for today (0064's switch) is not the same as pulled from search.
        'open', public.salon_open(sa.id),
        'bookable', sa.status = 'live',
        'reason', case when sa.status <> 'live' then 'Pulled from search' end,
        'has_booking', exists (select 1 from public.bookings bk
                                join public.barbers b3 on b3.id = bk.barber_id
                               where b3.salon_id = sa.id
                                 and bk.customer_id = auth.uid()
                                 and bk.status = 'confirmed'
                                 and bk.starts_at > now())
      ) order by sa.name), '[]'::json)
        from public.wishlists w
        join public.salons sa on sa.id = w.salon_id
       where w.customer_id = auth.uid() and w.salon_id is not null),
    'gap_alerts', coalesce((select push_saved_gap from public.notification_prefs
                             where user_id = auth.uid()), true)
  ) into j;
  return j;
end;
$$;
grant execute on function public.my_wishlist() to authenticated;

-- The join is the whole point of the fix, so prove the definer really does see
-- past `salons_select`. Nothing is written: this reads the catalogue only.
do $$
begin
  if not exists (
    select 1 from pg_proc pr
      join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public' and pr.proname = 'my_wishlist' and pr.prosecdef
  ) then
    raise exception 'my_wishlist must stay security definer — a suspended shop '
      'is invisible to the caller and would silently vanish from Saved';
  end if;
end $$;
