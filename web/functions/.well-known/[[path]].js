// Cloudflare Pages: the app-link files for option (b) — see appLinks in src/handler.js.
import { handle } from '../../src/handler.js';

export const onRequest = ({ request, env }) => handle(request, env);
