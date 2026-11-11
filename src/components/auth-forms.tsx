
'use client';
import { logger } from '@/lib/logger';
import { trackEvent } from '@/lib/analytics';
import { getAttribution } from '@/lib/attribution';
import { parseAcquisitionSrc } from '@/lib/acquisition-src';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Loader2, Eye, EyeOff, CheckCircle2, AlertCircle, Award } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, AuthErrorCodes, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getAuthInstance } from '@/lib/firebase';
import { authedFetch } from '@/lib/client-auth';
import { createUser } from '@/services/user-service-client';
import { getTopPrograms } from '@/services/program-recommendation';
import { getProgramByNameClient, getProgramClient } from '@/services/program-service-client';
import {
  ATHX_DIVISIONS,
  ATHX_DIVISION_LABELS,
  ATHX_EDITIONS,
  ATHX_EDITION_LABELS,
  ATHX_PLAN,
  athxOptions,
  athxProgramName,
  athxSelectionId,
  parseAthxSelection,
} from '@/lib/athx-programs';
import { parseSignupSeed, SEED_TOOL_LABELS, type SignupSeed } from '@/lib/signup-seed';
import { fitToSchedule } from '@/lib/plan-condense';
import { alignPlanToRace } from '@/services/race-scheduler';
import { addDays, format, nextMonday, startOfDay } from 'date-fns';
import type { WorkoutDay } from '@/models/types';
import { ProgramPreviewDialog } from '@/components/program-preview-dialog'; // IMPORTED

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';

const loginSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
});

export function LoginForm() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const completePendingStravaAuth = async () => {
    const pendingAuth = localStorage.getItem('pending-strava-auth');
    if (pendingAuth) {
        try {
            const { code, scope, timestamp } = JSON.parse(pendingAuth);
            
            // Check if the code is still fresh (codes expire quickly)
            if (Date.now() - timestamp < 300000) { // 5 minutes
                localStorage.removeItem('pending-strava-auth');
                
                // We need to set the session cookie before redirecting
                const auth = await getAuthInstance();
                const idToken = await auth.currentUser?.getIdToken(true);

                await fetch('/api/auth/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include', // Ensure cookies are sent/received
                  body: JSON.stringify({ idToken }),
                });

                // Redirect to complete the Strava connection
                window.location.href = `/api/strava/exchange?code=${code}&scope=${scope}`;
                return true; // Indicate that a redirect is happening
            }
        } catch (error) {
            logger.error('Failed to parse pending Strava auth:', error);
        }
        
        localStorage.removeItem('pending-strava-auth');
        toast({
            title: 'Strava Connection Expired',
            description: 'Please try connecting to Strava again from your profile.',
            variant: 'destructive'
        });
    }
    return false; // No redirect
  };

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    setIsLoading(true);
    try {
      const auth = await getAuthInstance();

      // CRITICAL: Set persistence BEFORE authentication
      await setPersistence(auth, browserLocalPersistence);

      const userCredential = await signInWithEmailAndPassword(auth, values.email, values.password);

      // CRITICAL FIX: Always create session cookie on login for server-side auth
      logger.log('🍪 Creating session cookie after login...');
      const idToken = await userCredential.user.getIdToken(true);
      if (idToken) {
          const sessionResponse = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // Ensure cookies are sent/received
            body: JSON.stringify({ idToken }),
          });

          if (sessionResponse.ok) {
            logger.log('✅ Session cookie created successfully');
          } else {
            logger.error('❌ Failed to create session cookie:', await sessionResponse.text());
          }
      }

      trackEvent(userCredential.user.uid, 'login', { method: 'email' });

      const wasRedirected = await completePendingStravaAuth();

      if (!wasRedirected) {
          toast({
            title: 'Login Successful',
            description: 'Redirecting to your dashboard...',
          });
          // Full page navigation ensures the session cookie is sent with the
          // first request to the server, avoiding middleware redirect-to-login
          // in proxy environments (e.g. Firebase Studio dev preview).
          window.location.href = '/dashboard';
      }
    } catch (error) {
      logger.error('Login error:', error);
      let description = 'An unexpected error occurred. Please try again.';
      if ((error as any).code === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS) {
        description = 'That email and password don\'t match. Use "Forgot password?" to choose a new one.';
      }
      toast({
        title: 'Login Failed',
        description,
        variant: 'destructive',
      });
      setIsLoading(false);
    }
    // Don't setIsLoading(false) if redirecting, to prevent button flicker
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="font-headline">Welcome Back</CardTitle>
        <CardDescription>Enter your credentials to access your dashboard.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="name@example.com" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href={`/forgot-password${form.watch('email') ? `?email=${encodeURIComponent(form.watch('email'))}` : ''}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <div className="relative">
                      <Input type={showPassword ? 'text' : 'password'} placeholder="••••••••" autoComplete="current-password" {...field} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowPassword((prev) => !prev)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        <span className="sr-only">{showPassword ? 'Hide password' : 'Show password'}</span>
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="font-semibold text-primary hover:underline">
                Sign Up
              </Link>
            </p>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required.'),
  lastName: z.string().min(1, 'Last name is required.'),
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  frequency: z.enum(['3', '4', '5+']),
  goal: z.enum(['strength', 'endurance', 'hybrid']),
  selectedProgramId: z.string().optional(),
  /** YYYY-MM-DD, when they have a race booked. */
  raceDate: z.string().optional(),
  startWhen: z.enum(['today', 'tomorrow', 'monday']).optional(),
  /** What they are training for. ATHX picks one of the ATHX 2027 plans. */
  event: z.enum(['hyrox', 'athx']).optional(),
  athxEdition: z.enum(ATHX_EDITIONS).optional(),
  athxDivision: z.enum(ATHX_DIVISIONS).optional(),
});

type SignupData = z.infer<typeof signupSchema>;

/** Day 1 of the plan for the start the athlete picked. */
function resolveStartDate(when: SignupData['startWhen']): Date {
  const today = startOfDay(new Date());
  if (when === 'tomorrow') return addDays(today, 1);
  if (when === 'monday') return nextMonday(today);
  return new Date();
}

/** Quick start's plan: the best match for a beginner with no other answers (First Steps to Hyrox). */
const QUICK_START_PROGRAM_ID = getTopPrograms({ experience: 'beginner', frequency: '3', goal: 'hybrid' }, 1)[0]?.program.id;

/** The answers a sign-up link from hybridx.club carried, as form values. */
function seedToForm(seed: SignupSeed): Partial<SignupData> {
  const values: Partial<SignupData> = {
    experience: seed.experience,
    frequency: seed.frequency,
    goal: seed.goal,
    raceDate: seed.raceDate,
    event: seed.event,
    athxEdition: seed.athxEdition,
    athxDivision: seed.athxDivision,
  };
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Partial<SignupData>;
}

/**
 * The plan the answers so far point to, for "start with my plan" on step 2:
 * the athlete's ATHX plan when they named edition and division, otherwise the
 * best HYROX match. Undefined for ATHX without both, which must be asked.
 */
function planFor(data: Partial<SignupData>): { id: string; name: string } | undefined {
  if (data.event === 'athx') {
    return data.athxEdition && data.athxDivision
      ? { id: athxSelectionId(data.athxEdition, data.athxDivision), name: athxProgramName(data.athxEdition, data.athxDivision) }
      : undefined;
  }
  const top = getTopPrograms(
    { experience: data.experience ?? 'beginner', frequency: data.frequency ?? '3', goal: data.goal ?? 'hybrid' },
    1,
  )[0];
  return top ? { id: top.program.id, name: top.program.name } : undefined;
}

const initialSignupData: Partial<SignupData> = {
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  experience: 'beginner',
  frequency: '3',
  goal: 'hybrid',
  selectedProgramId: undefined,
};

export function SignupForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<SignupData>>(initialSignupData);
  const [signupStartedAt] = useState(() => Date.now());
  // Answers carried from a tool on hybridx.club (src/lib/signup-seed.ts). Read
  // after mount so the server render and the first client render agree.
  const [seed, setSeed] = useState<SignupSeed | null>(null);
  // Whether days a week came from the athlete (step 4, or the tool they came
  // from) rather than the form's default of 3, which nobody chose.
  const [frequencyKnown, setFrequencyKnown] = useState(false);

  useEffect(() => {
    const fromLink = parseSignupSeed(window.location.search);
    trackEvent(
      null,
      'signup_page_viewed',
      fromLink ? { seededFrom: fromLink.tool ?? 'hybridx.club', seededEvent: fromLink.event ?? 'hyrox' } : undefined,
    );
    if (fromLink) {
      setSeed(fromLink);
      setFormData((prev) => ({ ...prev, ...seedToForm(fromLink) }));
      if (fromLink.frequency) setFrequencyKnown(true);
    }
  }, []);

  const handleNext = (data: Partial<SignupData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
    if (step === 4) setFrequencyKnown(true);
    const nextStep = step + 1;
    trackEvent(null, 'onboarding_step_completed', {
      step,
      timeOnStepMs: Date.now() - signupStartedAt,
    });
    setStep(nextStep);
  };

  const handlePrev = () => {
    setStep((prev) => prev - 1);
  };

  const handleSkipAssessmentStep = () => {
    setStep((prev) => prev + 1);
  };

  const handleQuickStart = (stepData: Partial<SignupData>) => {
    // Came from a tool on hybridx.club: start on the plan those answers point
    // to, fitted to the days they gave, rather than the beginner default.
    const seededPlan = seed ? planFor(formData) : undefined;
    if (seededPlan) {
      const seededData: Partial<SignupData> = { ...formData, ...stepData, selectedProgramId: seededPlan.id };
      setFormData(seededData);
      void handleSubmit(seededData);
      return;
    }

    // A real plan from day one. This used to be three AI one-off workouts that
    // ran out on day 4, leaving anyone who missed one with nothing at all.
    const quickData: Partial<SignupData> = {
      ...formData,
      ...stepData,
      experience: 'beginner',
      frequency: '3',
      goal: 'hybrid',
      selectedProgramId: QUICK_START_PROGRAM_ID,
    };
    setFormData(quickData);
    void handleSubmit(quickData, true);
  };

  const handleSubmit = async (data: Partial<SignupData>, isQuickStart = false) => {
    setIsLoading(true);
    const finalData = { ...formData, ...data } as SignupData;

    try {
      const auth = await getAuthInstance();

      // CRITICAL: Set persistence BEFORE authentication
      await setPersistence(auth, browserLocalPersistence);

      // 1. Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, finalData.email, finalData.password);
      const user = userCredential.user;

      // 1.1. Send a verification email (non-blocking — we don't gate activation
      // on it). Prefer our own transport (Brevo/Gmail) so it lands in the inbox;
      // fall back to Firebase's client sender if that call fails.
      (async () => {
        try {
          const res = await authedFetch('/api/auth/send-verification', { method: 'POST' });
          if (!res.ok) throw new Error(`send-verification failed: ${res.status}`);
        } catch (err) {
          logger.error('Verification via transport failed, falling back to Firebase sender:', err);
          sendEmailVerification(user).catch((e) => logger.error('Fallback verification email failed:', e));
        }
      })();

      // 1.5. CRITICAL FIX: Create session cookie immediately after signup
      logger.log('🍪 Creating session cookie after signup...');
      const idToken = await user.getIdToken(true);
      if (idToken) {
        const sessionResponse = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include', // Ensure cookies are sent/received
          body: JSON.stringify({ idToken }),
        });

        if (sessionResponse.ok) {
          logger.log('✅ Session cookie created successfully');

          // Wait for cookie to be properly set before navigation
          await new Promise(resolve => setTimeout(resolve, 100));

          // Force Next.js to recognize the new session cookie
          router.refresh();
        } else {
          logger.error('❌ Failed to create session cookie:', await sessionResponse.text());
        }
      }


      // 2. Prepare the plan: fit it to their week, then line it up with their
      // race if they have one; otherwise start on the day they chose.
      let customProgram: WorkoutDay[] | null = null;
      let adjustmentMessage = "";
      const raceDate = finalData.raceDate ? new Date(`${finalData.raceDate}T12:00:00`) : null;
      let startDate = isQuickStart ? new Date() : resolveStartDate(finalData.startWhen);

      // An ATHX 2027 plan is chosen by edition and division and found by name
      // now that the account can read programs (src/lib/athx-programs.ts).
      const athx = parseAthxSelection(finalData.selectedProgramId);
      let programId: string | null = athx ? null : finalData.selectedProgramId || null;

      if (finalData.selectedProgramId) {
        try {
          const selectedProgram = athx
            ? await getProgramByNameClient(athxProgramName(athx.edition, athx.division))
            : await getProgramClient(finalData.selectedProgramId);
          if (athx && !selectedProgram) {
            logger.error(`ATHX plan not found by name: ${athxProgramName(athx.edition, athx.division)}`);
          }
          if (selectedProgram) {
            programId = selectedProgram.id;
            // Quick start skips the questions, so it takes the program as written.
            // So does ATHX: a competition plan written for six days, some of
            // them doubled, and the frequency answer may be only the form's
            // default (see Step6's note).
            const fitted = isQuickStart || athx ? null : fitToSchedule(selectedProgram.workouts, finalData.frequency);
            if (fitted) {
              customProgram = fitted;
              adjustmentMessage = ` We've fitted it to your ${finalData.frequency}-day week.`;
            }
            if (raceDate && raceDate > new Date()) {
              const aligned = alignPlanToRace(customProgram ?? selectedProgram.workouts, raceDate);
              customProgram = aligned.workouts;
              startDate = aligned.startDate;
              adjustmentMessage += ' It finishes on race day.';
            }
          }
        } catch (adjustError) {
          logger.error('Program adjustment failed:', adjustError);
          // Continue with the program as written if this fails
        }
      }

      // 4. Save user profile data to Firestore with selected program
      const attribution = getAttribution();
      await createUser(user.uid, {
        email: finalData.email,
        firstName: finalData.firstName,
        lastName: finalData.lastName,
        experience: finalData.experience,
        frequency: finalData.frequency,
        goal: finalData.goal,
        programId,
        startDate: programId ? startDate : undefined,
        raceDate: raceDate ?? undefined,
        raceName: raceDate && finalData.event === 'athx' ? 'ATHX' : undefined,
        customProgram: customProgram,
        onboardingSkipped: isQuickStart,
        acquisitionSource: attribution?.utmSource,
        acquisitionMedium: attribution?.utmMedium,
        acquisitionCampaign: attribution?.utmCampaign,
        acquisitionTerm: attribution?.utmTerm,
        acquisitionContent: attribution?.utmContent,
        acquisitionLandingPage: attribution?.landingPage,
        acquisitionReferrer: attribution?.referrer,
        acquisitionSrc: parseAcquisitionSrc(attribution?.src),
      });

      const programMessage = programId
        ? " Your selected program is ready to start!" + adjustmentMessage
        : " You can select a program from your dashboard.";

      trackEvent(user.uid, 'onboarding_completed', {
        experience: finalData.experience,
        frequency: finalData.frequency,
        goal: finalData.goal,
        selectedProgramId: programId,
        event: finalData.event ?? 'hyrox',
        seededFrom: seed?.tool ?? (seed ? 'hybridx.club' : null),
        programAdjusted: !!customProgram,
        totalTimeMs: Date.now() - signupStartedAt,
      });

      toast({
          title: "Account Created!",
          description: "Welcome." + programMessage,
      });
      // Send to setup page to install PWA + enable notifications before dashboard
      router.push('/setup');

    } catch (error) {
        logger.error('Signup error:', error);
        let description = "An unexpected error occurred. Please try again.";
        if ((error as any).code === AuthErrorCodes.EMAIL_EXISTS) {
            description = "This email address is already in use.";
        } else if ((error as any).code === AuthErrorCodes.WEAK_PASSWORD) {
            description = "The password is too weak. Please choose a stronger password.";
        }
        toast({
            title: "Signup Failed",
            description,
            variant: "destructive",
        });
    } finally {
        setIsLoading(false);
    }
  };

  const seededPlan = seed ? planFor(formData) : undefined;
  const quickStart = !seed
    ? {
        label: 'Jump Straight In',
        note: "We'll start you on First Steps to Hyrox, our 12-week beginner plan. Or take 2 minutes to personalise and get a matched program.",
      }
    : seededPlan
      ? {
          label: `Start ${seededPlan.name}`,
          note: `Matched to your answers${seed.tool ? ` in ${SEED_TOOL_LABELS[seed.tool]}` : ''}${
            formData.raceDate ? `, finishing on race day` : ''
          }. Or go through the questions to change them.`,
        }
      : null;

  return (
    <Card className="w-full max-w-3xl">
      {seed && <SeedNote seed={seed} />}
      {step === 1 && <Step1 onNext={handleNext} defaultValues={formData} />}
      {step === 2 && <Step2 onNext={handleNext} onPrev={handlePrev} onQuickStart={handleQuickStart} quickStart={quickStart} defaultValues={formData} isLoading={isLoading} />}
      {step === 3 && <Step3 onNext={handleNext} onPrev={handlePrev} onSkip={handleSkipAssessmentStep} defaultValues={formData} />}
      {step === 4 && <Step4 onNext={handleNext} onPrev={handlePrev} onSkip={handleSkipAssessmentStep} defaultValues={formData} />}
      {step === 5 && <Step5 onNext={handleNext} onPrev={handlePrev} onSkip={handleSkipAssessmentStep} defaultValues={formData} />}
      {step === 6 && <RaceStep onNext={handleNext} onPrev={handlePrev} defaultValues={formData} />}
      {step === 7 && <Step6 onSubmit={handleSubmit} onPrev={handlePrev} defaultValues={formData} frequencyKnown={frequencyKnown} isLoading={isLoading} />}
    </Card>
  );
}

function Step1({ onNext, defaultValues }: any) {
  const form = useForm({
    resolver: zodResolver(signupSchema.pick({ email: true, password: true })),
    defaultValues,
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onNext)}>
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Start your journey with HYBRIDX.CLUB.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem><FormLabel>Email</FormLabel><FormControl><Input placeholder="name@example.com" autoComplete="email" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="password" render={({ field }) => (
            <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" placeholder="Min. 8 characters" autoComplete="new-password" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </CardContent>
        <CardFooter>
          <Button type="submit" className="ml-auto">Next <ArrowRight className="ml-2 h-4 w-4" /></Button>
        </CardFooter>
      </form>
    </Form>
  );
}

/** What a sign-up link from hybridx.club filled in, said once at the top of the form. */
function SeedNote({ seed }: { seed: SignupSeed }) {
  const parts: string[] = [];
  if (seed.event === 'athx') {
    parts.push(
      [
        'ATHX',
        seed.athxEdition && `${ATHX_EDITION_LABELS[seed.athxEdition]} edition`,
        seed.athxDivision && `${ATHX_DIVISION_LABELS[seed.athxDivision]} division`,
      ]
        .filter(Boolean)
        .join(', '),
    );
  }
  if (seed.frequency) parts.push(`${seed.frequency === '5+' ? '5 or more' : seed.frequency} days a week`);
  if (seed.goal) parts.push({ strength: 'building strength', endurance: 'building endurance', hybrid: 'strength and engine together' }[seed.goal]);
  if (seed.raceDate) parts.push(`race on ${format(new Date(`${seed.raceDate}T12:00:00`), 'd MMMM yyyy')}`);
  return (
    <p className="mx-6 mt-6 rounded-md bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
      {seed.tool ? `From ${SEED_TOOL_LABELS[seed.tool]}` : 'From hybridx.club'}
      {parts.length ? `: ${parts.join(', ')}` : ''}. We&apos;ve filled these in, and you can change any of them.
    </p>
  );
}

function Step2({ onNext, onPrev, onQuickStart, quickStart, defaultValues, isLoading }: any) {
  const form = useForm({
    resolver: zodResolver(signupSchema.pick({ firstName: true, lastName: true })),
    defaultValues,
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onNext)}>
        <CardHeader>
          <CardTitle>What's your name?</CardTitle>
          <CardDescription>Just your name to get started — everything else is optional.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField control={form.control} name="firstName" render={({ field }) => (
            <FormItem><FormLabel>First Name</FormLabel><FormControl><Input placeholder="Jane" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="lastName" render={({ field }) => (
            <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input placeholder="Doe" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </CardContent>
        <CardFooter className="flex-col gap-3 pt-2">
          {quickStart ? (
            <>
              <Button
                type="button"
                className="w-full h-auto min-h-11 whitespace-normal"
                size="lg"
                onClick={form.handleSubmit(onQuickStart)}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {quickStart.label} <ArrowRight className="ml-2 h-4 w-4 flex-shrink-0" />
              </Button>
              <p className="text-xs text-muted-foreground text-center">{quickStart.note}</p>
              <div className="flex items-center w-full gap-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or personalise your plan</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground text-center">
              A few quick questions, including your ATHX edition and division, and your plan is ready.
            </p>
          )}
          <div className="flex w-full items-center justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={onPrev}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
            <Button type="submit" variant={quickStart ? 'outline' : 'default'} size="sm">Fitness Questions <ArrowRight className="ml-2 h-4 w-4" /></Button>
          </div>
        </CardFooter>
      </form>
    </Form>
  );
}

function Step3({ onNext, onPrev, onSkip, defaultValues }: any) {
  const form = useForm({
    resolver: zodResolver(signupSchema.pick({ experience: true })),
    defaultValues,
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onNext)}>
        <CardHeader>
          <CardTitle>Your Training Level <span className="text-sm font-normal text-muted-foreground ml-2">1 of 4</span></CardTitle>
          <CardDescription>Helps us match you to the right program intensity.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormField control={form.control} name="experience" render={({ field }) => (
            <FormItem><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="space-y-2">
              <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="beginner" /></FormControl><FormLabel className="font-normal">Beginner — New to structured training</FormLabel></FormItem>
              <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="intermediate" /></FormControl><FormLabel className="font-normal">Intermediate — Consistent training 6+ months</FormLabel></FormItem>
              <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="advanced" /></FormControl><FormLabel className="font-normal">Advanced — Years of dedicated training</FormLabel></FormItem>
            </RadioGroup></FormControl><FormMessage /></FormItem>
          )} />
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <div className="flex justify-between w-full">
            <Button type="button" variant="ghost" onClick={onPrev}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
            <Button type="submit">Next <ArrowRight className="ml-2 h-4 w-4" /></Button>
          </div>
          <Button type="button" variant="link" size="sm" className="text-muted-foreground h-auto py-0" onClick={onSkip}>
            Skip this question
          </Button>
        </CardFooter>
      </form>
    </Form>
  );
}

function Step4({ onNext, onPrev, onSkip, defaultValues }: any) {
  const form = useForm({
    resolver: zodResolver(signupSchema.pick({ frequency: true })),
    defaultValues,
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onNext)}>
        <CardHeader>
          <CardTitle>Your Schedule <span className="text-sm font-normal text-muted-foreground ml-2">2 of 4</span></CardTitle>
          <CardDescription>How many days per week can you train?</CardDescription>
        </CardHeader>
        <CardContent>
          <FormField control={form.control} name="frequency" render={({ field }) => (
            <FormItem><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="space-y-2">
              <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="3" /></FormControl><FormLabel className="font-normal">3 days / week</FormLabel></FormItem>
              <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="4" /></FormControl><FormLabel className="font-normal">4 days / week</FormLabel></FormItem>
              <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="5+" /></FormControl><FormLabel className="font-normal">5+ days / week</FormLabel></FormItem>
            </RadioGroup></FormControl><FormMessage /></FormItem>
          )} />
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <div className="flex justify-between w-full">
            <Button type="button" variant="ghost" onClick={onPrev}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
            <Button type="submit">Next <ArrowRight className="ml-2 h-4 w-4" /></Button>
          </div>
          <Button type="button" variant="link" size="sm" className="text-muted-foreground h-auto py-0" onClick={onSkip}>
            Skip this question
          </Button>
        </CardFooter>
      </form>
    </Form>
  );
}

function Step5({ onNext, onPrev, onSkip, defaultValues }: any) {
  const form = useForm({
    resolver: zodResolver(signupSchema.pick({ goal: true })),
    defaultValues,
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onNext)}>
        <CardHeader>
          <CardTitle>Your Goal <span className="text-sm font-normal text-muted-foreground ml-2">3 of 4</span></CardTitle>
          <CardDescription>What brings you to HYBRIDX?</CardDescription>
        </CardHeader>
        <CardContent>
          <FormField control={form.control} name="goal" render={({ field }) => (
            <FormItem><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="space-y-2">
              <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="strength" /></FormControl><FormLabel className="font-normal">Build Strength</FormLabel></FormItem>
              <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="endurance" /></FormControl><FormLabel className="font-normal">Improve Endurance</FormLabel></FormItem>
              <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="hybrid" /></FormControl><FormLabel className="font-normal">Hybrid — Balanced strength and cardio</FormLabel></FormItem>
            </RadioGroup></FormControl><FormMessage /></FormItem>
          )} />
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <div className="flex justify-between w-full">
            <Button type="button" variant="ghost" onClick={onPrev}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
            <Button type="submit">Next <ArrowRight className="ml-2 h-4 w-4" /></Button>
          </div>
          <Button type="button" variant="link" size="sm" className="text-muted-foreground h-auto py-0" onClick={onSkip}>
            Skip this question
          </Button>
        </CardFooter>
      </form>
    </Form>
  );
}

/**
 * What they are training for, and when. HYROX athletes train towards a date;
 * a plan that knows it can peak on race day. ATHX athletes get one of the
 * ATHX 2027 plans, which needs their edition and division: the loads differ.
 */
function RaceStep({ onNext, onPrev, defaultValues }: any) {
  const [event, setEvent] = useState<'hyrox' | 'athx'>(defaultValues.event ?? 'hyrox');
  const [edition, setEdition] = useState<string>(defaultValues.athxEdition ?? '');
  const [division, setDivision] = useState<string>(defaultValues.athxDivision ?? '');
  const [hasRace, setHasRace] = useState<boolean>(!!defaultValues.raceDate);
  const [raceDate, setRaceDate] = useState<string>(defaultValues.raceDate ?? '');
  const minDate = format(addDays(new Date(), 7), 'yyyy-MM-dd');
  const athxReady = event !== 'athx' || (!!edition && !!division);
  const valid = athxReady && (!hasRace || (raceDate && raceDate >= minDate));

  const next = () =>
    onNext({
      event,
      athxEdition: event === 'athx' ? edition : undefined,
      athxDivision: event === 'athx' ? division : undefined,
      raceDate: hasRace && raceDate ? raceDate : undefined,
    });

  return (
    <>
      <CardHeader>
        <CardTitle>Your race <span className="text-sm font-normal text-muted-foreground ml-2">4 of 4</span></CardTitle>
        <CardDescription>With a date, your plan builds towards it and finishes on race day.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Training for</Label>
          <RadioGroup value={event} onValueChange={v => setEvent(v as 'hyrox' | 'athx')} className="flex flex-wrap gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="hyrox" id="event-hyrox" />
              <Label htmlFor="event-hyrox" className="font-normal">HYROX, or general fitness</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="athx" id="event-athx" />
              <Label htmlFor="event-athx" className="font-normal">ATHX</Label>
            </div>
          </RadioGroup>
        </div>
        {event === 'athx' && (
          <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Edition</Label>
              <RadioGroup value={edition} onValueChange={setEdition} className="space-y-2">
                {ATHX_EDITIONS.map(e => (
                  <div key={e} className="flex items-center space-x-2">
                    <RadioGroupItem value={e} id={`edition-${e}`} />
                    <Label htmlFor={`edition-${e}`} className="font-normal">{ATHX_EDITION_LABELS[e]}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label>Division</Label>
              <RadioGroup value={division} onValueChange={setDivision} className="space-y-2">
                {ATHX_DIVISIONS.map(d => (
                  <div key={d} className="flex items-center space-x-2">
                    <RadioGroupItem value={d} id={`division-${d}`} />
                    <Label htmlFor={`division-${d}`} className="font-normal">{ATHX_DIVISION_LABELS[d]}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              The plan&apos;s loads are set by edition and division. Pick the division you have entered, or mean to.
            </p>
          </div>
        )}
        <Label className="block">Got a date booked?</Label>
        <RadioGroup value={hasRace ? 'yes' : 'no'} onValueChange={v => setHasRace(v === 'yes')} className="space-y-2">
          <div className="flex items-center space-x-3">
            <RadioGroupItem value="yes" id="race-yes" />
            <Label htmlFor="race-yes" className="font-normal">Yes — I have a date</Label>
          </div>
          <div className="flex items-center space-x-3">
            <RadioGroupItem value="no" id="race-no" />
            <Label htmlFor="race-no" className="font-normal">Not yet — I&apos;m training generally</Label>
          </div>
        </RadioGroup>
        {hasRace && (
          <div className="space-y-2">
            <Label htmlFor="race-date">Race date</Label>
            <Input id="race-date" type="date" min={minDate} value={raceDate} onChange={e => setRaceDate(e.target.value)} />
            {raceDate && raceDate < minDate && (
              <p className="text-sm text-destructive">Pick a date at least a week away.</p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button type="button" variant="ghost" onClick={onPrev}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <Button type="button" disabled={!valid} onClick={next}>
          Next <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardFooter>
    </>
  );
}

function Step6({ onSubmit, onPrev, defaultValues, frequencyKnown, isLoading }: any) {
  const athx = defaultValues.event === 'athx' && defaultValues.athxEdition;
  // Get top 3 program recommendations based on user preferences. An ATHX
  // athlete gets the three ATHX 2027 plans of their edition, their division
  // first, shaped like recommendations so the list below renders them as is.
  const fewerDays = frequencyKnown && (defaultValues.frequency === '3' || defaultValues.frequency === '4');
  const recommendations = athx
    ? athxOptions(defaultValues.athxEdition, defaultValues.athxDivision).map((o) => ({
        program: {
          id: o.id,
          name: o.name,
          duration: ATHX_PLAN.weeks,
          daysPerWeek: ATHX_PLAN.trainingDaysPerWeek,
          description: `The ATHX 2027 plan with ${ATHX_DIVISION_LABELS[o.division]} division loads: ${ATHX_PLAN.summary}`,
        },
        // Not a score: the division is the athlete's to choose.
        matchLabel: o.division === defaultValues.athxDivision ? 'Your division' : 'Another division',
        matchPercentage: 0,
        matchReasons: o.division === defaultValues.athxDivision ? ['Your edition and division'] : [],
        considerations: fewerDays
          ? [
              `Written for ${ATHX_PLAN.trainingDaysPerWeek} training days a week, some of them doubled, and set up as written. On ${defaultValues.frequency} days a week, ask Edge Coach which sessions to keep.`,
            ]
          : [],
        isAthx: true,
      }))
    : getTopPrograms({
        experience: defaultValues.experience,
        frequency: defaultValues.frequency,
        goal: defaultValues.goal
      }, 3);

  const form = useForm({
    defaultValues: {
      selectedProgramId: recommendations[0]?.program.id || ''
    }
  });

  const selectedProgramId = form.watch('selectedProgramId');
  // Signing up late in the evening shouldn't make day 1 a day already gone.
  const [startWhen, setStartWhen] = useState<'today' | 'tomorrow' | 'monday'>(
    new Date().getHours() >= 18 ? 'tomorrow' : 'today',
  );

  const handleStartNow = () => {
    const dataWithProgram = {
      ...defaultValues,
      selectedProgramId: form.getValues('selectedProgramId'),
      startWhen,
    };
    onSubmit(dataWithProgram);
  };

  const handleSkip = () => {
    const dataWithoutProgram = {
      ...defaultValues,
      selectedProgramId: undefined
    };
    onSubmit(dataWithoutProgram);
  };

  return (
    <Form {...form}>
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Award className="h-6 w-6 text-primary" />
          <CardTitle>Choose Your Program</CardTitle>
        </div>
        <CardDescription>
          Select a program to start immediately, or skip and choose later from your dashboard
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          control={form.control}
          name="selectedProgramId"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="space-y-4"
                >
                  {recommendations.map((rec, index) => {
                    const isTopMatch = index === 0;
                    const isSelected = selectedProgramId === rec.program.id;

                    return (
                      <div
                        key={rec.program.id}
                        className={`relative border-2 rounded-lg p-4 transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : isTopMatch
                            ? 'border-primary/30 hover:border-primary/50'
                            : 'border-border hover:border-primary/30'
                        }`}
                      >
                        <FormItem className="flex items-start space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value={rec.program.id} className="mt-1" />
                          </FormControl>
                          <div className="flex-1 space-y-3">
                            <div className="cursor-pointer" onClick={() => field.onChange(rec.program.id)}>
                              <div className="flex items-center gap-2 mb-1">
                                <FormLabel className="font-bold text-base cursor-pointer">
                                  {rec.program.name}
                                </FormLabel>
                                {isTopMatch && (
                                  <span className="inline-flex items-center rounded-full bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">
                                    Best Match
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {'matchLabel' in rec ? rec.matchLabel : `${rec.matchPercentage}% match`} • {rec.program.duration} weeks • {rec.program.daysPerWeek} days/week
                              </p>
                            </div>

                            <p className="text-sm">{rec.program.description}</p>

                            {rec.matchReasons.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">Why this fits:</p>
                                {rec.matchReasons.slice(0, 2).map((reason, idx) => (
                                  <div key={idx} className="flex items-start gap-2 text-xs">
                                    <CheckCircle2 className="h-3 w-3 text-green-600 mt-0.5 flex-shrink-0" />
                                    <span className="text-muted-foreground">{reason}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* ATHX plans have no id until the account can look them up. */}
                            {!('isAthx' in rec) && (
                              <ProgramPreviewDialog
                                programId={rec.program.id}
                                programName={rec.program.name}
                              />
                            )}

                            {rec.considerations.length > 0 && isSelected && (
                              <div className="space-y-1 border-t pt-2 mt-2">
                                <p className="text-xs font-medium text-muted-foreground">Things to consider:</p>
                                {rec.considerations.map((consideration, idx) => (
                                  <div key={idx} className="flex items-start gap-2 text-xs">
                                    <AlertCircle className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <span className="text-muted-foreground">{consideration}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </FormItem>
                      </div>
                    );
                  })}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {defaultValues.raceDate ? (
          <p className="text-sm text-muted-foreground">
            Your plan will be lined up to finish on race day, {format(new Date(`${defaultValues.raceDate}T12:00:00`), 'EEEE d MMMM')}.
          </p>
        ) : (
          <div className="space-y-2">
            <Label>When do you want to start?</Label>
            <RadioGroup value={startWhen} onValueChange={v => setStartWhen(v as typeof startWhen)} className="flex flex-wrap gap-4">
              {(['today', 'tomorrow', 'monday'] as const).map(option => (
                <div key={option} className="flex items-center space-x-2">
                  <RadioGroupItem value={option} id={`start-${option}`} />
                  <Label htmlFor={`start-${option}`} className="font-normal capitalize">{option === 'monday' ? 'Next Monday' : option}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        )}

        <div className="bg-muted/50 rounded-lg p-4 text-sm">
          <p className="font-medium mb-1">Not sure yet?</p>
          <p className="text-muted-foreground text-xs">
            You can skip program selection and browse all available programs from your dashboard after creating your account.
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onPrev}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleSkip} disabled={isLoading}>
            Skip for Now
          </Button>
          <Button onClick={handleStartNow} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start Now
          </Button>
        </div>
      </CardFooter>
    </Form>
  );
}
