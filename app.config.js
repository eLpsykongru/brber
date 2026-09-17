// The app's config is app.json; this adds only what depends on where the queue
// page lives. A shop's queue link opens the app when it is installed (option b,
// 2026-09-15; ADDENDUM-app-first QL-19 makes it the rule). EXPO_PUBLIC_QUEUE_BASE is
// the value src/lib/qr.ts prints into posters, so the app claims exactly the host it prints.
//
// Three shapes are claimed — /q/<shop code>, a pre-0110 poster's /q/<uuid>, and
// QL-18's store hand-off /q/<shop code>/app, so a phone that already has the app
// opens it instead of the store. QL-23's form, the tickets and /c/ stay in the
// browser: a web ticket has no account to open in the app. web/src/handler.js
// serves the matching assetlinks.json and apple-app-site-association. Android's
// pathPattern has no counts, so each "." is one character. A change here needs a
// new build.
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
          { scheme: 'https', host, pathPattern: '/q/....../app' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      }],
    },
  };
};
