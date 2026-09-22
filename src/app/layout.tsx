
import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/contexts/theme-context';
import { AuthProvider } from '@/components/AuthProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

export const metadata: Metadata = {
  title: 'HYBRIDX.CLUB',
  description: 'Your AI-powered partner for peak HYROX performance.',
  ...(process.env.NODE_ENV === 'production' ? { manifest: '/manifest.json' } : {}),
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover', // Important for PWA with safe areas
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <head>
        <link rel="icon" href="/icon-logo.png" sizes="any" />
        <meta name="application-name" content="HYBRIDX.CLUB" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="HYBRIDX.CLUB" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0A0A0A" media="(prefers-color-scheme: dark)" />

        {/* Apple Touch Icon — must be fully opaque: iOS fills any
            transparent pixels with black on "Add to Home Screen",
            which turned this into a black logo on a black tile. */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Google tag (gtag.js) — same GA4 property + linker config as
            hybridx.club, so a visitor who clicks through from the marketing
            site into the app keeps a single stitched session. */}
        <Script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-XKH1WYE7CQ"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-XKH1WYE7CQ', {
              linker: { domains: ['hybridx.club', 'app.hybridx.club'] }
            });
          `}
        </Script>
      </head>
      <body className="font-body antialiased">
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
