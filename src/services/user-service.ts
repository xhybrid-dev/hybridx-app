// src/services/user-service.ts
'use server';

import { logger } from '@/lib/logger';

import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin'; // Use Admin SDK for server-side
import { getAuth } from 'firebase-admin/auth';
import type { User, SubscriptionStatus } from '@/models/types';
import { sendWelcomeEmail } from '@/lib/email-service';
import { emitMarketingEventAsync } from '@/lib/marketing/events';

// Helper function to safely convert Firestore timestamp to Date
function safeToDate(timestamp: any): Date | undefined {
  if (!timestamp) return undefined;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp.toDate === 'function') return timestamp.toDate();
  if (typeof timestamp === 'string' || typeof timestamp === 'number') return new Date(timestamp);
  return undefined;
}

// SERVER-SIDE function using Admin SDK
export async function getUser(userId: string): Promise<User | null> {
    const adminDb = getAdminDb();
    const usersCollection = adminDb.collection('users');
    const docRef = usersCollection.doc(userId);
    const docSnap = await docRef.get();

    if (docSnap.exists) {
        const data = docSnap.data();
        if (!data) return null;
        
        // Correctly handle the nested expiresAt timestamp within the strava object
        const stravaData = data.strava ? {
            ...data.strava,
            expiresAt: safeToDate(data.strava.expiresAt)!
        } : undefined;

        const garminData = data.garmin ? {
            ...data.garmin,
            expiresAt: safeToDate(data.garmin.expiresAt)!,
            refreshExpiresAt: safeToDate(data.garmin.refreshExpiresAt),
        } : undefined;

        const user: User = {
            id: docSnap.id,
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            experience: data.experience,
            frequency: data.frequency,
            goal: data.goal,
            programId: data.programId,
            startDate: safeToDate(data.startDate),
            timeZone: data.timeZone,
            personalRecords: data.personalRecords || {},
            runningProfile: data.runningProfile || { benchmarkPaces: {} },
            strava: stravaData,
            lastStravaSync: safeToDate(data.lastStravaSync),
            garmin: garminData,
            garminConnectedAt: safeToDate(data.garminConnectedAt),
            pendingGarminAuth: data.pendingGarminAuth,
            garminPlanSync: data.garminPlanSync ? {
                ...data.garminPlanSync,
                lastSyncedAt: safeToDate(data.garminPlanSync.lastSyncedAt) || new Date(0),
            } : undefined,
            customProgram: data.customProgram || null,
            isAdmin: data.isAdmin || false,
            subscriptionStatus: data.subscriptionStatus || 'trial',
            stripeCustomerId: data.stripeCustomerId,
            subscriptionId: data.subscriptionId,
            trialStartDate: safeToDate(data.trialStartDate) || new Date(),
            cancel_at_period_end: data.cancel_at_period_end,
            cancellation_effective_date: safeToDate(data.cancellation_effective_date),
        };
        return user;
    } else {
        // The user exists in Auth but not in Firestore. Let's create their document.
        logger.warn(`User document not found for UID: ${userId}. Creating one now.`);
        try {
            const authUser = await getAuth().getUser(userId);
            if (!authUser.email) {
                logger.error(`User ${userId} does not have an email in Firebase Auth.`);
                return null;
            }

            const trialStartDate = new Date();
            const newUser: Omit<User, 'id'> = {
                email: authUser.email,
                firstName: '', // Default value, user can update in profile
                lastName: '',  // Default value, user can update in profile
                experience: 'beginner',
                frequency: '3',
                goal: 'hybrid',
                programId: null,
                startDate: undefined,
                personalRecords: {},
                runningProfile: { benchmarkPaces: {} },
                strava: undefined,
                customProgram: null,
                isAdmin: false,
                subscriptionStatus: 'trial',
                trialStartDate: trialStartDate,
            };

            await docRef.set(newUser);
            logger.log(`Successfully created Firestore document for user ${userId}`);

            // Send welcome email to new user
            if (newUser.email) {
                // We don't await this so it doesn't block the user creation flow
                sendWelcomeEmail(newUser.email).catch(e => 
                    logger.error(`Failed to send welcome email to ${newUser.email}:`, e)
                );

                // Raise the marketing trigger so a welcome journey can enrol.
                // Fire-and-forget by design — a marketing automation must never
                // be able to fail account creation.
                emitMarketingEventAsync('signup', { userId, email: newUser.email });
            }
            
            return {
                id: userId,
                ...newUser,
            };

        } catch (error) {
            logger.error(`Failed to create Firestore document for user ${userId}:`, error);
            return null;
        }
    }
}

// SERVER-SIDE update function
export async function updateUserAdmin(userId: string, data: Partial<Omit<User, 'id'>>): Promise<void> {
    const adminDb = getAdminDb();
    const userRef = adminDb.collection('users').doc(userId);
    const dataToUpdate: { [key: string]: any } = { ...data };

    // Convert any Date objects to Firestore Timestamps before updating
    if (data.startDate) {
        dataToUpdate.startDate = Timestamp.fromDate(data.startDate);
    }
    if (data.trialStartDate) {
        dataToUpdate.trialStartDate = Timestamp.fromDate(data.trialStartDate);
    }
    if (data.strava?.expiresAt) {
        // Ensure nested objects are handled correctly
        dataToUpdate.strava = {
            ...data.strava,
            expiresAt: Timestamp.fromDate(data.strava.expiresAt)
        };
    }
    if (data.lastStravaSync) {
        dataToUpdate.lastStravaSync = Timestamp.fromDate(data.lastStravaSync);
    }
    if (data.cancellation_effective_date) {
        dataToUpdate.cancellation_effective_date = Timestamp.fromDate(data.cancellation_effective_date);
    }


    await userRef.update(dataToUpdate);
}

// Helper function to determine correct subscription status
function determineSubscriptionStatus(
    storedStatus: string | undefined,
    stripeCustomerId: string | undefined,
    subscriptionId: string | undefined | null,
    trialStartDate: Date | undefined,
    cancel_at_period_end: boolean | undefined,
    cancellation_effective_date: Date | undefined
): SubscriptionStatus {
    const now = new Date();
    
    // Admin users always have 'active' status internally for access
    if (storedStatus === 'admin') return 'active';

    // Active subscription from Stripe is the highest priority
    if (storedStatus === 'active' && stripeCustomerId && subscriptionId) {
        return 'active';
    }

    // Handle paused state
    if (storedStatus === 'paused') {
        return 'paused';
    }
    
    // Handle cancelled state (still has access until period end)
    if (cancel_at_period_end && cancellation_effective_date && now < cancellation_effective_date) {
        return 'active'; // Still active until period end
    }
    
    if (cancel_at_period_end && cancellation_effective_date && now >= cancellation_effective_date) {
        return 'canceled';
    }

    // Trial period logic
    if (trialStartDate) {
        const trialEndDate = new Date(trialStartDate);
        trialEndDate.setDate(trialEndDate.getDate() + 30); // 30-day trial
        if (now < trialEndDate) {
            return 'trial';
        }
    }

    // If trial is over and no active subscription
    if (!stripeCustomerId || !subscriptionId) {
        return 'expired';
    }
    
    // Fallback to the stored status or default to expired if no other conditions met
    return (storedStatus as SubscriptionStatus) || 'expired';
}

// SERVER-SIDE function to delete a user (admin only)
export async function deleteUser(userId: string): Promise<void> {
    const adminDb = getAdminDb();
    await adminDb.collection('users').doc(userId).delete();
    await getAuth().deleteUser(userId);
}

// SERVER-SIDE function to get all users (admin only)
export async function getAllUsers(): Promise<User[]> {
    const adminDb = getAdminDb();
    
    // Fetch all users
    const usersSnapshot = await adminDb.collection('users').get();
    
    // Fetch all completed workout sessions in a single query
    const sessionsSnapshot = await adminDb.collection('workoutSessions')
      .where('finishedAt', '!=', null)
      .get();

    // Create a map of userId -> completed workout count
    const workoutCounts = new Map<string, number>();
    sessionsSnapshot.forEach(doc => {
        const session = doc.data();
        const userId = session.userId;
        workoutCounts.set(userId, (workoutCounts.get(userId) || 0) + 1);
    });

    return usersSnapshot.docs.map(doc => {
        const data = doc.data();
        const userId = doc.id;
        const stravaData = data.strava ? { 
            ...data.strava, 
            expiresAt: safeToDate(data.strava.expiresAt)! 
        } : undefined;

        const trialStartDate = safeToDate(data.trialStartDate);

        const user: User = {
            id: userId,
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            experience: data.experience,
            frequency: data.frequency,
            goal: data.goal,
            programId: data.programId,
            startDate: safeToDate(data.startDate),
            timeZone: data.timeZone,
            personalRecords: data.personalRecords || {},
            runningProfile: data.runningProfile || { benchmarkPaces: {} },
            strava: stravaData,
            lastStravaSync: safeToDate(data.lastStravaSync),
            isAdmin: data.isAdmin || false,
            subscriptionStatus: determineSubscriptionStatus(
                data.subscriptionStatus,
                data.stripeCustomerId,
                data.subscriptionId,
                trialStartDate,
                data.cancel_at_period_end,
                safeToDate(data.cancellation_effective_date)
            ),
            stripeCustomerId: data.stripeCustomerId,
            subscriptionId: data.subscriptionId,
            trialStartDate: trialStartDate,
            cancel_at_period_end: data.cancel_at_period_end,
            cancellation_effective_date: safeToDate(data.cancellation_effective_date),
            customProgram: data.customProgram || null,
            completedWorkouts: workoutCounts.get(userId) || 0,
        };
        return user;
    });
}
