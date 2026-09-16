// The app's config is app.json; this adds only what depends on where the queue
// page lives. Option (b), decided with the owner 2026-09-15: a shop's queue link
// opens the app when it is installed. EXPO_PUBLIC_QUEUE_BASE is the value
// src/lib/qr.ts prints into posters, so the app claims exactly the host it prints.
//
// Only the two landing shapes are claimed — /q/<shop code> and a pre-0110
// poster's /q/<uuid>. The code, join and ticket pages stay in the browser: a
// guest's ticket has no account to open in the app. web/src/handler.js serves the
// matching assetlinks.json and apple-app-site-association. Android's pathPattern
// has no counts, so each "." is one character. A change here needs a new build.
const QUEUE_BASE = process.env.EXPO_PUBLIC_QUEUE_BASE || 'https://sterncut.ma/q';

module.exports = ({ config }) => {
  const host = new URL(QUEUE_BASE).hostname;
  return {
    ...config,
    ios: { ...config.ios, associatedDomains: [`applinks:${host}`] },
    android: {
      ...config.android,
      intentFilters: [{
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host, pathPattern: '/q/......' },
          { scheme: 'https', host, pathPattern: '/q/........-....-....-....-............' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      }],
    },
  };
};
