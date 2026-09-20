// src/app/(app)/debug/layout.tsx
//
// The debug pages are development tooling. Their /api/debug/* counterparts
// already return 404 when NODE_ENV === 'production', so in production these
// pages can only ever render errors — but they were still prerendered into the
// build and reachable, advertising the debug surface for nothing.
//
// Gated here rather than deleted: they are genuinely useful in development, and
// this keeps the page behaviour identical to the routes they call.

import { notFound } from 'next/navigation';

export default function DebugLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <>{children}</>;
}
