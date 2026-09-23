// src/app/api/debug/firebase-collections/route.ts
// DEBUG ENDPOINT - Never accessible in production.
import { NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    // Require authentication — this endpoint exposes raw document data.
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

    console.log('=== DEBUG FIREBASE COLLECTIONS ===');

    try {
        const adminDb = getAdminDb();

        console.log('🔍 Checking Firebase connection...');

        // Try to list collections (this might not work depending on permissions)
        try {
            const collections = await adminDb.listCollections();
            console.log('📁 Available collections:', collections.map(c => c.id));
        } catch (error) {
            console.log('⚠️ Could not list collections:', error);
        }

        // Try to access the users collection directly
        console.log('👥 Checking users collection...');
        const usersCollection = adminDb.collection('users');

        // Get all documents without any ordering
        const allSnapshot = await usersCollection.get();
        console.log('📊 Found', allSnapshot.docs.length, 'documents in users collection');

        const sampleData = allSnapshot.docs.slice(0, 3).map(doc => ({
            id: doc.id,
            data: doc.data(),
            exists: doc.exists
        }));

        console.log('📋 Sample documents:', sampleData);

        // Also try with ordering to see if that's the issue
        try {
            console.log('🔄 Trying with email ordering...');
            const orderedSnapshot = await usersCollection.orderBy('email').get();
            console.log('📊 Ordered query found', orderedSnapshot.docs.length, 'documents');
        } catch (orderError) {
            console.log('❌ Ordering failed:', orderError);
        }

        return NextResponse.json({
            success: true,
            totalDocuments: allSnapshot.docs.length,
            sampleDocuments: sampleData,
            message: 'Firebase connection successful'
        });

    } catch (error) {
        console.error('❌ Firebase connection error:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false
        }, { status: 500 });
    }
}