import { Feather, Ionicons } from '@expo/vector-icons';
import { reloadAppAsync } from 'expo';
import Storage from 'expo-sqlite/kv-store';
import { I18nManager, StyleSheet } from 'react-native';
import { Lang, lang, setLang, toLang } from './i18n';

// Imported first by index.ts, ahead of App: every screen module evaluates after
// this has run, so a tr() at module scope already speaks the right language.
//
// Which language: the one picked on this phone, else the phone's own if the app
// speaks it, else French. The phone's pick wins over profiles.language — that
// column defaults to 'fr' (0039), so it cannot tell a choice from a default,
// and a new English-speaking signup would flip to French. Picking still writes
// it, for whatever sends texts later.

const KEY = 'app_language';
const FLIPPED = 'app_language_flipped';   // the reload we already tried, so it cannot loop

const read = (k: string) => { try { return Storage.getItemSync(k); } catch { return null; } };
const write = (k: string, v: string) => { try { Storage.setItemSync(k, v); } catch { /* next launch asks again */ } };

setLang(toLang(read(KEY)) ?? toLang(I18nManager.getConstants().localeIdentifier) ?? 'fr');

const rtl = lang() === 'ar';
if (I18nManager.isRTL !== rtl) {
  // first launch on this language (or Expo Go, which resets direction): set it
  // and reload once. If that did not take, draw the app as it is rather than loop.
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  if (read(FLIPPED) !== lang()) {
    write(FLIPPED, lang());
    reloadAppAsync('language direction').catch(() => {});
  }
}

if (I18nManager.isRTL) {
  // Arabic letters join. The design's tracked-out capitals put a gap between
  // every letter of an Arabic word, so tracking goes in RTL. Patched here
  // because every screen builds its StyleSheet as it loads, after this.
  const sheet = StyleSheet as { create: (styles: Record<string, any>) => any };
  const create = sheet.create;
  sheet.create = (styles) => {
    for (const k in styles) {
      if (styles[k] && typeof styles[k] === 'object' && 'letterSpacing' in styles[k]) {
        styles[k] = { ...styles[k], letterSpacing: 0 };
      }
    }
    return create(styles);
  };

  // The layout flips by itself; a glyph does not. Back points right, forward left:
  // Ionicons on the customer side, Feather in the barber's dark kit.
  const swap = (map: Record<string, number>, a: string, b: string) => {
    if (map[a] == null || map[b] == null) return;
    [map[a], map[b]] = [map[b], map[a]];
  };
  const ion = Ionicons.glyphMap as Record<string, number>;
  for (const [a, b] of [['back', 'forward'], ['back-circle', 'forward-circle']]) {
    for (const suffix of ['', '-outline', '-sharp']) {
      swap(ion, `arrow-${a}${suffix}`, `arrow-${b}${suffix}`);
      swap(ion, `chevron-${a}${suffix}`, `chevron-${b}${suffix}`);
      swap(ion, `caret-${a}${suffix}`, `caret-${b}${suffix}`);
    }
  }
  const feather = Feather.glyphMap as Record<string, number>;
  for (const name of ['arrow', 'chevron', 'chevrons']) swap(feather, `${name}-left`, `${name}-right`);
}

/** Save the pick and reload into it: new words, and a new direction if Arabic came or went. */
export async function chooseLanguage(next: Lang) {
  write(KEY, next);
  write(FLIPPED, next);
  I18nManager.allowRTL(next === 'ar');
  I18nManager.forceRTL(next === 'ar');
  await reloadAppAsync('language');
}

/** 20b's rows, each in its own language so anyone can find theirs. */
export const LANGUAGE_ROWS: { key: Lang; native: string }[] = [
  { key: 'fr', native: 'Français' },
  { key: 'ar', native: 'العربية' },
  { key: 'en', native: 'English' },
];
