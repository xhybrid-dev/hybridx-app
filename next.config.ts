
import type {NextConfig} from 'next';

const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  sw: 'sw.js',
  customWorkerDir: 'worker',
  // Precache the app shell ONLY.
  //
  // next-pwa globs all of `public/` by default, and a Workbox precache is
  // all-or-nothing: the service worker's install event does not resolve until
  // every entry has downloaded. With no exclusions that came to 16.4MB on a
  // first visit — 11.9MB of it from public/, including a 10MB Android APK, the
  // 1.2MB hero image, an internal API PDF and three CSV fixtures. On a metered
  // mobile connection that is most of a day's data for a page that renders in
  // well under 1MB, and it re-downloaded on every deploy that touched them.
  //
  // next-pwa globs `['**/*', ...publicExcludes]` over public/, so each `!entry`
  // below subtracts from "everything". What survives is the app shell: the two
  // logos, the manifest, and the custom worker.
  publicExcludes: [
    // The Android beta build. Not part of the web app, and 10MB on its own.
    // Still served at /hybridx.apk for anyone holding that link.
    '!hybridx.apk',
    // Landing-page hero. next/image requests the optimised /_next/image?url=…
    // variant, never this original, so precaching it only ever wasted 1.2MB.
    '!coverimage.jpg',
    // Internal documentation and data fixtures — nothing in the app fetches these.
    '!*.pdf',
    '!*.csv',
    '!*.md',
    // Email templates. Read server-side with fs.readFile (see
    // /api/beta-testing/request), so a browser never requests them.
    '!*.html',
  ],
  // Source maps are for debugging, not for offline use.
  buildExcludes: [/\.map$/],
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts',
        expiration: {
          maxEntries: 30,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        },
      },
    },
    {
      urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'firestore-api',
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 5 * 60, // 5 minutes
        },
      },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: {
          maxEntries: 60,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        },
      },
    },
    {
      urlPattern: /^https:\/\/.*\.firebaseapp\.com\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'firebase-auth',
        networkTimeoutSeconds: 10,
      },
    },
  ],
});

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    // Type errors fail the build. The codebase currently typechecks clean
    // (npm run typecheck) — keep it that way rather than shipping silent errors.
    ignoreBuildErrors: false,
  },
  serverExternalPackages: ['handlebars', 'dotprompt', '@genkit-ai/core', 'genkit'],
  allowedDevOrigins: ['*.cloudworkstations.dev'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Baseline security headers applied to every response.
  // NOTE: a strict Content-Security-Policy is intentionally omitted here — it
  // needs to be validated against Firebase Auth, Stripe, Strava and Google AI
  // origins before enabling, or it will break those integrations.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);
