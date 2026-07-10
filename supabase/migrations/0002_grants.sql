-- 0002_grants: explicit table privileges for the authenticated role.
-- RLS decides WHICH rows; these GRANTs decide table access at all. Both are required.
-- (0001 assumed Supabase's implicit default privileges — this project doesn't apply them.)

-- profiles: read (RLS-filtered); inserts happen via the security-definer trigger only.
-- UPDATE is already column-restricted in 0001 (full_name, phone, avatar_url) so role stays locked.
grant select on public.profiles to authenticated;

-- barbers: read (RLS-filtered). UPDATE column-restricted in 0001 so status stays admin-only.
grant select on public.barbers to authenticated;

-- services: a barber fully manages their own menu (RLS scopes it to barber_id = auth.uid()).
grant select, insert, update, delete on public.services to authenticated;

-- bookings: customers create + both participants read (RLS-scoped). No update yet (Phase 2).
grant select, insert on public.bookings to authenticated;
