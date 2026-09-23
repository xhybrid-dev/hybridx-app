
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

/**
 * Candidate Content-Security-Policy, served report-only (see `headers()` below).
 *
 * Origins are the ones this app actually talks to:
 *   *.googleapis.com / securetoken / identitytoolkit — Firebase Auth + Firestore
 *   hyroxedgeai.firebaseapp.com                      — the configured authDomain
 *   js.stripe.com / api.stripe.com                   — checkout
 *   googletagmanager.com / google-analytics.com      — GA4 (see layout.tsx)
 *   placehold.co / picsum.photos                     — images.remotePatterns above
 *   fonts.googleapis.com / fonts.gstatic.com         — kept because the PWA
 *     runtimeCaching rules expect runtime font requests, even though
 *     next/font/google self-hosts at build time
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://apis.google.com https://js.stripe.com",
  "connect-src 'self' https://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://*.firebaseio.com https://hyroxedgeai.firebaseapp.com https://api.stripe.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com",
  "img-src 'self' data: blob: https://placehold.co https://picsum.photos https://*.googleusercontent.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src https://js.stripe.com https://hyroxedgeai.firebaseapp.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

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
  // Workout reminders used to link to /workout, which has never had a page.
  // Notifications already delivered with that link still need somewhere to land.
  async redirects() {
    return [{ source: '/workout', destination: '/workout/active', permanent: false }];
  },
  // Baseline security headers applied to every response.
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
          // REPORT-ONLY, deliberately. A CSP was previously omitted altogether
          // because it had not been validated against Firebase Auth, Stripe,
          // Strava and Google AI — which is a fair reason not to *enforce* one,
          // but not a reason to have none: report-only cannot break a single
          // request, and it is the only way to find out what the real policy
          // needs to allow. Watch the violation reports in the browser console,
          // then switch the key to 'Content-Security-Policy' once it is quiet.
          //
          // 'unsafe-inline' in script-src is required by the inline gtag block in
          // src/app/layout.tsx. Moving that to a nonce or an external file is
          // what would let it be dropped.
          { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);
