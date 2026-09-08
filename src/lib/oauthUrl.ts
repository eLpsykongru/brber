/**
 * The one non-obvious bit of the OAuth flow: reading the redirect the provider
 * bounced back into the app. Supabase's implicit flow puts the session in the
 * fragment (`…/auth#access_token=…&refresh_token=…`), while a refusal can come
 * back in either the fragment or the query string. Pure, so oauthUrl.check.ts
 * can run it under node.
 */
export type Redirect =
  | { ok: true; access_token: string; refresh_token: string }
  | { ok: false; error: string };

export function parseRedirect(url: string): Redirect {
  const [head, fragment = ''] = url.split('#');
  const params = new URLSearchParams(fragment || head.split('?')[1] || '');
  const denied = params.get('error_description') ?? params.get('error');
  if (denied) return { ok: false, error: denied };
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return { ok: false, error: 'No session came back from the provider' };
  return { ok: true, access_token, refresh_token };
}
