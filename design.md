# Design System — "Rentra" style

Reference: premium rental app screen (dark hero, off-white canvas, stat card grid, pill CTA bar).
Target: React Native / Expo (SDK 54).

## Mood

Premium, editorial, calm. One accent color used sparingly. Lots of whitespace,
big serif display type, near-black surfaces against a warm off-white canvas.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#F2F0EB` | Screen background (warm off-white) |
| `surface` | `#FFFFFF` | Cards, bottom bar |
| `ink` | `#111111` | Primary text, logo, CTA button |
| `inkMuted` | `#8A8A85` | Labels, captions, units |
| `heroSurface` | `#101010` | Dark image/hero card |
| `heroText` | `#FFFFFF` | Text over hero |
| `accent` | `#E8442E` | Arrow chips, small highlights only |
| `border` | `#E5E2DB` | Hairline dividers (use sparingly) |

Rules: accent never fills large areas — icons/chips only. Text on `bg`/`surface`
is always `ink` or `inkMuted` (both pass 4.5:1 on these surfaces).

## Typography

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Display (screen title) | Serif display — `PlayfairDisplay_700Bold` (`@expo-google-fonts/playfair-display`) | 34–40, uppercase, +2% letter-spacing | e.g. "PORSCHE 816" |
| Stat value | Sans — `Inter_700Bold` | 24 | Number bold… |
| Stat unit | Sans — `Inter_400Regular` | 13, `inkMuted` | …unit small, inline after value |
| Label / caption | Sans — `Inter_500Medium` | 13, `inkMuted` | "Top Speed", "Fuel Tank" |
| Button | Sans — `Inter_600SemiBold` | 15, uppercase | "BOOK" |
| Price | `Inter_700Bold` 18 + `/ Per Day` in 13 `inkMuted` | | tabular figures for prices |

Two families max: one serif for display, one sans for everything else.

## Shape & elevation

- Card radius: **20**; hero card: **24**; pills/buttons: **fully rounded** (`borderRadius: 999`).
- Shadows: barely there — `shadowOpacity 0.06, radius 12, offset (0,4)`, `elevation 2`. Separation comes from `surface` vs `bg` contrast, not shadows.
- No borders on cards; hairline `border` only for dividers inside a surface.

## Spacing

4/8 grid. Screen gutter **20**. Gap between cards **12**. Card padding **16–20**.
Section gap **24–32**. Bottom CTA bar sits above safe area with 12 inset.

## Layout patterns

1. **Header row**: logo left, circular icon button (40×40, `surface`, hairline) right.
2. **Display title**: serif, uppercase, centered or left, directly above hero.
3. **Hero card**: full-bleed-ish dark image card (`heroSurface`), radius 24, ~45% of screen height.
4. **Stat grid**: 2×2 `surface` cards. Each: value+unit top, label bottom-left, 28×28 accent arrow chip bottom-right (`accent` circle at 12% opacity, arrow glyph in `accent`).
5. **Bottom bar**: fixed white pill spanning gutters — price left, black fully-rounded CTA button right (height ≥ 52).

## Components (RN)

- Buttons: `Pressable` with `opacity 0.85` pressed state, min height 44.
- Icons: `@expo/vector-icons` (Feather `arrow-up-right`) — one family, no emoji.
- Stat cards: plain `View`s in a `flexDirection: 'row', flexWrap: 'wrap', gap: 12` container.
- Bottom bar: `position: absolute` + `useSafeAreaInsets().bottom`, and give scroll content matching `paddingBottom`.

## Anti-patterns

- No gradients, no glassmorphism, no colored shadows.
- Accent on more than ~2 elements per screen.
- Mixed icon sets or emoji icons.
- Heavy borders + shadow on the same card.
