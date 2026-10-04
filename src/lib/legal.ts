import { Linking } from 'react-native';
import { lang } from './i18n';

// sterncut.ma's legal pages (WEB-14/15), in the in-app browser. The site 301s
// /{lang}/terms and /{lang}/privacy to each page's own address, so the app keeps
// the short form. A test build points EXPO_PUBLIC_QUEUE_BASE at wherever web/ is
// deployed; the legal pages live on that same host.
const SITE = (process.env.EXPO_PUBLIC_QUEUE_BASE || 'https://sterncut.ma/q').replace(/\/q\/?$/, '');

export function openLegal(page: 'terms' | 'privacy') {
  const url = `${SITE}/${lang()}/${page}`;
  try {
    // required here, not imported at the top (see oauth.ts): a build from before
    // expo-web-browser would otherwise lose the whole app at launch, not this link
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WebBrowser = require('expo-web-browser') as typeof import('expo-web-browser');
    WebBrowser.openBrowserAsync(url).catch(() => {});
  } catch {
    Linking.openURL(url).catch(() => {});   // no native module in this build: the phone's browser
  }
}
