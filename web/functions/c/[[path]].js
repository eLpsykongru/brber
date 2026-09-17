// Cloudflare Pages: /c/<token>, the tap in QL-24's text — see confirm in src/handler.js.
import { handle } from '../../src/handler.js';

export const onRequest = ({ request, env }) => handle(request, env);
