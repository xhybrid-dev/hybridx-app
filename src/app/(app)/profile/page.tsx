// src/app/(app)/profile/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Loader2, Link as LinkIcon, Bell, Settings, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { GarminIntegrationCard } from '@/components/garmin-integration-card';
import { MarketingPreferencesCard } from '@/components/marketing-preferences-card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { subscribeUserToPush } from '@/lib/push-subscribe';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { enableNativePush } from '@/lib/native-push';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getAuthInstance } from '@/lib/firebase';
import { trackEvent } from '@/lib/analytics';
import { getUserClient, updateUser } from '@/services/user-service-client';
import type { User, PersonalRecords, UserRunningProfile } from '@/models/types';
import { timeStringToSeconds, secondsToTimeString } from '@/lib/pace-utils';
import { Label } from '@/components/ui/label';

const profileFormSchema = z.object({
  firstName: z.string().min(1, 'First name is required.'),
  lastName: z.string().min(1, 'Last name is required.'),
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  unitSystem: z.enum(['metric', 'imperial']).optional(),
});

const recordsFormSchema = z.object({
    backSquat: z.string().optional(),
    deadlift: z.string().optional(),
    benchPress: z.string().optional(),
    run1k: z.string().optional(),
    run5k: z.string().optional(),
    run10k: z.string().optional(),
});

const runningProfileSchema = z.object({
    mile: z.string().optional(),
    fiveK: z.string().optional(),
    tenK: z.string().optional(),
    halfMarathon: z.string().optional(),
});

const notificationSchema = z.object({
    hour: z.string(),
    minute: z.string(),
});

type ProfileFormData = z.infer<typeof profileFormSchema>;
type RecordsFormData = z.infer<typeof recordsFormSchema>;
type RunningProfileFormData = z.infer<typeof runningProfileSchema>;
type NotificationFormData = z.infer<typeof notificationSchema>;

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [enablingNotifs, setEnablingNotifs] = useState(false);

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileFormSchema),
  });

  const recordsForm = useForm<RecordsFormData>({
    resolver: zodResolver(recordsFormSchema),
  });

  const runningForm = useForm<RunningProfileFormData>({
    resolver: zodResolver(runningProfileSchema),
  });

  const notificationForm = useForm<NotificationFormData>({
    resolver: zodResolver(notificationSchema),
    defaultValues: {
      hour: '8',
      minute: '00',
    },
  });

  const fetchUserData = async () => {
    try {
        const auth = await getAuthInstance();
        const firebaseUser = auth.currentUser;
        if (firebaseUser) {
            const currentUser = await getUserClient(firebaseUser.uid);
            setUser(currentUser);
            if (currentUser) {
                profileForm.reset({
                    firstName: currentUser.firstName,
                    lastName: currentUser.lastName,
                    experience: currentUser.experience,
                    unitSystem: currentUser.unitSystem || 'metric',
                });
                recordsForm.reset({
                    backSquat: currentUser.personalRecords?.backSquat || '',
                    deadlift: currentUser.personalRecords?.deadlift || '',
                    benchPress: currentUser.personalRecords?.benchPress || '',
                    run1k: currentUser.personalRecords?.run1k || '',
                    run5k: currentUser.personalRecords?.run5k || '',
                    run10k: currentUser.personalRecords?.run10k || '',
                });
                runningForm.reset({
                    mile: currentUser.runningProfile?.benchmarkPaces?.mile ? secondsToTimeString(currentUser.runningProfile.benchmarkPaces.mile) : '',
                    fiveK: currentUser.runningProfile?.benchmarkPaces?.fiveK ? secondsToTimeString(currentUser.runningProfile.benchmarkPaces.fiveK) : '',
                    tenK: currentUser.runningProfile?.benchmarkPaces?.tenK ? secondsToTimeString(currentUser.runningProfile.benchmarkPaces.tenK) : '',
                    halfMarathon: currentUser.runningProfile?.benchmarkPaces?.halfMarathon ? secondsToTimeString(currentUser.runningProfile.benchmarkPaces.halfMarathon) : '',
                });
                notificationForm.reset({
                    hour: currentUser.notificationTime?.hour?.toString() ?? '8',
                    minute: (currentUser.notificationTime?.minute ?? 0).toString().padStart(2, '0'),
                });
            }
        }
    } catch (error) {
        console.error("Failed to fetch user data", error);
        toast({ title: "Error", description: "Could not load your profile data.", variant: "destructive" });
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
        const auth = await getAuthInstance();
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
                fetchUserData();
            } else {
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

  const isNative = Capacitor.isNativePlatform();

  // Read notification permission on mount — native and web paths differ
  useEffect(() => {
    const check = async () => {
      if (isNative) {
        try {
          const status = await LocalNotifications.checkPermissions();
          setNotifPermission(nativeToWebPermission(status.display));
        } catch {
          setNotifPermission('unsupported');
        }
      } else {
        if (typeof window === 'undefined' || !('Notification' in window)) {
          setNotifPermission('unsupported');
          return;
        }
        setNotifPermission(Notification.permission);
      }
    };
    check();
  }, [isNative]);

  const handleEnableNotifications = async () => {
    setEnablingNotifs(true);
    try {
      if (isNative) {
        // Server push through FCM, plus local permission for the on-device fallback.
        await enableNativePush();
        const status = await LocalNotifications.requestPermissions();
        const mapped = nativeToWebPermission(status.display);
        setNotifPermission(mapped);
        if (mapped === 'granted') {
          toast({ title: 'Notifications enabled', description: "You'll receive your daily workout reminder." });
        } else {
          toast({ title: 'Notifications not enabled', description: 'Permission was not granted.', variant: 'destructive' });
        }
      } else {
        const success = await subscribeUserToPush();
        setNotifPermission(Notification.permission);
        if (success) {
          toast({ title: 'Notifications enabled', description: "You'll receive your daily workout reminder." });
        } else {
          toast({ title: 'Could not enable notifications', description: 'Please check your browser settings.', variant: 'destructive' });
        }
      }
    } finally {
      setEnablingNotifs(false);
    }
  };

  // Handle URL parameters for Strava auth feedback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const stravaSuccess = urlParams.get('strava');
    const stravaError = urlParams.get('strava-error');

    if (stravaSuccess === 'success') {
        void getAuthInstance().then(auth => trackEvent(auth.currentUser?.uid ?? null, 'strava_connected'));
        toast({ 
            title: 'Success!', 
            description: 'Your Strava account has been connected successfully.' 
        });
        
        // IMPORTANT: Refresh user data immediately after successful connection
        fetchUserData();
        
        // Clean up URL
        window.history.replaceState({}, '', '/profile');
        
    } else if (stravaError) {
        const errorMessage = decodeURIComponent(stravaError);
        toast({
            title: 'Strava Connection Failed',
            description: errorMessage,
            variant: 'destructive'
        });
        // Clean up URL
        window.history.replaceState({}, '', '/profile');
    }

    const garminSuccess = urlParams.get('garmin');
    const garminError = urlParams.get('garmin-error');
    if (garminSuccess === 'success') {
        void getAuthInstance().then(auth => trackEvent(auth.currentUser?.uid ?? null, 'garmin_connected'));
        toast({ title: 'Garmin Connected!', description: 'Account linked. Click "Sync next 14 days" to push your training plan to your watch.' });
        fetchUserData();
        window.history.replaceState({}, '', '/profile');
    } else if (garminError) {
        toast({
            title: 'Garmin Connection Failed',
            description: decodeURIComponent(garminError),
            variant: 'destructive',
        });
        window.history.replaceState({}, '', '/profile');
    }
  }, [toast]);

  const handleProfileSubmit = async (data: ProfileFormData) => {
    if (!user) return;
    try {
      await updateUser(user.id, {
          firstName: data.firstName,
          lastName: data.lastName,
          experience: data.experience,
          unitSystem: data.unitSystem
      });
      toast({ title: 'Success', description: 'Your profile has been updated.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to update profile.', variant: 'destructive' });
    }
  };

  const handleRecordsSubmit = async (data: RecordsFormData) => {
    if (!user) return;
    try {
      // Filter out empty strings
      const recordsToUpdate = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== ''));
      await updateUser(user.id, { personalRecords: recordsToUpdate });
      toast({ title: 'Success', description: 'Your personal records have been updated.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to update records.', variant: 'destructive' });
    }
  };

  const handleRunningSubmit = async (data: RunningProfileFormData) => {
    if (!user) return;
    try {
        const benchmarkPaces: { [key: string]: number } = {};
        
        const paceData = {
            mile: data.mile ? timeStringToSeconds(data.mile, 'mile') : undefined,
            fiveK: data.fiveK ? timeStringToSeconds(data.fiveK, '5k') : undefined,
            tenK: data.tenK ? timeStringToSeconds(data.tenK, '10k') : undefined,
            halfMarathon: data.halfMarathon ? timeStringToSeconds(data.halfMarathon, 'half-marathon') : undefined,
        };

        // Only add paces to the object if they are valid numbers greater than 0
        for (const [key, value] of Object.entries(paceData)) {
            if (value && value > 0) {
                benchmarkPaces[key] = value;
            }
        }

        const profileToUpdate: UserRunningProfile = {
            benchmarkPaces,
        };
        
        await updateUser(user.id, { runningProfile: profileToUpdate });
        toast({ title: 'Success', description: 'Your running profile has been updated.' });
    } catch (error) {
        console.error("Detailed error updating running profile:", error);
        toast({ description: `Failed to update running profile: ${error instanceof Error ? error.message : String(error)}`})
    }
  };

  const handleNotificationSubmit = async (data: NotificationFormData) => {
    if (!user) return;
    try {
        const notificationTime = {
            hour: parseInt(data.hour, 10),
            minute: parseInt(data.minute, 10),
        };
        await updateUser(user.id, { notificationTime });
        toast({ title: 'Success', description: 'Your notification time has been updated.' });
    } catch (error) {
        console.error("Error updating notification time:", error);
        toast({ title: 'Error', description: `Failed to update notification time: ${error instanceof Error ? error.message : String(error)}`})
    }
  };

  const initiateStravaAuth = async () => {
    try {
      // First, ensure we have a fresh session cookie. This also verifies the user is logged in.
      const auth = await getAuthInstance();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        toast({ title: 'Authentication Required', description: 'Please log in to connect your Strava account.', variant: 'destructive' });
        return;
      }
      const idToken = await currentUser.getIdToken(true);
      
      const sessionResponse = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ idToken }),
        credentials: 'include',
      });
      
      if (!sessionResponse.ok) {
        throw new Error("Failed to establish a server session.");
      }

      // Now, call our new secure API route to get the Strava URL
      const response = await fetch('/api/strava/connect', {
        method: 'POST',
        credentials: 'include',
      });
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to initiate Strava connection.');
      }

      toast({
        title: 'Redirecting to Strava...',
        description: 'Please wait while we connect to Strava.',
      });

      window.location.href = data.url;

    } catch (error) {
      console.error('Error initiating Strava auth:', error);
      toast({
        title: 'Connection Error',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };


  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <div className="grid gap-6 md:grid-cols-2">
          <Card><CardHeader><Skeleton className="h-6 w-1/2" /></CardHeader><CardContent><Skeleton className="h-48 w-full" /></CardContent></Card>
          <Card><CardHeader><Skeleton className="h-6 w-1/2" /></CardHeader><CardContent><Skeleton className="h-48 w-full" /></CardContent></Card>
        </div>
      </div>
    );
  }

  const isStravaConnected = !!(user?.strava?.accessToken && user?.strava?.athleteId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Your Profile</h1>
        <p className="text-muted-foreground">Manage your personal information and track your achievements.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <Form {...profileForm}>
            <form onSubmit={profileForm.handleSubmit(handleProfileSubmit)}>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
                <CardDescription>Update your name, experience level, and unit preferences.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={profileForm.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={profileForm.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={profileForm.control} name="experience" render={({ field }) => (
                  <FormItem><FormLabel>Experience Level</FormLabel><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="space-y-1">
                    <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="beginner" /></FormControl><FormLabel className="font-normal">Beginner</FormLabel></FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="intermediate" /></FormControl><FormLabel className="font-normal">Intermediate</FormLabel></FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="advanced" /></FormControl><FormLabel className="font-normal">Advanced</FormLabel></FormItem>
                  </RadioGroup></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={profileForm.control} name="unitSystem" render={({ field }) => (
                  <FormItem><FormLabel>Unit System</FormLabel><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value || 'metric'} className="space-y-1">
                    <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="metric" /></FormControl><FormLabel className="font-normal">Metric (kg / km)</FormLabel></FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="imperial" /></FormControl><FormLabel className="font-normal">Imperial (lbs / mi)</FormLabel></FormItem>
                  </RadioGroup></FormControl><FormMessage /></FormItem>
                )} />
              </CardContent>
              <CardFooter>
                <Button type="submit" disabled={profileForm.formState.isSubmitting}>
                  {profileForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
        
        <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>Connect your account to other services.</CardDescription>
              </CardHeader>
              <CardContent>
                  <Button onClick={initiateStravaAuth} variant="outline" disabled={isStravaConnected}>
                    <LinkIcon className="mr-2"/>
                    {isStravaConnected && user?.strava ? `Connected to Strava (Athlete: ${user.strava.athleteId})` : 'Connect with Strava'}
                  </Button>
              </CardContent>
            </Card>

            <GarminIntegrationCard
              isConnected={!!user?.garmin?.accessToken}
              onChange={fetchUserData}
            />

            <Card>
                <Form {...notificationForm}>
                    <form onSubmit={notificationForm.handleSubmit(handleNotificationSubmit)}>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 flex-wrap">
                                <Bell className="h-5 w-5" />
                                Daily Workout Notifications
                                <NotificationStatusBadge
                                    permission={notifPermission}
                                    onEnable={handleEnableNotifications}
                                    enabling={enablingNotifs}
                                    isNative={isNative}
                                />
                            </CardTitle>
                            <CardDescription>Choose when you'd like to receive your daily workout reminder.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-4 items-end">
                                <FormField control={notificationForm.control} name="hour" render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormLabel>Hour</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select hour" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {Array.from({ length: 24 }, (_, i) => (
                                                    <SelectItem key={i} value={i.toString()}>
                                                        {i.toString().padStart(2, '0')}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={notificationForm.control} name="minute" render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormLabel>Minute</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select minute" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {['00', '15', '30', '45'].map((minute) => (
                                                    <SelectItem key={minute} value={minute}>
                                                        {minute}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" disabled={notificationForm.formState.isSubmitting}>
                                {notificationForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Notification Time
                            </Button>
                        </CardFooter>
                    </form>
                </Form>
            </Card>

            <Card>
                <Form {...runningForm}>
                    <form onSubmit={runningForm.handleSubmit(handleRunningSubmit)}>
                        <CardHeader>
                            <CardTitle>Running Profile</CardTitle>
                            <CardDescription>Enter at least one recent race time to calculate your training paces.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField control={runningForm.control} name="mile" render={({ field }) => (
                                <FormItem><FormLabel>Best Mile Time</FormLabel><FormControl><Input placeholder="e.g., 06:30" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={runningForm.control} name="fiveK" render={({ field }) => (
                                <FormItem><FormLabel>Best 5k Time</FormLabel><FormControl><Input placeholder="e.g., 25:00" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={runningForm.control} name="tenK" render={({ field }) => (
                                <FormItem><FormLabel>Best 10k Time</FormLabel><FormControl><Input placeholder="e.g., 52:00" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={runningForm.control} name="halfMarathon" render={({ field }) => (
                                <FormItem><FormLabel>Best Half Marathon Time</FormLabel><FormControl><Input placeholder="e.g., 01:55:00" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" disabled={runningForm.formState.isSubmitting}>
                                {runningForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Running Profile
                            </Button>
                        </CardFooter>
                    </form>
                </Form>
            </Card>

            <Card>
                <Form {...recordsForm}>
                    <form onSubmit={recordsForm.handleSubmit(handleRecordsSubmit)}>
                        <CardHeader>
                            <CardTitle>HYROX Personal Records</CardTitle>
                            <CardDescription>Log your strength and hybrid benchmarks. Use units like "kg", "lbs", or time "hh:mm:ss".</CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField control={recordsForm.control} name="backSquat" render={({ field }) => (
                                <FormItem><FormLabel>Back Squat (1RM)</FormLabel><FormControl><Input placeholder="e.g., 100kg" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={recordsForm.control} name="deadlift" render={({ field }) => (
                                <FormItem><FormLabel>Deadlift (1RM)</FormLabel><FormControl><Input placeholder="e.g., 150kg" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={recordsForm.control} name="benchPress" render={({ field }) => (
                                <FormItem><FormLabel>Bench Press (1RM)</FormLabel><FormControl><Input placeholder="e.g., 80kg" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={recordsForm.control} name="run1k" render={({ field }) => (
                                <FormItem><FormLabel>1km Run</FormLabel><FormControl><Input placeholder="e.g., 03:30" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={recordsForm.control} name="run5k" render={({ field }) => (
                                <FormItem><FormLabel>5km Run</FormLabel><FormControl><Input placeholder="e.g., 20:00" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={recordsForm.control} name="run10k" render={({ field }) => (
                                <FormItem><FormLabel>10km Run</FormLabel><FormControl><Input placeholder="e.g., 45:00" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" disabled={recordsForm.formState.isSubmitting}>
                                {recordsForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Records
                            </Button>
                        </CardFooter>
                    </form>
                </Form>
            </Card>

            {/* Email preferences */}
            <div className="lg:col-span-2">
              <MarketingPreferencesCard />
            </div>

            {/* Theme Settings */}
            <div className="lg:col-span-2">
              <ThemeSwitcher />
            </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function nativeToWebPermission(display: string): NotificationPermission {
  if (display === 'granted') return 'granted';
  if (display === 'denied') return 'denied';
  return 'default';
}

// ── Notification permission badge ─────────────────────────────────────

interface NotificationStatusBadgeProps {
  permission: NotificationPermission | 'unsupported';
  onEnable: () => void;
  enabling: boolean;
  isNative: boolean;
}

function NotificationStatusBadge({ permission, onEnable, enabling, isNative }: NotificationStatusBadgeProps) {
  if (permission === 'unsupported') return null;

  if (permission === 'granted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 border border-green-200">
        <CheckCircle2 className="h-3 w-3" />
        Enabled
      </span>
    );
  }

  if (permission === 'denied') {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <button className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-200 transition-colors cursor-pointer">
            <XCircle className="h-3 w-3" />
            Blocked
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Notifications are blocked
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-4 text-sm">
                <p>
                  Notifications were denied and can&apos;t be re-enabled from inside the app.
                  Follow the steps below for your device.
                </p>

                {isNative ? (
                  <>
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">iPhone:</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Open the <strong>Settings</strong> app</li>
                        <li>Scroll down and tap <strong>HYBRIDX.CLUB</strong></li>
                        <li>Tap <strong>Notifications</strong></li>
                        <li>Enable <strong>Allow Notifications</strong></li>
                      </ol>
                    </div>
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">Android:</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Open <strong>Settings</strong> → <strong>Apps</strong></li>
                        <li>Tap <strong>HYBRIDX.CLUB</strong></li>
                        <li>Tap <strong>Notifications</strong></li>
                        <li>Enable <strong>Allow notifications</strong></li>
                      </ol>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">Chrome (Android / Desktop):</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Tap the <strong>lock icon</strong> in the address bar</li>
                        <li>Tap <strong>Notifications</strong></li>
                        <li>Change from <strong>Block</strong> to <strong>Allow</strong></li>
                        <li>Reload the page</li>
                      </ol>
                    </div>
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">iPhone (installed PWA):</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Open the <strong>Settings</strong> app</li>
                        <li>Scroll down and tap <strong>HYBRIDX.CLUB</strong></li>
                        <li>Tap <strong>Notifications</strong> and enable them</li>
                      </ol>
                    </div>
                    <a
                      href="https://support.google.com/chrome/answer/3220216"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                    >
                      Chrome notification help <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  // permission === 'default' — not yet asked
  return (
    <button
      type="button"
      onClick={onEnable}
      disabled={enabling}
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-200 hover:bg-amber-200 transition-colors cursor-pointer disabled:opacity-50"
    >
      {enabling ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      {enabling ? 'Enabling…' : 'Not enabled — tap to enable'}
    </button>
  );
}