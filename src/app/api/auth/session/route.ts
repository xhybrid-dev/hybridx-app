// src/app/api/auth/session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase-admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
    try {
        const sessionCookie = req.cookies.get('__session')?.value;

        if (!sessionCookie) {
            return NextResponse.json({ authenticated: false }, { status: 401 });
        }

        try {
            const adminAuth = getAdminAuth();
            const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true);

            return NextResponse.json({
                authenticated: true,
                user: {
                    uid: decodedClaims.uid,
                    email: decodedClaims.email,
                }
            });
        } catch (verifyError: any) {
            logger.error('Session verification failed:', verifyError.message);
            const response = NextResponse.json({
                authenticated: false,
                error: 'Invalid session'
            }, { status: 401 });
            response.cookies.delete('__session');
            return response;
        }
    } catch (error) {
        logger.error('Session verification error:', error);
        return NextResponse.json({
            authenticated: false,
            error: 'Server error'
        }, { status: 500 });
    }
}

export async function DELETE() {
    try {
        const response = NextResponse.json({ success: true }, { status: 200 });
        response.cookies.delete('__session');
        return response;
    } catch (error) {
        logger.error('Session cookie deletion failed:', error);
        return NextResponse.json({ error: 'Failed to clear session' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    // 10 session-creation attempts per minute per IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const rl = checkRateLimit(`session:${ip}`, 60_000, 10);
    if (!rl.allowed) {
        return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, {
            status: 429,
            headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
        });
    }

    try {
        const body = await req.json();
        const { idToken } = body;

        if (!idToken) {
            return NextResponse.json({ error: 'ID token is required' }, { status: 400 });
        }

        const adminAuth = getAdminAuth();
        const decodedToken = await adminAuth.verifyIdToken(idToken, true);

        // 14 days in milliseconds (Firebase Admin SDK maximum)
        const expiresIn = 60 * 60 * 24 * 14 * 1000;
        const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

        const response = NextResponse.json({ success: true, uid: decodedToken.uid }, { status: 200 });

        const isSecure = process.env.NODE_ENV === 'production' || req.url.startsWith('https://');
        response.cookies.set('__session', sessionCookie, {
            maxAge: expiresIn / 1000,
            httpOnly: true,
            secure: isSecure,
            sameSite: 'lax',
            path: '/'
        });

        return response;

    } catch (error) {
        logger.error('Session cookie creation failed:', (error as any).code, error instanceof Error ? error.message : String(error));
        return NextResponse.json({ error: 'Failed to create session' }, { status: 401 });
    }
}
