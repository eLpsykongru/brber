// Copy to admin/config.js — the same two values as .env, from
// Supabase dashboard > Settings > API. The anon key is public by design; every
// query the site makes is gated inside the DB: staff need an @sterncut.ma
// session that passed its authenticator code (0133), owners only ever see
// their own shop. Never put the service-role key here — it would ship RLS-free
// access to anyone who opens the page.
window.SUPABASE_URL = '';
window.SUPABASE_ANON_KEY = '';

// Coupons & passes are held from v1 (design_handoff_admin_owner_site §10).
// true puts the campaign desk that exists today back behind the Coupons item.
window.STERNCUT_FLAGS = { coupons: false };
