// Copy to admin/config.js — the same two values as .env, from
// Supabase dashboard > Settings > API. The anon key is public by design; every
// query the console makes is gated on profiles.role = 'admin' inside the DB.
// Never put the service-role key here — it would ship RLS-free access to anyone
// who opens the page.
window.SUPABASE_URL = '';
window.SUPABASE_ANON_KEY = '';
