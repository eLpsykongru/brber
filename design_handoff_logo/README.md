# SternCut — mobile brand handoff

This folder is ready to copy into a React Native / Expo project.

## Assets

| File | Size | Use |
|---|---:|---|
| `assets/icon.png` | 1024×1024 | Main app icon / iOS fallback |
| `assets/android-foreground.png` | 1024×1024 | Android adaptive foreground; transparent |
| `assets/android-background.png` | 512×512 | Optional Android background image |
| `assets/android-monochrome.png` | 1024×1024 | Android 13+ themed icon; transparent white mark |
| `assets/android-notification.png` | 96×96 | Android notification icon; transparent white mark |
| `assets/splash-icon-light.png` | 1024×1024 | Light splash logo; transparent |
| `assets/splash-icon-dark.png` | 1024×1024 | Dark splash logo; transparent |
| `assets/splash-light.png` | 1024×1024 | Preview of light splash |
| `assets/splash-dark.png` | 1024×1024 | Preview of dark splash |

## Copy into your Expo project

Copy this folder to:

`your-project/assets/sterncut/`

Then merge the contents of `EXPO_CONFIG_SNIPPET.json` into your existing `app.json` / `app.config.*`. Do not replace your existing config wholesale.

Expo supports `android.adaptiveIcon.foregroundImage`, `monochromeImage`, and `backgroundColor`. The current Expo docs also recommend configuring splash through the `expo-splash-screen` config plugin.

## Important

The supplied source logo is raster artwork. These PNGs are production-ready raster handoff assets, but there is no true SVG/vector master in this package. Keep the original logo as the design source until a vector master is created.

## Notification icon

Android notification icons should use the white silhouette asset on transparency rather than the colored launcher mark. The filename here is `android-notification.png`.
