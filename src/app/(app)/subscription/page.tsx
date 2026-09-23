// src/app/(app)/subscription/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { format } from 'date-fns';
import { getTrialEndDate, getTrialDaysLeft } from '@/lib/trial';
import { Loader2, CheckCircle, ShieldCheck, Star, PauseCircle, XCircle, History } from 'lucide-react';

import { getAuthInstance } from '@/lib/firebase';
import { getUserClient } from '@/services/user-service-client';
import { createCheckoutSession, pauseSubscription, cancelSubscription, resumeSubscription, type CancelReason, type SubscriptionPlan } from '@/services/stripe-service';
import Link from 'next/link';
import type { User } from '@/models/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// Annual billing only appears once STRIPE_ANNUAL_PRICE_ID is configured and this
// public flag is set — keeps a half-configured annual button from erroring.
const ANNUAL_ENABLED = process.env.NEXT_PUBLIC_ANNUAL_PLAN_ENABLED === 'true';

const CANCEL_OPTIONS: { value: CancelReason; label: string }[] = [
    { value: 'too-expensive', label: 'It costs too much' },
    { value: 'not-training', label: "I'm not training right now" },
    { value: 'race-done', label: 'My race is done' },
    { value: 'missing-features', label: "It's missing something I need" },
    { value: 'other-app', label: "I'm using another app" },
    { value: 'other', label: 'Something else' },
];

const MEMBER_BENEFITS = [
    'AI-tailored training plans matched to your goal',
    'Weekly AI coaching that adapts your plan',
    'Race-day planner & countdown programs',
    'Garmin & Strava sync',
    'Progress tracking, streaks & analytics',
];

/**
 * Shared upgrade panel: restates the value of membership, then offers the plan
 * options. `lostAccess` switches the copy to loss-aversion framing, which
 * converts better for expired/cancelled users.
 */
function UpgradePanel({
    onSubscribe,
    isRedirecting,
    lostAccess = false,
}: {
    onSubscribe: (plan: SubscriptionPlan) => void;
    isRedirecting: boolean;
    lostAccess?: boolean;
}) {
    return (
        <div className="w-full space-y-4">
            <ul className="space-y-2">
                {MEMBER_BENEFITS.map((benefit) => (
                    <li key={benefit} className="flex items-start gap-2 text-sm">
                        {lostAccess
                            ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            : <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />}
                        <span className={lostAccess ? 'text-foreground' : 'text-muted-foreground'}>
                            {lostAccess ? `Lose access to: ${benefit}` : benefit}
                        </span>
                    </li>
                ))}
            </ul>

            <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                    onClick={() => onSubscribe('monthly')}
                    disabled={isRedirecting}
                    variant={ANNUAL_ENABLED ? 'outline' : 'default'}
                    className="flex-1"
                >
                    {isRedirecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Monthly — £5/month
                </Button>

                {ANNUAL_ENABLED && (
                    <Button
                        onClick={() => onSubscribe('annual')}
                        disabled={isRedirecting}
                        className="relative flex-1"
                    >
                        {isRedirecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Annual — £50/year
                        <span className="absolute -top-2 -right-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground shadow">
                            2 months free
                        </span>
                    </Button>
                )}
            </div>

            <p className="text-xs text-muted-foreground">
                Cancel anytime · Secure payment by Stripe
            </p>
        </div>
    );
}

export default function SubscriptionPage() {
    const [user, setUser] = useState<User | null>(null);
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [isManaging, setIsManaging] = useState(false);
    const [cancelReason, setCancelReason] = useState<CancelReason | null>(null);
    const { toast } = useToast();

    const fetchUserData = async (fbUser: FirebaseUser) => {
        const appUser = await getUserClient(fbUser.uid);
        setUser(appUser);
    }

    useEffect(() => {
        const initialize = async () => {
            const auth = await getAuthInstance();
            const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
                if (fbUser) {
                    setFirebaseUser(fbUser);
                    await fetchUserData(fbUser);
                }
                setLoading(false);
            });
            return unsubscribe;
        };
        
        let unsubscribe: () => void;
        initialize().then(unsub => unsubscribe = unsub);

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    const handleSubscribe = async (plan: SubscriptionPlan = 'monthly') => {
        if (!firebaseUser) {
            toast({ title: 'Error', description: 'You must be logged in.', variant: 'destructive' });
            return;
        }
        setIsRedirecting(true);
        try {
            const { url } = await createCheckoutSession(plan);
            if (url) {
                window.location.href = url;
            } else {
                throw new Error('Could not create checkout session.');
            }
        } catch (error) {
            console.error('Subscription error:', error);
            toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not redirect to payment page.', variant: 'destructive' });
            setIsRedirecting(false);
        }
    };
    
    const handlePause = async () => {
        if (!user?.subscriptionId) return;
        setIsManaging(true);
        try {
            await pauseSubscription();
            toast({ title: 'Success', description: 'Your subscription has been paused.'});
            if (firebaseUser) await fetchUserData(firebaseUser);
        } catch (error) {
            toast({ title: 'Error', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        } finally {
            setIsManaging(false);
        }
    }

    const handleResume = async () => {
        if (!user?.subscriptionId) return;
        setIsManaging(true);
        try {
            await resumeSubscription();
            toast({ title: 'Welcome back', description: 'Your membership continues as normal.' });
            if (firebaseUser) await fetchUserData(firebaseUser);
        } catch (error) {
            toast({ title: 'Error', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        } finally {
            setIsManaging(false);
        }
    }

    const handleCancel = async () => {
        if (!user?.subscriptionId) return;
        setIsManaging(true);
        try {
            await cancelSubscription(cancelReason ?? undefined);
            toast({ title: 'Success', description: 'Your subscription will be cancelled at the end of the current billing period.'});
            if (firebaseUser) await fetchUserData(firebaseUser);
        } catch (error) {
            toast({ title: 'Error', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        } finally {
            setIsManaging(false);
        }
    }
    
    if (loading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-4 w-2/3" />
                <Card><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
            </div>
        );
    }
    
    if (user?.isAdmin) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Subscription Status</h1>
                    <p className="text-muted-foreground">Manage your subscription and billing details.</p>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-6 w-6 text-primary" />
                            Administrator Account
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">As an administrator, you have full access to all features and are exempt from billing.</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const rawStatus = user?.subscriptionStatus || 'trial';
    const cancelDate = user?.cancellation_effective_date ?? null;
    // 'canceled' with time left was written by an older cancel flow; it's
    // really an active membership that ends later.
    const status = rawStatus === 'canceled' && cancelDate && cancelDate > new Date() ? 'active' : rawStatus;
    const pendingCancel = status === 'active' && !!user?.cancel_at_period_end;
    const trialStart = user?.trialStartDate;
    const trialEndDate = getTrialEndDate(trialStart) ?? new Date();
    const daysLeft = getTrialDaysLeft(trialStart);
    const trialEndDateFormatted = trialStart ? format(trialEndDate, 'MMMM do, yyyy') : '';

    return (
        <div className="space-y-6">
             <div>
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Subscription Status</h1>
                <p className="text-muted-foreground">Manage your subscription and billing details.</p>
            </div>
            
            {status === 'active' && pendingCancel && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <XCircle className="h-6 w-6 text-muted-foreground" />
                            Membership ends {cancelDate ? `on ${format(cancelDate, 'MMMM do')}` : 'at the end of this period'}
                        </CardTitle>
                        <CardDescription>
                            You keep full access until then. Changed your mind? Keep your plan, history and coach with one tap.
                        </CardDescription>
                    </CardHeader>
                    <CardFooter>
                        <Button onClick={handleResume} disabled={isManaging}>
                            {isManaging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Keep my membership
                        </Button>
                    </CardFooter>
                </Card>
            )}

            {status === 'active' && !pendingCancel && (
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <CheckCircle className="h-6 w-6 text-green-500" />
                            Subscription Active
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Thank you for being a member! You have full access to all features.</p>
                    </CardContent>
                    <CardFooter className="flex-col sm:flex-row gap-2 items-start">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" disabled={isManaging}>
                                    {isManaging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Pause Subscription
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Pause your subscription?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Payments stop until you resume — handy for an off-season or an injury. Your plan, history and coach stay put.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Not now</AlertDialogCancel>
                                    <AlertDialogAction onClick={handlePause}>Pause payments</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                         <AlertDialog onOpenChange={(open) => { if (!open) setCancelReason(null); }}>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" className="text-muted-foreground" disabled={isManaging}>
                                    Cancel Subscription
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Before you go — what&apos;s the main reason?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        You&apos;ll keep full access until the end of this billing period.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <div className="grid gap-2" role="radiogroup" aria-label="Reason for cancelling">
                                    {CANCEL_OPTIONS.map(option => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={cancelReason === option.value}
                                            onClick={() => setCancelReason(option.value)}
                                            className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${cancelReason === option.value ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted'}`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                {cancelReason && ['not-training', 'race-done', 'too-expensive'].includes(cancelReason) && (
                                    <p className="rounded-md bg-muted/60 p-3 text-sm">
                                        You could <strong>pause</strong> instead: no payments until you&apos;re back, and your plan and history stay exactly where they are.
                                    </p>
                                )}
                                <AlertDialogFooter className="gap-2">
                                    <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
                                    {cancelReason && ['not-training', 'race-done', 'too-expensive'].includes(cancelReason) && (
                                        <AlertDialogAction onClick={handlePause}>Pause instead</AlertDialogAction>
                                    )}
                                    <AlertDialogAction
                                        onClick={handleCancel}
                                        disabled={!cancelReason}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                        Cancel at period end
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </CardFooter>
                </Card>
            )}

            {status === 'paused' && (
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <PauseCircle className="h-6 w-6 text-yellow-500" />
                            Payments paused
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">You won&apos;t be charged while paused. Resume whenever you&apos;re ready to train again — everything is where you left it.</p>
                    </CardContent>
                     <CardFooter>
                        <Button onClick={handleResume} disabled={isManaging}>
                            {isManaging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Resume my membership
                        </Button>
                    </CardFooter>
                </Card>
            )}

            {status === 'trial' && (
                <Card className="border-primary/50 bg-primary/5">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                           <Star className="h-6 w-6 text-yellow-400" />
                            You are on a free trial!
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {daysLeft > 0 ? (
                            <p className="text-muted-foreground">
                                You have <span className="font-bold text-foreground">{daysLeft} day{daysLeft !== 1 ? 's' : ''}</span> left in your free trial.
                                Your trial will end on <span className="font-bold text-foreground">{trialEndDateFormatted}</span>.
                            </p>
                        ) : (
                            <p className="text-destructive">Your free trial has ended. Please subscribe to continue.</p>
                        )}
                    </CardContent>
                    <CardFooter>
                        <UpgradePanel onSubscribe={handleSubscribe} isRedirecting={isRedirecting} />
                    </CardFooter>
                </Card>
            )}

            {['expired', 'canceled', 'incomplete'].includes(status) && (
                <Card className="border-destructive/50 bg-destructive/5">
                     <CardHeader>
                        <CardTitle className="text-destructive flex items-center gap-2">
                            <XCircle className="h-6 w-6" />
                           {status === 'expired' && 'Subscription Expired'}
                           {status === 'canceled' && 'Subscription Cancelled'}
                           {status === 'incomplete' && 'Action Required'}
                        </CardTitle>
                        <CardDescription>
                            {user?.cancel_at_period_end 
                                ? `Your subscription is set to cancel at the end of the current period. Your access will continue until then.`
                                : `Your access is currently limited. Please subscribe to regain full access.`
                            }
                        </CardDescription>
                    </CardHeader>
                    <CardFooter className="flex-col items-stretch gap-4">
                        <UpgradePanel onSubscribe={handleSubscribe} isRedirecting={isRedirecting} lostAccess />
                        <Button asChild variant="ghost" size="sm" className="self-start">
                            <Link href="/history"><History className="mr-2 h-4 w-4" />Your workout history is still here</Link>
                        </Button>
                    </CardFooter>
                </Card>
            )}
        </div>
    )
}
