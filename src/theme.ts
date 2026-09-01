// Design tokens — single source of truth for the visual system.
// "Rentra" editorial skin (design.md): warm off-white canvas, white cards,
// near-black hero surfaces, Playfair Display for display type, coral accents only.

export const colors = {
  bg: '#FFFFFF',            // cards, sheets, white surfaces
  surface: '#F2F0EB',       // warm canvas + subtle fills on white cards
  cardAlt: '#FAF9F6',       // nested / inset panels
  border: '#E5E2DB',
  hairline: 'rgba(0,0,0,0.06)',  // row dividers
  borderSoft: 'rgba(0,0,0,0.12)', // input + chip borders
  slotEmpty: '#EDEAE3',     // image placeholders — never a stock photo
  skeleton: '#E3E0D8',      // SYS-01 loading blocks
  skeletonSoft: '#E9E6DE',  // the lighter of the two, for large surfaces
  text: '#111111',
  textSecondary: '#8A8A85',
  textTertiary: '#B0AFAA',

  accent: '#E8442E',        // coral — chips, arrows, small highlights only
  accentSoft: 'rgba(232,68,46,0.12)',
  onAccent: '#FFFFFF',

  ink: '#101010',           // hero cards, primary CTA, dark headers
  tabBg: '#101010',
  tabActive: '#2B2B28',
  tabInactiveText: '#9A9A95',

  success: '#1F7A4D',
  // ponytail: handoff §10 says warning #E8A100, but that's 2.4:1 on white — fails
  // AA for text. Kept the darker amber for text; #E8A100 lives on as `star` for fills.
  warning: '#9A6B00',
  danger: '#D23B3B',
  star: '#E8A100',
};

// dark surfaces for the whole barber side — values lifted verbatim from
// "Barber App.dc.html" turn 1, so a screen can be checked against the mock by eye.
export const dark = {
  bg: '#0D0D0F',
  card: '#17171A',
  card2: '#212125',
  sheet: '#151517',         // bottom sheets sit a step above the canvas
  border: '#26262B',
  hairline: '#333333',      // sheet grabber + chip outlines
  muted: '#3A3A40',         // dashed borders, disabled numerals, empty dots
  text: '#FFFFFF',
  textDim: '#D8D8DC',
  sub: '#9A9CA3',
  faint: '#6B6B72',         // §10 "Faint" — labels and disabled, a step below sub
  scrim: 'rgba(0,0,0,0.6)',
  scrimDeep: 'rgba(0,0,0,0.62)',

  accent: '#E8442E',
  accentSoft: 'rgba(232,68,46,0.14)',
  accentSoft16: 'rgba(232,68,46,0.16)',
  barMuted: 'rgba(232,68,46,0.22)', // past-period bars: muted step of the accent hue

  green: '#4ADE80',
  greenSoft: 'rgba(74,222,128,0.16)',
  greenSoft10: 'rgba(74,222,128,0.10)',
  greenLine: 'rgba(74,222,128,0.28)',

  amber: '#E8A100',
  amberSoft: 'rgba(232,161,0,0.14)',
  amberSoft16: 'rgba(232,161,0,0.16)',
  amberSoft12: 'rgba(232,161,0,0.12)',
  amberLine: 'rgba(232,161,0,0.30)',

  red: '#F87171',
  redLine: 'rgba(248,113,113,0.40)',
};

// Inter, loaded in App.tsx — the mock's body face. Weights are separate families
// on RN, so fontWeight is a no-op once fontFamily is set; use these instead.
export const inter = {
  r: 'Inter_400Regular',
  m: 'Inter_500Medium',
  sb: 'Inter_600SemiBold',
  b: 'Inter_700Bold',
  eb: 'Inter_800ExtraBold',
};

export const radius = { sm: 10, md: 16, lg: 20, xl: 24, pill: 999 };

// 4pt rhythm
export const sp = (n: number) => n * 4;

export const font = {
  title: 24,
  h2: 18,
  body: 15,
  small: 13,
  tiny: 11,
};

// Playfair Display, loaded in App.tsx. Uppercase + slight letter-spacing at use sites.
export const serif = 'PlayfairDisplay_700Bold';
export const serifBlack = 'PlayfairDisplay_800ExtraBold';

// barely-there elevation — separation comes from surface vs bg contrast (design.md)
export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

export const shadowLg = {
  shadowColor: '#000',
  shadowOpacity: 0.14,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 10 },
  elevation: 8,
};
