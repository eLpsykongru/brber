-- 0012_specialist_profile: data the specialist screen needs — specialty title,
-- years of experience, profile avatars, public reviewer names, customer count.

alter table public.barbers add column specialty text;
alter table public.barbers add column years_experience int
  check (years_experience is null or years_experience between 0 and 80);

-- barbers may edit their new fields (grant list is authoritative, so re-issue it)
revoke update on public.barbers from authenticated;
grant update (bio, id_document_path, salon_id, specialty, years_experience)
  on public.barbers to authenticated;

-- public avatars bucket: {user_id}/avatar-{ts}.jpg, read via public URL
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
create policy "avatars_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- reviewer names show on the public reviews tab → their profiles become readable
drop policy "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.barbers b where b.id = profiles.id and b.status = 'approved')
    or exists (select 1 from public.bookings bk
               where bk.customer_id = profiles.id and bk.barber_id = auth.uid())
    or exists (select 1 from public.reviews r where r.customer_id = profiles.id)
  );

-- stats row needs a customer count, but bookings are participant-private → tiny RPC
create function public.barber_customer_count(p_barber uuid)
returns int
language sql stable
security definer set search_path = ''
as $$
  select count(distinct customer_id)::int
  from public.bookings
  where barber_id = p_barber and status in ('confirmed', 'completed');
$$;
grant execute on function public.barber_customer_count to authenticated;
