// src/app/(app)/activity-feed/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { getAuthInstance } from '@/lib/firebase';
import type { StravaActivity } from '@/services/strava-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Activity, Clock, MapPin, RefreshCw, AlertTriangle, Heart, ArrowUp, BarChart } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getUserClient } from '@/services/user-service-client';
import type { User } from '@/models/types';
import { useToast } from '@/hooks/use-toast';
import { ActivityDetailsDialog } from '@/components/activity-details-dialog';

export default function ActivityFeedPage() {
    const [user, setUser] = useState<User | null>(null);
    const [activities, setActivities] = useState<StravaActivity[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const { toast } = useToast();

    const isStravaConnected = user?.strava?.accessToken && user?.strava?.athleteId;

    // Effect to get the user
    useEffect(() => {
        const initialize = async () => {
            const auth = await getAuthInstance();
            const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
                if (firebaseUser) {
                    const currentUser = await getUserClient(firebaseUser.uid);
                    setUser(currentUser);
                } else {
                    setUser(null);
                    setLoading(false);
                }
            });
            return unsubscribe;
        };

        let unsubscribe: (() => void) | undefined;
        initialize().then(unsub => unsubscribe = unsub);

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);
    
    const fetchActivities = async (showSyncingIndicator = true, pageToFetch = 1) => {
        if (!isStravaConnected) {
            setError('Strava account not connected. Please connect it in your profile.');
            setLoading(false);
            return;
        }

        if (showSyncingIndicator) setSyncing(true);
        setError(null);

        try {
            const auth = await getAuthInstance();
            const currentUser = auth.currentUser;
            if (!currentUser) throw new Error('User not authenticated');

            const idToken = await currentUser.getIdToken(true);
            const sessionRes = await fetch('/api/auth/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken }),
                credentials: 'include'
            });
            if (!sessionRes.ok) throw new Error('Failed to establish session. Please sign out and back in.');

            const response = await fetch(`/api/strava/activities?page=${pageToFetch}`, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-cache'
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Failed to fetch activities: ${response.statusText}`);
            }

            const { activities: fetched, hasMore: more } = await response.json();
            setActivities(prev => pageToFetch === 1 ? fetched : [...prev, ...fetched]);
            setHasMore(more);
            setPage(pageToFetch);

        } catch (err) {
            const errorObj = err as any; // FIXED: Safely cast for TS compiler
            setError(errorObj.message || 'Failed to fetch activities.');
            toast({ title: 'Error', description: errorObj.message || 'Failed to load Strava activities', variant: 'destructive' });
        } finally {
            if (showSyncingIndicator) setSyncing(false);
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const handleLoadMore = async () => {
        setLoadingMore(true);
        await fetchActivities(false, page + 1);
    };

    // Effect to fetch activities once user is loaded
    useEffect(() => {
        if (user) { 
            if (user.strava?.accessToken) {
                fetchActivities(false); 
            } else {
                setLoading(false);
            }
        }
    }, [user]);

    const handleActivityClick = (activityId: number) => {
        setSelectedActivityId(activityId);
        setIsDetailsOpen(true);
    };

    // Helper to format duration from seconds to HH:MM:SS
    const formatDuration = (seconds: number) => {
        if (!seconds) return '0m 0s';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        let result = '';
        if (h > 0) result += `${h}h `;
        if (m > 0 || h > 0) result += `${m}m `;
        result += `${s}s`;
        return result.trim();
    };

    // Helper to format distance from meters to km or m
    const formatDistance = (meters: number) => {
        if (!meters) return '0 km';
        const km = meters / 1000;
        return km >= 1 ? `${km.toFixed(1)} km` : `${meters.toFixed(0)} m`;
    };

    const formatDate = (dateString: string) => {
        try {
            return new Date(dateString).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch {
            return 'Invalid date';
        }
    };

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <Skeleton className="h-8 w-48" />
                        <Skeleton className="h-4 w-64 mt-2" />
                    </div>
                    <Skeleton className="h-10 w-10 md:w-28" />
                </div>
                <Card>
                    <CardContent className="p-6 space-y-4">
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                    </CardContent>
                </Card>
            </div>
        );
    }
    
    return (
        <>
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Activity Feed</h1>
                    <p className="text-muted-foreground">Your recent activities from Strava.</p>
                </div>
                {isStravaConnected && (
                     <Button onClick={() => fetchActivities(true)} disabled={syncing} size="icon" className="md:size-auto md:px-4 md:py-2">
                        {syncing ? <Loader2 className="h-4 w-4 animate-spin md:mr-2" /> : <RefreshCw className="h-4 w-4 md:mr-2" />}
                        <span className="hidden md:inline">Sync Now</span>
                    </Button>
                )}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Recent Activities</CardTitle>
                    <CardDescription>Click on any activity to view more details.</CardDescription>
                </CardHeader>
                <CardContent>
                    {!isStravaConnected ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No Strava connection found.</p>
                             <p className="text-sm">Please connect your account in your profile.</p>
                        </div>
                    ) : syncing && activities.length === 0 ? (
                        <div className="space-y-4 p-4">
                            {[...Array(3)].map((_, i) => (
                            <div key={i} className="flex items-center space-x-4">
                                <Skeleton className="h-10 w-10 rounded-full" />
                                <div className="space-y-2 flex-1">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-3 w-1/2" />
                                </div>
                            </div>
                            ))}
                        </div>
                    ) : error ? (
                        <div className="text-center py-8">
                            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
                            <div className="text-destructive mb-2 font-medium">Error Loading Activities</div>
                            <div className="text-sm text-muted-foreground mb-4">{error}</div>
                            <Button variant="outline" onClick={() => fetchActivities(true)}>
                            Try Again
                            </Button>
                        </div>
                    ) : !syncing && activities.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No recent activities found.</p>
                        </div>
                    ) : (
                        <>
                        <ul className="space-y-2">
                            {Array.isArray(activities) && activities.map((activity) => (
                                <li key={activity.id}>
                                    <button
                                        onClick={() => handleActivityClick(activity.id)}
                                        className="w-full text-left flex items-start space-x-4 p-3 rounded-lg hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
                                    >
                                        <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center mt-1">
                                            <BarChart className="h-5 w-5 text-primary" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="min-w-0">
                                                <h4 className="font-medium text-base break-words">{activity.name}</h4>
                                                <p className="text-xs text-muted-foreground break-words">
                                                    {activity.sport_type} • {formatDate(activity.start_date_local)}
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                                                <span className="flex items-center gap-1.5">
                                                    <MapPin className="h-3.5 w-3.5" />
                                                    {formatDistance(activity.distance)}
                                                </span>
                                                <span className="flex items-center gap-1.5">
                                                    <Clock className="h-3.5 w-3.5" />
                                                    {formatDuration(activity.moving_time)}
                                                </span>
                                                <span className="flex items-center gap-1.5">
                                                    <ArrowUp className="h-3.5 w-3.5" />
                                                    {Math.round(activity.total_elevation_gain)}m
                                                </span>
                                                {activity.average_heartrate && (
                                                    <span className="flex items-center gap-1.5">
                                                        <Heart className="h-3.5 w-3.5" />
                                                        {Math.round(activity.average_heartrate)} bpm
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        {hasMore && (
                            <div className="pt-4 text-center">
                                <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
                                    {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {loadingMore ? 'Loading...' : 'Load More'}
                                </Button>
                            </div>
                        )}
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
        {selectedActivityId && (
            <ActivityDetailsDialog
                activityId={selectedActivityId}
                isOpen={isDetailsOpen}
                setIsOpen={setIsDetailsOpen}
            />
        )}
        </>
    );
}
