import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'club.hybridx.app',
  appName: 'HYBRIDX.CLUB',
  // The apps load the live site (server.url), so only a tiny local shell is
  // bundled: native-shell/offline.html is shown when the site can't be reached
  // (no connection) instead of a blank WebView. `next build` produces a server
  // bundle, not static files, so it can't be the webDir.
  webDir: 'native-shell',
  server: {
    url: 'https://app.hybridx.club',
    cleartext: false, // Use HTTPS only
    errorPath: 'offline.html',
    // Capacitor sends every other domain to the phone's browser, which doesn't
    // have the app's session cookie, so connecting Strava or Garmin always came
    // back "session expired". Keep their sign-in pages inside the app so the
    // OAuth redirect lands back here, logged in.
    allowNavigation: ['www.strava.com', 'connect.garmin.com', 'sso.garmin.com'],
  },
  // Lets the server recognise the apps (src/app/page.tsx sends them past the
  // marketing page). Keep the "HYBRIDXApp/" prefix in sync with that check.
  appendUserAgent: 'HYBRIDXApp/1',
  android: {
    allowMixedContent: false, // All traffic over HTTPS
  },
  ios: {
    // The layout pads itself for the notch and home bar with env(safe-area-inset-*)
    // (viewportFit: 'cover'), exactly as the home-screen web app does. 'automatic'
    // would make iOS inset the page as well, doubling the gap under the status bar.
    contentInset: 'never',
  },
  plugins: {
    StatusBar: {
      style: 'LIGHT', // dark icons until NativeAppBridge applies the app theme
      backgroundColor: '#FFFFFF', // Match your app's light theme header
      overlaysWebView: false, // Don't overlay content, push it down
    }
  }
};

export default config;
