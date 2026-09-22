// src/app/api/debug/raw-users/route.ts
// DEBUG ENDPOINT - Never accessible in production.
import { NextResponse } from 'next/server';
import { getAllUsers } from '@/services/user-service';
import { getAdminAuth } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    // Require authentication even in development — this returns all user records.
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    try {
        await getAdminAuth().verifySessionCookie(sessionCookie, true);
    } catch {
        return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    console.log('=== DEBUG RAW USERS ===');

    try {
        console.log('🔄 Calling getAllUsers directly...');
        const users = await getAllUsers();

        console.log('📊 getAllUsers returned:', {
            isArray: Array.isArray(users),
            length: users?.length,
            type: typeof users
        });

        return NextResponse.json({
            success: true,
            userCount: users.length,
            users: users,
            summary: users.map(user => ({
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                isAdmin: user.isAdmin,
                subscriptionStatus: user.subscriptionStatus
            }))
        });

    } catch (error) {
        console.error('❌ Error in raw users debug:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        }, { status: 500 });
    }
}