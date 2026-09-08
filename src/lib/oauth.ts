import { parseRedirect } from './oauthUrl';
import { supabase } from './supabase';

export type OAuthProvider = 'google' | 'apple';

/**
 * Google / Apple sign-in (BACKLOG "Sterncut auth & onboarding"). One path for
 * both: Supabase hands us the provider URL, the system auth browser runs the
 * consent screen, and the redirect comes back into the app with the session in
 * the fragment. Sign-in and sign-up are the same call — a first-time provider
 * user gets an auth.users row, and the 0010 trigger gives them a profile.
 *
 * ponytail: implicit flow, not PKCE. Switching the client to pkce would change
 * the emailed password-reset link into a code only this device could exchange,
 * and that link is opened on the web today. Revisit together with the in-app
 * reset deep link.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<boolean> {
  // ponytail: required here rather than imported at the top. Both are native
  // modules, so they are missing until the development build that includes
  // them is installed — and a top-level import takes the whole bundle down
  // ("App entry not found") instead of just this button.
  const Linking = require('expo-linking') as typeof import('expo-linking');
  const WebBrowser = require('expo-web-browser') as typeof import('expo-web-browser');

  const redirectTo = Linking.createURL('/auth');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase returned no provider URL');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return false; // dismissed / cancelled — not an error

  const redirect = parseRedirect(result.url);
  if (!redirect.ok) throw new Error(redirect.error);
  const { access_token, refresh_token } = redirect;

  const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
  if (sessionError) throw sessionError;
  return true; // App.tsx's onAuthStateChange takes it from here
}
