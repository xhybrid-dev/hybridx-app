// src/app/(app)/test-image-generator/layout.tsx
//
// A test harness for WorkoutImageGenerator, not a product page. Excluded from
// production for the same reason as the debug pages — and because it is one of
// only two routes that pull in the 193KB html2canvas chunk.

import { notFound } from 'next/navigation';

export default function TestImageGeneratorLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <>{children}</>;
}
