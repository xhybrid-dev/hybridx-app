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
  },
  android: {
    allowMixedContent: false, // All traffic over HTTPS
  },
  ios: {
    contentInset: 'automatic',
  },
  plugins: {
    StatusBar: {
      style: 'light', // 'light' for dark icons, 'dark' for light icons
      backgroundColor: '#FFFFFF', // Match your app's light theme header
      overlaysWebView: false, // Don't overlay content, push it down
    },
    SplashScreen: {
      launchAutoHide: false,
      androidScaleType: 'CENTER_CROP',
    }
  }
};

export default config;
