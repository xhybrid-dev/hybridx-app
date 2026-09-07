import type { Metadata } from 'next';
import { AssistantChat } from '@/components/assistant-chat';

export const metadata: Metadata = {
    title: 'Edge Coach | HYBRIDX.CLUB',
};

/**
 * `?q=` seeds the first message, so "talk to your coach about this session" from
 * the dashboard or a workout arrives as a question already asked rather than an
 * empty box the athlete has to fill in.
 */
export default async function AssistantPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const { q } = await searchParams;

    return (
        <div className="h-full flex flex-col">
            <div className="mb-4">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Edge Coach</h1>
                <p className="text-muted-foreground">
                    Your coach knows this week&apos;s plan, what you&apos;ve actually done and how
                    it&apos;s been going. Talk it through.
                </p>
            </div>
            <AssistantChat seedMessage={typeof q === 'string' ? q.slice(0, 500) : undefined} />
        </div>
    );
}
