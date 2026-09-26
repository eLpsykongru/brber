import * as WebBrowser from 'expo-web-browser';
import { lang } from './i18n';

// sterncut.ma's legal pages (WEB-14/15), in the in-app browser. The site 301s
// /{lang}/terms and /{lang}/privacy to each page's own address, so the app keeps
// the short form. A test build points EXPO_PUBLIC_QUEUE_BASE at wherever web/ is
// deployed; the legal pages live on that same host.
const SITE = (process.env.EXPO_PUBLIC_QUEUE_BASE || 'https://sterncut.ma/q').replace(/\/q\/?$/, '');

export function openLegal(page: 'terms' | 'privacy') {
  WebBrowser.openBrowserAsync(`${SITE}/${lang()}/${page}`).catch(() => {});
}
