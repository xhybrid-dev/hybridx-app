// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Does this look like a Firebase session cookie at all?
 *
 * The Admin SDK cannot run in the Edge runtime, so the middleware genuinely
 * cannot verify the cookie — that check belongs to (and now happens in) the
 * handlers: assertUser/assertAdmin on server actions, requireUser/requireAdmin
 * on API routes, and the /admin layout. What the middleware CAN do is stop
 * treating `__session=x` as a credential: previously any non-empty value
 * satisfied the gate, so a one-line console command reached every protected
 * route. A session cookie is a JWT, so require that shape.
 *
 * This is a filter, not authentication. Never rely on it for authorization.
 */
function looksLikeSessionJwt(value: string | undefined): boolean {
  if (!value) return false;
  const parts = value.split('.');
  // header.payload.signature, each base64url and none of them empty. Real
  // Firebase session cookies run to several hundred characters.
  return (
    parts.length === 3 &&
    value.length >= 100 &&
    parts.every(p => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p))
  );
}

export async function middleware(request: NextRequest) {
  const sessionCookie = looksLikeSessionJwt(request.cookies.get('__session')?.value)
    ? request.cookies.get('__session')
    : undefined;
  const { pathname } = request.nextUrl;

  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/signup', '/forgot-password', '/privacy-policy', '/terms'];
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route)) || pathname === '/';

  // Allow public routes without authentication
  if (isPublicRoute) {
    // If user has session and tries to access login, signup, OR the root landing page, redirect to dashboard
    if (sessionCookie && (pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname === '/')) {
      console.log(`✅ [Middleware] Session exists, redirecting from ${pathname} to /dashboard`);
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  // Protected routes - require session cookie
  if (!sessionCookie) {
    console.log('🚫 [Middleware] No session cookie, redirecting to login');
    const response = NextResponse.redirect(new URL('/login', request.url));
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder files (images, manifests, etc.)
     * - api routes (handle their own auth)
     * - sw.js and related service worker files
     */
    '/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest\\.json|sw.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|api/).*)',
  ],
};
