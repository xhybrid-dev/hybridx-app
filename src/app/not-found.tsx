import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Logo } from '@/components/icons';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo className="h-10 w-10" />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold font-headline">This page doesn&apos;t exist</h1>
        <p className="text-muted-foreground">The link may be out of date. Your training is waiting on the dashboard.</p>
      </div>
      <Button asChild size="lg">
        <Link href="/dashboard">Go to today&apos;s training</Link>
      </Button>
    </main>
  );
}
