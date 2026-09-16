// Cloudflare Pages: every /q/* request goes to the one handler. Set SUPABASE_URL
// and SUPABASE_ANON_KEY in the Pages project's environment variables.
import { handle } from '../../src/handler.js';

export const onRequest = ({ request, env }) => handle(request, env);
