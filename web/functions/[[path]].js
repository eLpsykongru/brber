// Cloudflare Pages: sterncut.ma itself — every address that is not /q/* or /c/*
// (those two have their own adapters, which win as the more specific routes).
// Build output directory: `web/public`; its `_routes.json` keeps /img/* static,
// so a photo dropped in public/img/ is served as a file and never reaches this.
// Environment: SUPABASE_URL and SUPABASE_ANON_KEY (the numbers, and the new-password
// page); optional SUPPORT_PHONE, IOS_APP_STORE_ID, ANDROID_PACKAGE; MAINTENANCE=1
// with MAINTENANCE_UNTIL ("14:30") and MAINTENANCE_AT (ISO time of the note) for WEB-13.
import { handle } from '../src/handler.js';

export const onRequest = ({ request, env }) => handle(request, env);
