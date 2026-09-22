
import { logger } from '@/lib/logger';
// src/services/user-service-client.ts
// This file contains functions for client-side components. NO 'use server' here.

import { collection, doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User } from '@/models/types';

export async function getUserClient(userId: string): Promise<User | null> {
    const docRef = doc(db, 'users', userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        // Fallback for trial start date if it's missing
        const trialStartDate = data.trialStartDate instanceof Timestamp 
            ? data.trialStartDate.toDate() 
            : new Date();

        const user: User = {
            id: docSnap.id,
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            experience: data.experience,
            frequency: data.frequency,
            goal: data.goal,
            programId: data.programId,
            startDate: data.startDate instanceof Timestamp ? data.startDate.toDate() : undefined,
            personalRecords: data.personalRecords || {},
            runningProfile: data.runningProfile || { benchmarkPaces: {} },
            strava: data.strava ? { ...data.strava, expiresAt: data.strava.expiresAt instanceof Timestamp ? data.strava.expiresAt.toDate() : new Date(data.strava.expiresAt) } : undefined,
            lastStravaSync: data.lastStravaSync instanceof Timestamp ? data.lastStravaSync.toDate() : undefined,
            garmin: data.garmin ? {
                ...data.garmin,
                expiresAt: data.garmin.expiresAt instanceof Timestamp ? data.garmin.expiresAt.toDate() : new Date(data.garmin.expiresAt),
                refreshExpiresAt: data.garmin.refreshExpiresAt instanceof Timestamp ? data.garmin.refreshExpiresAt.toDate() : data.garmin.refreshExpiresAt ? new Date(data.garmin.refreshExpiresAt) : undefined,
            } : undefined,
            garminConnectedAt: data.garminConnectedAt instanceof Timestamp ? data.garminConnectedAt.toDate() : undefined,
            customProgram: data.customProgram || null,
            isAdmin: data.isAdmin || false,
            // Fallback for subscription status if it's missing
            subscriptionStatus: data.subscriptionStatus || 'trial',
            stripeCustomerId: data.stripeCustomerId,
            subscriptionId: data.subscriptionId,
            trialStartDate: trialStartDate,
            cancel_at_period_end: data.cancel_at_period_end,
            cancellation_effective_date: data.cancellation_effective_date instanceof Timestamp ? data.cancellation_effective_date.toDate() : undefined,
            notificationTime: data.notificationTime ?? undefined,
            completedWorkouts: data.completedWorkouts ?? undefined,
            onboardingSkipped: data.onboardingSkipped ?? false,
            planPausedAt: data.planPausedAt instanceof Timestamp ? data.planPausedAt.toDate() : null,
        };
        return user;
    }
    return null;
}

export async function createUser(userId: string, data: Omit<User, 'id' | 'personalRecords'>): Promise<User> {
    const usersCollection = collection(db, 'users');
    const userRef = doc(usersCollection, userId);
    const trialStartDate = new Date();

    // This is the data that will be saved to Firestore.
    // It correctly includes the subscription status and trial start date.
    const userDataToSet: any = {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        experience: data.experience,
        frequency: data.frequency,
        goal: data.goal,
        programId: data.programId ?? null,
        startDate: data.startDate ? Timestamp.fromDate(data.startDate) : null,
        personalRecords: {},
        runningProfile: { benchmarkPaces: {} },
        strava: null,
        customProgram: data.customProgram ?? null,
        isAdmin: false,
        subscriptionStatus: 'trial',
        stripeCustomerId: null,
        subscriptionId: null,
        trialStartDate: Timestamp.fromDate(trialStartDate),
        onboardingSkipped: data.onboardingSkipped ?? false,
        acquisitionSource: data.acquisitionSource ?? null,
        acquisitionMedium: data.acquisitionMedium ?? null,
        acquisitionCampaign: data.acquisitionCampaign ?? null,
        acquisitionTerm: data.acquisitionTerm ?? null,
        acquisitionContent: data.acquisitionContent ?? null,
        acquisitionLandingPage: data.acquisitionLandingPage ?? null,
        acquisitionReferrer: data.acquisitionReferrer ?? null,
    };
    await setDoc(userRef, userDataToSet);

    // This is the user object returned to the application after creation.
    const createdUser: User = {
        id: userId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        experience: data.experience,
        frequency: data.frequency,
        goal: data.goal,
        programId: data.programId ?? null,
        startDate: data.startDate,
        customProgram: data.customProgram ?? null,
        personalRecords: {},
        runningProfile: { benchmarkPaces: {} },
        isAdmin: false,
        subscriptionStatus: 'trial',
        trialStartDate: trialStartDate,
        onboardingSkipped: data.onboardingSkipped ?? false,
        acquisitionSource: data.acquisitionSource,
        acquisitionMedium: data.acquisitionMedium,
        acquisitionCampaign: data.acquisitionCampaign,
        acquisitionTerm: data.acquisitionTerm,
        acquisitionContent: data.acquisitionContent,
        acquisitionLandingPage: data.acquisitionLandingPage,
        acquisitionReferrer: data.acquisitionReferrer,
    };
    return createdUser;
}

export async function updateUser(userId: string, data: Partial<Omit<User, 'id'>>): Promise<void> {
    const usersCollection = collection(db, 'users');
    const userRef = doc(usersCollection, userId);
    const dataToUpdate: { [key: string]: any } = { ...data };

    if (data.startDate) {
        dataToUpdate.startDate = Timestamp.fromDate(data.startDate);
    }
    if (data.trialStartDate) {
        dataToUpdate.trialStartDate = Timestamp.fromDate(data.trialStartDate);
    }
    if (data.strava?.expiresAt) {
        dataToUpdate.strava.expiresAt = Timestamp.fromDate(data.strava.expiresAt);
    }
    if (data.lastStravaSync) {
        dataToUpdate.lastStravaSync = Timestamp.fromDate(data.lastStravaSync);
    }
    
    await updateDoc(userRef, dataToUpdate);
}

// Helper function to wait for auth state
async function waitForAuth(auth: any, timeoutMs = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            unsubscribe();
            reject(new Error('Authentication timeout'));
        }, timeoutMs);

        const unsubscribe = auth.onAuthStateChanged((user: any) => {
            if (user) {
                clearTimeout(timeout);
                unsubscribe();
                resolve(user);
            }
        });

        // If user is already available, resolve immediately
        if (auth.currentUser) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(auth.currentUser);
        }
    });
}

// Admin function to get all users
export async function getAllUsersClient(): Promise<User[]> {
    logger.log('🔄 Starting getAllUsersClient...');

    try {
        // First ensure we have a valid session cookie
        const { getAuthInstance } = await import('@/lib/firebase');
        const auth = await getAuthInstance();

        logger.log('🔐 Auth instance created, checking current user...');
        logger.log('👤 Current user exists:', !!auth.currentUser);

        let currentUser = auth.currentUser;

        // If no current user, wait for auth state to be ready
        if (!currentUser) {
            logger.log('⏳ No current user, waiting for auth state...');
            try {
                currentUser = await waitForAuth(auth, 5000); // 5 second timeout
                logger.log('✅ Auth state resolved, user found:', !!currentUser);
            } catch (authError) {
                logger.error('❌ Auth state timeout or error:', authError);
                throw new Error('Please log in to access admin features');
            }
        }

        // Create session cookie if needed
        logger.log('🔑 Getting fresh ID token...');
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }
        const idToken = await currentUser.getIdToken(true);

        logger.log('🍪 Creating session cookie...');
        const sessionResponse = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
            credentials: 'include',
        });

        if (!sessionResponse.ok) {
            logger.error('❌ Session creation failed:', sessionResponse.status);
            throw new Error('Failed to create authentication session');
        }

        logger.log('✅ Session cookie created successfully');

        // First try the cookie-based approach
        logger.log('🔄 Making API call to /api/admin/users (cookie-based)...');
        let response = await fetch('/api/admin/users', {
            method: 'GET',
            credentials: 'include',
        });

        logger.log('📡 API response status:', response.status, response.statusText);

        // If cookie-based fails, try the alternative approach with direct token
        if (!response.ok && response.status === 401) {
            logger.log('🔄 Cookie approach failed, trying alternative with direct token...');
            response = await fetch('/api/admin/users-alt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken }),
                credentials: 'include',
            });
            logger.log('📡 Alternative API response status:', response.status, response.statusText);
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            logger.error('❌ API error response:', errorData);
            throw new Error(errorData.error || 'Failed to fetch users');
        }

        const userData = await response.json();
        logger.log('📊 Received user data:', {
            isArray: Array.isArray(userData),
            length: userData?.length,
            firstUser: userData?.[0] ? {
                id: userData[0].id,
                email: userData[0].email,
                hasRequiredFields: !!(userData[0].email && userData[0].experience && userData[0].goal)
            } : null
        });

        return userData;

    } catch (error) {
        logger.error('❌ getAllUsersClient error:', error);
        throw error;
    }
}
