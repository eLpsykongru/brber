-- 0008_reviews: one review per booking, only by its customer, only after the appointment.
-- No "mark completed" flow: a confirmed booking whose end time has passed counts as done.

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  barber_id uuid not null references public.barbers (id),
  customer_id uuid not null references public.profiles (id),
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);
create index reviews_barber_idx on public.reviews (barber_id, created_at desc);

-- derive barber/customer from the booking server-side; validate eligibility
create function public.fill_review()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  b record;
begin
  select customer_id, barber_id, status, ends_at into b
    from public.bookings where id = new.booking_id;
  if not found or b.customer_id <> auth.uid() then raise exception 'Not your booking'; end if;
  if b.status <> 'confirmed' or b.ends_at > now() then
    raise exception 'You can review after the appointment has happened';
  end if;
  new.customer_id := b.customer_id;
  new.barber_id := b.barber_id;
  return new;
end;
$$;

create trigger before_review_insert
  before insert on public.reviews
  for each row execute function public.fill_review();

alter table public.reviews enable row level security;

-- reviews are public content
create policy "reviews_select" on public.reviews for select to authenticated using (true);
create policy "reviews_insert" on public.reviews for insert to authenticated
  with check (customer_id = auth.uid()); -- trigger already pinned this to the booking

grant select, insert on public.reviews to authenticated;
