import { redirect } from 'next/navigation';

/** See ../page.tsx — the journal now lives in Talk to Coach. */
export default function JournalEntryPage() {
    redirect('/coach');
}
