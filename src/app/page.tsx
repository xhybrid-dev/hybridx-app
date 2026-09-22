
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import Image from 'next/image';
import {
  Sparkles,
  Activity,
  Flag,
  Watch,
  TrendingUp,
  Dumbbell,
  CheckCircle2,
  Smartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/icons';
import { getAdminAuth } from '@/lib/firebase-admin';
import { TRIAL_DAYS } from '@/lib/trial';
import { MarketingCaptureForm } from '@/components/marketing-capture-form';

const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI-Tailored Plans',
    description: 'Get a structured program matched to your goal, experience and weekly availability — built in seconds at signup.',
  },
  {
    icon: Activity,
    title: 'Adaptive Coaching',
    description: 'Your plan adjusts to how you actually train. Tell your coach what’s going on and it reshapes upcoming sessions — you approve every change.',
  },
  {
    icon: Flag,
    title: 'Race-Day Planner',
    description: 'Pick your event and date — we count back from race day with a periodised plan that peaks at the right time.',
  },
  {
    icon: Watch,
    title: 'Garmin & Strava Sync',
    description: 'Push workouts to your watch and pull your activities back in, so your training and your data stay in one place.',
  },
  {
    icon: TrendingUp,
    title: 'Progress & Streaks',
    description: 'Track every session, keep your weekly streak going, and see your consistency and training load build over time.',
  },
  {
    icon: Dumbbell,
    title: 'Built for Hybrid',
    description: 'Strength, endurance and HYROX-specific stations in one plan — no more juggling three different apps.',
  },
];

const STEPS = [
  { number: '1', title: 'Tell us your goal', description: 'A 60-second setup captures your experience, schedule and what you’re training for.' },
  { number: '2', title: 'Get your plan', description: 'We match you to a program and tailor it to your week — ready to start the same day.' },
  { number: '3', title: 'Train & adapt', description: 'Log sessions, sync your watch, and let the AI coach keep your plan on track.' },
];

export default async function WelcomePage() {
  // Check for session cookie server-side
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;

  if (sessionCookie) {
    try {
      const adminAuth = getAdminAuth();
      await adminAuth.verifySessionCookie(sessionCookie, true);
      console.log('✅ [WelcomePage] Valid session found, redirecting to dashboard');
      redirect('/dashboard');
    } catch (error) {
      console.log('⚠️ [WelcomePage] Session cookie found but invalid or expired');
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top nav */}
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-white">
            <Logo className="h-8 w-8 invert" />
            <span className="font-headline text-lg font-bold">HYBRIDX.CLUB</span>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden px-4 py-24 text-center">
        <Image
          src="/coverimage.jpg"
          alt="Athletes training"
          fill
          className="object-cover"
          priority
          data-ai-hint="fitness running"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/40" />

        <div className="relative z-10 flex max-w-3xl flex-col items-center text-white">
          <span className="mb-4 rounded-full border border-white/30 bg-white/10 px-4 py-1 text-sm font-medium backdrop-blur">
            Your AI hybrid-training coach
          </span>
          <h1 className="font-headline text-4xl font-bold leading-tight md:text-6xl">
            Train smarter for strength, endurance & HYROX
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/90">
            Personalised plans that adapt to how you train, sync to your watch, and get you to race day in peak form.
          </p>
          <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
            <Button asChild size="lg" variant="accent">
              <Link href="/signup">Start your {TRIAL_DAYS}-day free trial</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/login">I&apos;m already a member</Link>
            </Button>
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm text-white/70">
            <Smartphone className="h-4 w-4" /> Train on iOS, Android & web · Cancel anytime
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-headline text-3xl font-bold md:text-4xl">Everything you need in one plan</h2>
          <p className="mt-3 text-muted-foreground">
            Stop stitching together three apps. HybridX brings your training, racing and tracking together.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-headline text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-muted/40 py-20">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-headline text-3xl font-bold md:text-4xl">Up and running in minutes</h2>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.number} className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                  {step.number}
                </div>
                <h3 className="font-headline text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="mx-auto w-full max-w-3xl px-4 py-20 sm:px-6">
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <h2 className="font-headline text-3xl font-bold">Simple, honest pricing</h2>
          <p className="mt-3 text-muted-foreground">
            Try everything free for {TRIAL_DAYS} days. Keep going for just <span className="font-semibold text-foreground">£5/month</span>.
          </p>
          <ul className="mx-auto mt-6 grid max-w-md gap-3 text-left">
            {[
              'Full access to every program & feature',
              'AI coaching and race planning included',
              'Garmin & Strava integrations',
              'No commitment — cancel anytime',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Button asChild size="lg" variant="accent" className="mt-8">
            <Link href="/signup">Get started free</Link>
          </Button>
        </div>
      </section>

      {/* Newsletter capture — for visitors not ready to sign up yet. Without
          this, the only way to hear from a visitor was an account, so every
          other lead left no trace. */}
      <section className="border-t bg-muted/40 py-16">
        <div className="mx-auto w-full max-w-2xl px-4 text-center sm:px-6">
          <h2 className="font-headline text-2xl font-bold sm:text-3xl">
            Not ready to start training yet?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Get HYROX race guides, pacing strategy and training tips in your inbox.
          </p>
          <MarketingCaptureForm placement="homepage-footer" className="mt-6 text-left" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Logo className="h-6 w-6 text-primary" />
            <span className="font-headline font-semibold">HYBRIDX.CLUB</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/privacy-policy" className="hover:text-foreground">Privacy</Link>
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
            <Link href="/signup" className="hover:text-foreground">Get started</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
