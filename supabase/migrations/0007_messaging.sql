-- 0007_messaging: per-booking chat with reference photos + realtime

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text,
  image_path text, -- path inside the private chat-images bucket
  created_at timestamptz not null default now(),
  check (body is not null or image_path is not null)
);
create index messages_booking_idx on public.messages (booking_id, created_at);

alter table public.messages enable row level security;

-- only the booking's two participants can read or write its chat
create policy "messages_select" on public.messages for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = messages.booking_id
      and (b.customer_id = auth.uid() or b.barber_id = auth.uid())
  ));
create policy "messages_insert" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = messages.booking_id
        and (b.customer_id = auth.uid() or b.barber_id = auth.uid())
    )
  );
grant select, insert on public.messages to authenticated;

-- realtime: stream INSERTs to subscribed clients (RLS still applies)
alter publication supabase_realtime add table public.messages;

-- barbers can now see the names of customers who booked with them
drop policy "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.barbers b where b.id = profiles.id and b.status = 'approved')
    or exists (select 1 from public.bookings bk
               where bk.customer_id = profiles.id and bk.barber_id = auth.uid())
  );

-- private bucket for chat photos, keyed by booking: {booking_id}/{filename}
insert into storage.buckets (id, name, public) values ('chat-images', 'chat-images', false);
create policy "chat_images_rw" on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and exists (
    select 1 from public.bookings b
    where b.id::text = (storage.foldername(name))[1]
      and (b.customer_id = auth.uid() or b.barber_id = auth.uid())
  ));
create policy "chat_images_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and exists (
    select 1 from public.bookings b
    where b.id::text = (storage.foldername(name))[1]
      and (b.customer_id = auth.uid() or b.barber_id = auth.uid())
  ));
