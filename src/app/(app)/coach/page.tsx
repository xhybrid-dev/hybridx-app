import type { Metadata } from 'next';
import { TalkToCoach } from '@/components/talk-to-coach';

export const metadata: Metadata = {
    title: 'Talk to Coach | HYBRIDX.CLUB',
};

/**
 * Deep links from the rest of the app:
 * - `?q=` asks a question straight away ("talk to your coach about this session").
 * - `?about=` ties the next message to a session, e.g. from the workout-complete screen.
 * - `?draft=` starts the message for them, so they only have to finish it.
 */
export default async function CoachPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; about?: string; draft?: string }>;
}) {
    const { q, about, draft } = await searchParams;
    const text = (value: unknown, max: number) =>
        typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined;

    return (
        <div className="h-full flex flex-col">
            <div className="mb-4">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Talk to Coach</h1>
                <p className="text-muted-foreground">
                    Ask about your plan, or just keep your coach posted — type it or send a voice
                    note. Ill, away, a niggle, a great session: say it once and your coach remembers.
                </p>
            </div>
            <TalkToCoach
                seedMessage={text(q, 500)}
                initialAbout={text(about, 120)}
                initialDraft={text(draft, 500)}
            />
        </div>
    );
}
