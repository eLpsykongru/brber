// Design tokens — single source of truth for the visual system.
// Extracted from the salon-template mockups: coral accent, white cards, dark pill tab bar.

export const colors = {
  bg: '#FFFFFF',
  surface: '#F6F6F8',       // input fields, subtle fills
  border: '#ECECEF',
  text: '#17181C',
  textSecondary: '#6E7076',
  textTertiary: '#A0A2A8',

  accent: '#E8474F',        // coral — 4.6:1 on white, AA for normal text
  accentSoft: '#FDE7E8',    // soft pink chips
  onAccent: '#FFFFFF',

  tabBg: '#1C1D22',
  tabActive: '#36373E',
  tabInactiveText: '#A6A8AF',

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
  barMuted: 'rgba(232,71,79,0.22)', // past-period bars: muted step of the accent hue
};

export const radius = { sm: 10, md: 14, lg: 18, pill: 999 };

// 4pt rhythm
export const sp = (n: number) => n * 4;

export const font = {
  title: 24,
  h2: 18,
  body: 15,
  small: 13,
  tiny: 11,
};
