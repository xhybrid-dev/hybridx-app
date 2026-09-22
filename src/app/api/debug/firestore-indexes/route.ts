// src/app/api/debug/firestore-indexes/route.ts
// DEBUG ENDPOINT - Never accessible in production.
import { NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    // Require authentication — exposes user document field names and email values.
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

    console.log('=== DEBUG FIRESTORE INDEXES ===');

    const results: any = {
        tests: [],
        recommendations: [],
        errors: [],
        success: false
    };

    try {
        const adminDb = getAdminDb();
        const usersCollection = adminDb.collection('users');

        // Test 1: Basic collection access (no ordering)
        console.log('🧪 Test 1: Basic collection access...');
        try {
            const basicSnapshot = await usersCollection.get();
            results.tests.push({
                test: 'Basic Collection Access',
                status: 'success',
                documentCount: basicSnapshot.docs.length,
                message: `Found ${basicSnapshot.docs.length} documents`
            });
            console.log('✅ Basic access successful:', basicSnapshot.docs.length, 'documents');
        } catch (error) {
            results.tests.push({
                test: 'Basic Collection Access',
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
            });
            results.errors.push(`Basic collection access failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Test 2: Order by email (the problematic query)
        console.log('🧪 Test 2: Order by email...');
        try {
            const emailOrderSnapshot = await usersCollection.orderBy('email').get();
            results.tests.push({
                test: 'Order by Email',
                status: 'success',
                documentCount: emailOrderSnapshot.docs.length,
                message: `Successfully ordered by email: ${emailOrderSnapshot.docs.length} documents`
            });
            console.log('✅ Email ordering successful:', emailOrderSnapshot.docs.length, 'documents');
        } catch (error) {
            results.tests.push({
                test: 'Order by Email',
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
                indexRequired: true
            });
            results.errors.push(`Email ordering failed: ${error instanceof Error ? error.message : String(error)}`);

            if (error instanceof Error ? error.message : String(error).includes('index')) {
                results.recommendations.push({
                    type: 'index',
                    message: 'Create a single-field index on the "email" field',
                    action: 'Go to Firebase Console > Firestore > Indexes and create a single-field index for "email"'
                });
            }
        }

        // Test 3: Check if email field exists in documents
        console.log('🧪 Test 3: Check email field existence...');
        try {
            const sampleSnapshot = await usersCollection.limit(5).get();
            const emailFieldAnalysis = sampleSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    docId: doc.id,
                    hasEmail: !!data.email,
                    emailValue: data.email,
                    allFields: Object.keys(data)
                };
            });

            const docsWithEmail = emailFieldAnalysis.filter(doc => doc.hasEmail).length;
            const docsWithoutEmail = emailFieldAnalysis.length - docsWithEmail;

            results.tests.push({
                test: 'Email Field Analysis',
                status: 'success',
                totalDocs: emailFieldAnalysis.length,
                docsWithEmail,
                docsWithoutEmail,
                sampleData: emailFieldAnalysis
            });

            if (docsWithoutEmail > 0) {
                results.recommendations.push({
                    type: 'data',
                    message: `${docsWithoutEmail} documents are missing email fields`,
                    action: 'Add email fields to all user documents or filter queries to only include documents with email'
                });
            }

            console.log(`📊 Email field analysis: ${docsWithEmail} with email, ${docsWithoutEmail} without`);
        } catch (error) {
            results.tests.push({
                test: 'Email Field Analysis',
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Test 4: Alternative queries
        console.log('🧪 Test 4: Alternative ordering strategies...');

        // Try ordering by document ID (always works)
        try {
            const idOrderSnapshot = await usersCollection.orderBy('__name__').get();
            results.tests.push({
                test: 'Order by Document ID',
                status: 'success',
                documentCount: idOrderSnapshot.docs.length,
                message: 'Document ID ordering works as fallback'
            });
        } catch (error) {
            results.tests.push({
                test: 'Order by Document ID',
                status: 'error',
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Test 5: Check for other commonly indexed fields
        const commonFields = ['firstName', 'lastName', 'createdAt', 'updatedAt'];
        for (const field of commonFields) {
            try {
                await usersCollection.orderBy(field).limit(1).get();
                results.tests.push({
                    test: `Order by ${field}`,
                    status: 'success',
                    message: `${field} field is indexed and can be used for ordering`
                });
            } catch (error) {
                results.tests.push({
                    test: `Order by ${field}`,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        results.success = true;
        results.summary = {
            totalTests: results.tests.length,
            passedTests: results.tests.filter((t: any) => t.status === 'success').length,
            failedTests: results.tests.filter((t: any) => t.status === 'error').length
        };

        return NextResponse.json(results);

    } catch (error) {
        console.error('❌ Firestore index debug error:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false,
            tests: results.tests
        }, { status: 500 });
    }
}