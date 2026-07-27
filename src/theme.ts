// Design tokens — single source of truth for the visual system.
// "Rentra" editorial skin (design.md): warm off-white canvas, white cards,
// near-black hero surfaces, Playfair Display for display type, coral accents only.

export const colors = {
  bg: '#FFFFFF',            // cards, sheets, white surfaces
  surface: '#F2F0EB',       // warm canvas + subtle fills on white cards
  border: '#E5E2DB',
  text: '#111111',
  textSecondary: '#8A8A85',
  textTertiary: '#B9B6AD',

  accent: '#E8442E',        // coral — chips, arrows, small highlights only
  accentSoft: 'rgba(232,68,46,0.12)',
  onAccent: '#FFFFFF',

  ink: '#101010',           // hero cards, primary CTA, dark headers
  tabBg: '#101010',
  tabActive: '#2B2B28',
  tabInactiveText: '#9A9A95',

  success: '#1E8E4F',
  warning: '#9A6B00',
  danger: '#D23B3B',
  star: '#E8A100',
};

// dark surfaces for the barber dashboard + earnings (per the chosen dark mockup)
export const dark = {
  bg: '#0D0D0F',
  card: '#17171A',
  card2: '#212125',
  border: '#26262B',
  text: '#FFFFFF',
  sub: '#9A9CA3',
  barMuted: 'rgba(232,68,46,0.22)', // past-period bars: muted step of the accent hue
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
