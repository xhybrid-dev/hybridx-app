import { redirect } from 'next/navigation';

/**
 * The journal was folded into Talk to Coach: the things athletes wrote here
 * are the things their coach needs to hear, so now they tell it directly.
 * Old links (and entries' own pages below) land there instead.
 */
export default function JournalPage() {
    redirect('/coach');
}
