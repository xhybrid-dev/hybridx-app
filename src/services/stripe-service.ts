// src/services/stripe-service.ts
'use server';

import { logger } from '@/lib/logger';
import Stripe from 'stripe';
import { getUser, updateUserAdmin } from './user-service';
import { getAdminDb } from '@/lib/firebase-admin';
import { assertUser } from '@/lib/api-auth';
import { getAuth } from 'firebase-admin/auth';
import type { User } from '@/models/types';

// These are Server Actions — public HTTP endpoints whose ids ship in the client
// bundle (this module is imported by src/app/(app)/subscription/page.tsx). They
// mutate billing, so they take no userId: the subscription acted on is always
// the caller's own, resolved from the session cookie. Accepting a userId let
// anyone pause or cancel any paying customer's plan.


// Ensure environment variables are loaded
if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set in environment variables.');
}
if (!process.env.NEXT_PUBLIC_APP_URL) {
    throw new Error('NEXT_PUBLIC_APP_URL is not set in environment variables.');
}
if (!process.env.STRIPE_PRICE_ID) {
    throw new Error('STRIPE_PRICE_ID is not set in environment variables.');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
});

export type SubscriptionPlan = 'monthly' | 'annual';

/**
 * Resolves the Stripe price ID for a given plan.
 * Annual requires STRIPE_ANNUAL_PRICE_ID to be configured; if it is missing we
 * fail loudly rather than silently charging the monthly price.
 */
function resolvePriceId(plan: SubscriptionPlan): string {
    if (plan === 'annual') {
        const annual = process.env.STRIPE_ANNUAL_PRICE_ID;
        if (!annual) {
            throw new Error('Annual plan is not available right now. Please choose monthly.');
        }
        return annual;
    }
    return process.env.STRIPE_PRICE_ID as string;
}

/**
 * Creates a Stripe Checkout session for the signed-in athlete to subscribe.
 * @param plan - Which billing cadence to check out with (defaults to monthly).
 * @returns An object containing the URL to the checkout session.
 */
export async function createCheckoutSession(
    plan: SubscriptionPlan = 'monthly',
): Promise<{ url: string | null }> {
    const { uid: userId } = await assertUser('stripe:checkout', { max: 10 });
    try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const stripeKey = process.env.STRIPE_SECRET_KEY;

        if (!stripeKey) {
            throw new Error('Configuration error: STRIPE_SECRET_KEY is not set');
        }

        if (stripeKey.startsWith('sk_live_') && (appUrl.includes('localhost') || appUrl.includes('127.0.0.1'))) {
           throw new Error('Configuration error: You are using a live Stripe key with a localhost URL. NEXT_PUBLIC_APP_URL must be set to your public production URL in a live environment.');
        }
        
        let user = await getUser(userId);
        
        if (!user) {
             const authUser = await getAuth().getUser(userId);
             if (!authUser || !authUser.email) {
                 throw new Error(`User with ID ${userId} could not be found in Firebase Auth.`);
             }
             const trialStartDate = new Date();
             const newUser: Omit<User, 'id'> = {
                email: authUser.email,
                firstName: '',
                lastName: '',
                experience: 'beginner',
                frequency: '3',
                goal: 'hybrid',
                subscriptionStatus: 'trial',
                trialStartDate,
             };
             await getAdminDb().collection('users').doc(userId).set(newUser);
             user = { id: userId, ...newUser };
             logger.log(`Created missing Firestore document for user ${userId} during checkout.`);
        }

        let customerId = user.stripeCustomerId;

        // Create a new Stripe customer if one doesn't exist
        if (!customerId) {
            try {
                const customer = await stripe.customers.create({
                    email: user.email,
                    name: `${user.firstName} ${user.lastName}`,
                    metadata: {
                        firebaseUID: userId,
                    },
                });
                customerId = customer.id;
                await updateUserAdmin(userId, { stripeCustomerId: customerId });
            } catch (err) {
                logger.error('Error creating Stripe customer:', err);
                throw new Error(`Failed to create Stripe customer: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        
        const priceId = resolvePriceId(plan);

        try {
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'subscription',
                customer: customerId,
                line_items: [
                    {
                        price: priceId,
                        quantity: 1,
                    },
                ],
                success_url: `${appUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${appUrl}/subscription`,
            });

            return { url: session.url };
        } catch (err) {
            logger.error('Error creating Stripe checkout session:', err);
            throw new Error(`Failed to create Stripe checkout session: ${err instanceof Error ? err.message : String(err)}`);
        }

    } catch (error) {
        logger.error('An error occurred in createCheckoutSession:', error);
        
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('Could not refresh access token')) {
            throw new Error('Could not authenticate with Firebase. Please check server permissions.');
        }

        throw new Error(msg);
    }
}

/** Pauses the signed-in athlete's own subscription. */
export async function pauseSubscription(): Promise<void> {
    const { uid: userId } = await assertUser('stripe:pause', { max: 10 });
    const user = await getUser(userId);
    if (!user || !user.subscriptionId) {
        throw new Error('User or subscription not found.');
    }
    try {
        await stripe.subscriptions.update(user.subscriptionId, {
            pause_collection: {
                behavior: 'void',
            },
        });
        await updateUserAdmin(userId, { subscriptionStatus: 'paused' });
    } catch (error) {
        logger.error(`Failed to pause subscription for user ${userId}:`, error);
        throw new Error('Could not pause subscription. Please try again.');
    }
}

const CANCEL_REASONS = ['too-expensive', 'not-training', 'race-done', 'missing-features', 'other-app', 'other'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/**
 * Cancels the signed-in athlete's own subscription at period end.
 *
 * The status stays 'active' until Stripe ends the subscription (its webhook
 * then marks it expired). Writing 'canceled' here used to lock the athlete
 * out immediately — the app's gate treats 'canceled' as no access — despite
 * promising access until the end of the period they had paid for.
 */
export async function cancelSubscription(reason?: CancelReason): Promise<void> {
    const { uid: userId } = await assertUser('stripe:cancel', { max: 10 });
    const user = await getUser(userId);
    if (!user || !user.subscriptionId) {
        throw new Error('User or subscription not found.');
    }
    try {
        const subscription = await stripe.subscriptions.update(user.subscriptionId, {
            cancel_at_period_end: true,
            ...(reason && CANCEL_REASONS.includes(reason) ? { metadata: { cancel_reason: reason } } : {}),
        });

        const cancelAt = subscription.cancel_at;
        await updateUserAdmin(userId, {
            cancel_at_period_end: true,
            cancellation_effective_date: cancelAt ? new Date(cancelAt * 1000) : undefined,
            ...(reason && CANCEL_REASONS.includes(reason) ? { cancellationReason: reason } : {}),
        });
    } catch (error) {
        logger.error(`Failed to cancel subscription for user ${userId}:`, error);
        throw new Error('Could not cancel subscription. Please try again.');
    }
}

/**
 * Undoes a pause or a pending cancellation on the signed-in athlete's own
 * subscription. Paused members previously had no way back except buying a
 * second subscription.
 */
export async function resumeSubscription(): Promise<void> {
    const { uid: userId } = await assertUser('stripe:resume', { max: 10 });
    const user = await getUser(userId);
    if (!user || !user.subscriptionId) {
        throw new Error('User or subscription not found.');
    }
    try {
        await stripe.subscriptions.update(user.subscriptionId, {
            pause_collection: '',
            cancel_at_period_end: false,
        });
        await updateUserAdmin(userId, {
            subscriptionStatus: 'active',
            cancel_at_period_end: false,
            cancellation_effective_date: null,
        });
    } catch (error) {
        logger.error(`Failed to resume subscription for user ${userId}:`, error);
        throw new Error('Could not resume your subscription. Please try again.');
    }
}
