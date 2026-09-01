-- 0074_searches: EXPL-15 — a search that finds nothing becomes a demand signal.
--
-- BACKLOG TRIGGER PULLED. 0060's demand map deliberately left one card unbuilt:
--
--   "4a's third action is 'Beni Makada · no shop yet — these are searches that
--    found nothing'. An ask is always made *against a salon whose day is full*,
--    so a district with no shop can produce none. Building that card would need
--    a search log we do not keep... It needs a `searches` table if it is wanted."
--
-- This is that table. The handoff design calls it `SearchMiss`; the name here is
-- the one 0060 asked for. It is deliberately NOT `waitlist_requests` — that row
-- needs a barber and a day (0049), and a search that found nothing has neither.
-- Bending it to take nulls would make every existing waitlist read lie.
--
-- One rule from the handoff (§7.4): the write is not optional. A customer
-- searching for something we cannot serve is the most valuable event in the app,
-- and it is the only one that arrives for free.

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  -- nullable: a miss is worth recording even if the row's owner is later deleted
  customer_id uuid references public.profiles (id) on delete set null,
  query text not null,
  district text,
  -- what they were after, from EXPL-15's chips. Free-text, not an enum: the
  -- point of this table is to learn what people ask for that we don't have.
  tags text[] not null default '{}',
  notify boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists searches_district_idx on public.searches (district, created_at desc);
create index if not exists searches_notify_idx on public.searches (district) where notify;

alter table public.searches enable row level security;
-- A customer sees only their own misses; the desk sees all of them. Nobody
-- updates a miss except through the RPC below, so there is no update policy.
create policy searches_select on public.searches for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());
grant select on public.searches to authenticated;

-- ---- the write ------------------------------------------------------------
-- Returns the row it wrote plus the number the screen prints back ("37 people
-- asked for Malabata this month"). One round trip, because the screen has no
-- use for one without the other, and a count the client computed from rows it
-- cannot read would have to be faked.
--
-- Distinct customers, not rows: someone searching four times is one person
-- asking, and the sentence says "people".
create or replace function public.log_search_miss(p_query text, p_district text default null)
returns table (search_id uuid, asks int)
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_q text := btrim(coalesce(p_query, '')); v_d text := nullif(btrim(coalesce(p_district, '')), '');
begin
  if v_q = '' then raise exception 'a search miss needs a query'; end if;

  insert into public.searches (customer_id, query, district)
  values (auth.uid(), v_q, v_d)
  returning id into v_id;

  return query
    select v_id,
           (select count(distinct coalesce(s.customer_id::text, s.id::text))::int
              from public.searches s
             where s.district is not distinct from v_d
               and s.created_at >= date_trunc('month', now()));
end $$;
grant execute on function public.log_search_miss(text, text) to authenticated;

-- ---- "notify me when there is one" ----------------------------------------
-- Separate from the write on purpose. §7.4's row is written the moment the
-- result comes back empty; the tags and the notify flag only exist if the
-- customer then chooses to say more. Folding them into one call would mean
-- either not writing until they tap (losing every miss nobody acts on) or
-- writing a second row for the same miss.
create or replace function public.set_search_notify(p_search uuid, p_tags text[] default '{}', p_notify boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.searches
     set tags = coalesce(p_tags, '{}'), notify = p_notify
   where id = p_search and customer_id = auth.uid();
  if not found then raise exception 'no such search'; end if;
end $$;
grant execute on function public.set_search_notify(uuid, text[], boolean) to authenticated;

do $$
begin
  -- EXPL-15's drawn numbers: 6 shops in Tangier, none in Malabata, 37 asked.
  assert 6 > 0, 'the sentence only reads right when we do have shops elsewhere';
  assert 37 > 0, 'the count is what makes the ask feel worth making';
  -- distinct-customer counting: 4 searches by 1 person is 1 person asking
  assert (select count(distinct x) from unnest(array['a','a','a','b']) x) = 2,
    'the month count counts people, not rows';
  -- a null district must group with other null districts, not vanish
  assert (null::text is not distinct from null::text), 'unnamed districts still aggregate';
end $$;
