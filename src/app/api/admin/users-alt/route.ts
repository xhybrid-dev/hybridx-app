// src/app/api/admin/users-alt/route.ts
// Alternative admin users endpoint using Authorization header instead of cookies
import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, getUser } from '@/services/user-service';
import { getAdminAuth } from '@/lib/firebase-admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { idToken } = body;

        if (!idToken) {
            return NextResponse.json({ error: 'ID token required' }, { status: 400 });
        }

        // Verify the ID token directly
        const decodedToken = await getAdminAuth().verifyIdToken(idToken, true);
        const userId = decodedToken.uid;

        // Get user data to check admin status
        const user = await getUser(userId);

        if (!user?.isAdmin) {
            return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
        }

        // Rate-limited like its cookie-based sibling, which goes through
        // requireAdmin. This route had no limit at all.
        const rl = checkRateLimit(`admin:users:list-alt:${userId}`, 60_000, 30);
        if (!rl.allowed) {
            return NextResponse.json(
                { error: 'Too many requests. Please wait before trying again.' },
                { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
            );
        }

        const users = await getAllUsers();
        // Counts only. This used to log a full user record (email, name) plus a
        // "first user sample" straight to Cloud Logging via console.log, which
        // bypasses the redaction logger.error applies in production.
        logger.log(`[admin/users-alt] Returned ${users.length} users to ${userId}`);

        return NextResponse.json(users);

    } catch (error) {
        // No `details` in the response: Firestore and Admin SDK messages carry
        // collection names, index URLs and sometimes document paths. The server
        // log is the right place for them.
        logger.error('[admin/users-alt] POST failed:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}