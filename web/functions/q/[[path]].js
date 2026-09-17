// Cloudflare Pages: every /q/* request goes to the one handler. Set SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in the Pages project's environment
// variables; IOS_APP_STORE_ID once the app is in the App Store.
import { handle } from '../../src/handler.js';

export const onRequest = ({ request, env }) => handle(request, env);
