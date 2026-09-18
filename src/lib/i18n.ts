// French and Arabic. Pure, so `npm run check` can compile anything that calls tr().
//
// tr, not t: t is a timer, a thread or a tag in half the screens already.
//
// The English sentence is the key: the code keeps reading like the screen it
// draws, and a sentence nobody has translated yet still shows, in English,
// instead of a key name. `npm run i18n` lists the ones missing.
//
// The language is set once, before any screen module loads (lib/language.ts),
// and changing it reloads the app — Arabic has to flip the layout anyway, and a
// reload is the only way React Native does that. So tr() may run at module scope.

import DICT from './i18n.dict';

export type Lang = 'en' | 'fr' | 'ar';

let current: Lang = 'en';

export const lang = (): Lang => current;
export function setLang(next: Lang) { current = next; }

/**
 * profiles.language (0039) defaults to 'fr', and 20b once offered Darija and
 * Spanish too. Darija reads the Arabic; anything else falls through to the caller.
 */
export function toLang(code: string | null | undefined): Lang | null {
  const c = (code ?? '').toLowerCase();
  if (c === 'ary' || c.startsWith('ar')) return 'ar';
  if (c.startsWith('fr')) return 'fr';
  if (c.startsWith('en')) return 'en';
  return null;
}

type Vars = Record<string, string | number | null | undefined>;

const fill = (text: string, vars?: Vars) => (vars
  ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? '') : m))
  : text);

const row = (en: string) => (current === 'en' ? undefined : DICT[en]?.[current === 'fr' ? 0 : 1]);

/** A sentence in the current language. `{name}` in it is filled from vars. */
export function tr(en: string, vars?: Vars): string {
  return fill(row(en) || en, vars);
}

/**
 * A sentence with a styled or tappable piece inside, translated whole so the
 * piece can move: "Pay <b>{amount}</b> at the shop" renders `b` through tags.b.
 * Returns strings and whatever the tags return, ready to sit inside a <Text>.
 */
export function trRich<N>(en: string, tags: Record<string, (text: string, key: number) => N>, vars?: Vars): (string | N)[] {
  const text = row(en) || en;
  const out: (string | N)[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0, key = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(fill(text.slice(last, m.index), vars));
    const inner = fill(m[2], vars);
    out.push(tags[m[1]] ? tags[m[1]](inner, key++) : inner);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(fill(text.slice(last), vars));
  return out;
}

/** Marks English that is kept as data and translated where it shows: tr(tag). */
export const en = (text: string) => text;

/**
 * A sentence that changes with a count, keyed on its two English forms ("one|other"). French
 * takes one|other (0 and 1 are singular); Arabic one|two|few|many, where few is
 * 3–10 and zero, and many is 11 and up. `{n}` is always the count.
 */
export function trn(n: number, one: string, other: string, vars?: Vars): string {
  const all = { n, ...vars };
  const forms = row(`${one}|${other}`)?.split('|');
  if (!forms) return fill(n === 1 ? one : other, all);
  let i: number;
  if (current === 'fr') i = Math.abs(n) < 2 ? 0 : 1;
  else {
    const m = Math.abs(n) % 100;
    i = n === 1 ? 0 : n === 2 ? 1 : n === 0 || (m >= 3 && m <= 10) ? 2 : 3;
  }
  return fill(forms[Math.min(i, forms.length - 1)], all);
}

/** A weekday's name, Sunday = 0 as Date.getDay() counts, capitalised the way a label is. */
export function weekdayName(i: number, width: 'long' | 'short' = 'long'): string {
  const name = new Date(2023, 0, 1 + i).toLocaleDateString(loc('en-GB'), { weekday: width });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The locale for a date or a time. English keeps whichever of en-US / en-GB the
 * screen already asked for; Moroccan French and Arabic keep Western digits
 * ("Numbers stay LTR inside Arabic lines") and Morocco's own month names.
 */
export function loc(english: 'en-US' | 'en-GB' = 'en-GB'): string {
  return current === 'fr' ? 'fr-MA' : current === 'ar' ? 'ar-MA' : english;
}

/** "Mon Jul 21" the way toDateString() writes it in English; the same in French or Arabic. */
export function weekdayDate(d: Date, withDate = true): string {
  if (current === 'en') return d.toDateString().slice(0, withDate ? 10 : 3);
  return d.toLocaleDateString(loc(), withDate ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short' });
}
