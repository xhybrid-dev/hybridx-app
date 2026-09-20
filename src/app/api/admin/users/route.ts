// src/app/api/admin/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, deleteUser } from '@/services/user-service';
import { requireAdmin } from '@/lib/admin-auth';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdmin(request, { bucket: 'admin:users:list' });
        if ('response' in auth) return auth.response;

        const users = await getAllUsers();
        logger.log(`[admin/users] Returned ${users.length} users to ${auth.uid}`);

        return NextResponse.json(users);

    } catch (error) {
        logger.error('[admin/users] GET failed:', error);
        // No `details`: internal error text names collections and index URLs.
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const auth = await requireAdmin(request, { bucket: 'admin:users:delete', max: 10 });
        if ('response' in auth) return auth.response;
        const adminUserId = auth.uid;

        const { searchParams } = new URL(request.url);
        const targetUserId = searchParams.get('userId');

        if (!targetUserId) {
            return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
        }

        if (targetUserId === adminUserId) {
            return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
        }

        await deleteUser(targetUserId);

        return NextResponse.json({ success: true });

    } catch (error) {
        logger.error('[admin/users] DELETE failed:', error);
        // No `details`: internal error text names collections and index URLs.
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}