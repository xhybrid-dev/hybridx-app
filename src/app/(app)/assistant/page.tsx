import { redirect } from 'next/navigation';

/**
 * The Edge Coach chat became Talk to Coach (/coach). Kept as a redirect so
 * links in emails, notifications and old app builds still land somewhere,
 * with any `?q=` question carried across.
 */
export default async function AssistantPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const { q } = await searchParams;
    redirect(typeof q === 'string' && q ? `/coach?q=${encodeURIComponent(q.slice(0, 500))}` : '/coach');
}
