
// src/app/(app)/programs/[programId]/view/page.tsx
'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { Loader2, ArrowLeft, Printer, CalendarPlus, AlertTriangle } from 'lucide-react';

import { auth } from '@/lib/firebase';
import type { Program, User, PaceZone, WorkoutDay } from '@/models/types';
import { getProgramClient, getPersonalProgram } from '@/services/program-service-client'; // IMPORTED getPersonalProgram
import { getUserClient, updateUser } from '@/services/user-service-client';
import { clearFutureProgramSessions } from '@/services/session-service';
import { logger } from '@/lib/logger';
import { useToast } from '@/hooks/use-toast';
import { calculateTrainingPaces, formatPace } from '@/lib/pace-utils';
import { fitToSchedule } from '@/lib/plan-condense';
import { hasRuns, hasExercises } from '@/lib/type-guards';


import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgramCalendarView } from '@/components/program-calendar-view';
import { ProgramScheduleDialog } from '@/components/program-schedule-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUser } from '@/contexts/user-context';

export default function ProgramViewPage({ params }: { params: Promise<{ programId: string }> }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [trainingPaces, setTrainingPaces] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const { refreshData } = useUser();

  // Unwrap the params Promise
  const { programId } = use(params);
  
  useEffect(() => {
    const fetchData = async (id: string) => {
      if (!id) {
        router.push('/programs');
        return;
      }

      try {
        // CHANGED: Try global, then personal program view support
        let fetchedProgram = await getProgramClient(id);
        
        const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
              const currentUser = await getUserClient(firebaseUser.uid);
              setUser(currentUser);

              // If global fetch failed, try personal since we have the userId now
              if (!fetchedProgram) {
                  fetchedProgram = await getPersonalProgram(firebaseUser.uid, id);
              }

              if (!fetchedProgram) {
                toast({ title: 'Error', description: 'Program not found.', variant: 'destructive' });
                router.push('/programs');
                return;
              }
              setProgram(fetchedProgram);

              // CHANGED: ALWAYS calculate paces if user has benchmark profile, 
              // regardless of programType. This is safer and avoids mapping bugs.
              if (currentUser) {
                  const paces = calculateTrainingPaces(currentUser);
                  setTrainingPaces(paces);
              }
            }
            setLoading(false);
        });

        return () => unsubscribeAuth();

      } catch (error) {
        console.error('Failed to load program:', error);
        toast({ title: 'Error', description: 'Failed to load program details.', variant: 'destructive' });
        setLoading(false);
      }
    };
    
    if (programId) {
      fetchData(programId);
    }
  }, [programId, router, toast]);

  const handleDownloadPDF = async () => {
    if (!program) return;
    setIsDownloading(true);

    try {
        toast({ title: 'Generating PDF...', description: 'Please wait while we create your training calendar.' });

        // Loaded on click, not on page load. Statically imported, jspdf and
        // html2canvas put ~520KB of parse-and-execute in front of an athlete who
        // only wanted to read a training plan; most visits never export a PDF.
        const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
            import('jspdf'),
            import('html2canvas'),
        ]);

        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4',
            compress: true,
        });

        const pageWidth = 297;
        const pageHeight = 210;
        const margin = 10;
        const contentWidth = pageWidth - (margin * 2);

        const workoutsByDay = program.workouts.reduce((map, w) => {
            const list = map.get(w.day) ?? [];
            list.push(w);
            map.set(w.day, list);
            return map;
        }, new Map<number, typeof program.workouts>());
        const maxDay = program.workouts.reduce((max, w) => Math.max(max, w.day), 0);
        const totalWeeks = Math.ceil(maxDay / 7);

        // Calculate weeks per page (approximately 2-3 weeks fit well on landscape A4)
        const weeksPerPage = 2;
        const totalPages = Math.ceil(totalWeeks / weeksPerPage);

        for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
            if (pageIndex > 0) pdf.addPage();

            const startWeek = pageIndex * weeksPerPage;
            const endWeek = Math.min(startWeek + weeksPerPage, totalWeeks);

            // Create a temporary container for this page's content
            const pageContainer = document.createElement('div');
            pageContainer.style.width = '1200px';
            pageContainer.style.background = 'white';
            pageContainer.style.padding = '20px';
            pageContainer.style.fontFamily = 'Arial, sans-serif';
            pageContainer.style.position = 'absolute';
            pageContainer.style.left = '-9999px';
            pageContainer.style.top = '0';

            // Add header only on first page
            if (pageIndex === 0) {
                // Same reasoning as the exercise rows below: the static chrome is
                // written as markup, but program.name / program.description come from
                // Firestore and go in via textContent.
                const header = document.createElement('div');
                header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;';

                const headerText = document.createElement('div');
                const headerTitle = document.createElement('h1');
                headerTitle.style.cssText = 'font-size: 18px; margin: 0; font-weight: bold; color: #008080;';
                headerTitle.textContent = program.name;
                const headerDesc = document.createElement('p');
                headerDesc.style.cssText = 'font-size: 11px; margin: 4px 0 0 0; color: #666; max-width: 600px;';
                headerDesc.textContent = program.description ?? '';
                headerText.append(headerTitle, headerDesc);

                const headerBrand = document.createElement('div');
                headerBrand.style.cssText = 'display: flex; align-items: center; gap: 8px;';
                headerBrand.innerHTML =
                    '<img src="/icon-logo.png" style="width: 24px; height: 24px;" />' +
                    '<div style="font-size: 14px; font-weight: bold; white-space: nowrap;">HYBRIDX.CLUB</div>';

                header.append(headerText, headerBrand);
                pageContainer.appendChild(header);
            }

            // Add weeks for this page
            for (let weekIndex = startWeek; weekIndex < endWeek; weekIndex++) {
                const weekDiv = document.createElement('div');
                weekDiv.style.marginBottom = '10px';
                
                const weekHeader = document.createElement('h2');
                weekHeader.textContent = `Week ${weekIndex + 1}`;
                weekHeader.style.fontSize = '14px';
                weekHeader.style.margin = '0 0 8px 0';
                weekHeader.style.fontWeight = 'bold';
                weekDiv.appendChild(weekHeader);

                const gridDiv = document.createElement('div');
                gridDiv.style.display = 'grid';
                gridDiv.style.gridTemplateColumns = 'repeat(7, 1fr)';
                gridDiv.style.gap = '2px';

                for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
                    const currentDay = weekIndex * 7 + dayIndex + 1;
                    const daySessions = currentDay <= maxDay ? (workoutsByDay.get(currentDay) ?? null) : null;

                    const dayCell = document.createElement('div');
                    dayCell.style.cssText = `
                        border: 1px solid #ccc;
                        padding: 6px;
                        min-height: 90px;
                        background: #fff;
                        font-size: 8px;
                        display: flex;
                        flex-direction: column;
                        border-radius: 4px;
                    `;

                    const dayNumber = document.createElement('div');
                    dayNumber.textContent = (currentDay).toString();
                    dayNumber.style.cssText = `
                        background: #FAFAD2;
                        color: #555;
                        border-radius: 4px;
                        padding: 2px 4px;
                        font-size: 8px;
                        font-weight: 500;
                        margin-bottom: 4px;
                        align-self: flex-end;
                    `;
                    dayCell.appendChild(dayNumber);

                    if (daySessions) {
                        const isRestDay = daySessions.length === 1 && (
                            daySessions[0].title.toLowerCase().includes('rest') ||
                            daySessions[0].title.toLowerCase().includes('recovery')
                        );

                        if (isRestDay) {
                            const restText = document.createElement('div');
                            restText.textContent = daySessions[0].title;
                            restText.style.cssText = `
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                flex-grow: 1;
                                font-size: 9px;
                                font-weight: 500;
                                color: #a1a1aa;
                                text-align: center;
                            `;
                            dayCell.appendChild(restText);
                        } else {
                            daySessions.forEach((workout, si) => {
                                if (si > 0) {
                                    const divider = document.createElement('div');
                                    divider.style.cssText = `border-top: 1px solid #e4e4e7; margin: 4px 0;`;
                                    dayCell.appendChild(divider);
                                }
                                const workoutTitle = document.createElement('div');
                                workoutTitle.textContent = workout.title;
                                workoutTitle.style.cssText = `
                                    font-size: 9px;
                                    font-weight: bold;
                                    margin-bottom: 4px;
                                    color: #008080;
                                `;
                                dayCell.appendChild(workoutTitle);

                                const exerciseList = document.createElement('ul');
                                exerciseList.style.cssText = `
                                    margin: 0;
                                    padding: 0;
                                    list-style-position: inside;
                                `;
                                // Built as nodes with textContent, not innerHTML. This element is
                                // attached to the live document for html2canvas to capture it, so
                                // markup in a program's exercise text (CSV import, AI adjustment)
                                // would execute in the viewer's session.
                                const appendListItem = (label: string, labelColour: string, rest: string) => {
                                    const item = document.createElement('li');
                                    item.style.cssText = `font-size: 8px; line-height: 1.3; margin-bottom: 2px; color: #52525b;`;
                                    const strong = document.createElement('strong');
                                    strong.style.color = labelColour;
                                    strong.textContent = `${label}:`;
                                    item.append(strong, document.createTextNode(` ${rest}`));
                                    exerciseList.appendChild(item);
                                };
                                (hasRuns(workout) ? workout.runs : []).forEach(run => {
                                    appendListItem(String(run.type), '#2563eb', `${run.distance}km`);
                                });
                                (workout.exercises ?? []).forEach(exercise => {
                                    appendListItem(String(exercise.name), '#18181b', String(exercise.details ?? ''));
                                });
                                dayCell.appendChild(exerciseList);
                            });
                        }
                    }
                    gridDiv.appendChild(dayCell);
                }
                weekDiv.appendChild(gridDiv);
                pageContainer.appendChild(weekDiv);
            }

            document.body.appendChild(pageContainer);

            // Generate canvas for this page
            const canvas = await html2canvas(pageContainer, {
                scale: 1.5,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
            });

            document.body.removeChild(pageContainer);

            const imgData = canvas.toDataURL('image/png', 0.95);
            const imgHeight = (canvas.height * contentWidth) / canvas.width;
            const pageContentHeight = pageHeight - margin * 2;


            pdf.addImage(imgData, 'PNG', margin, margin, contentWidth, imgHeight > pageContentHeight ? pageContentHeight : imgHeight);
        }

        const fileName = `${program.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_training_calendar.pdf`;
        pdf.save(fileName);
        
        toast({ title: 'PDF Downloaded!', description: `Your ${totalPages}-page training calendar has been saved.` });
    } catch (error) {
        console.error('PDF generation failed:', error);
        toast({ 
            title: 'Error', 
            description: 'Failed to generate PDF. Please try again.',
            variant: 'destructive' 
        });
    } finally {
        setIsDownloading(false);
    }
};
  
  const handleScheduleProgram = async (programId: string, startDate: Date) => {
    if (!user || !program) {
        toast({ title: 'Error', description: 'You must be logged in to schedule a program.', variant: 'destructive' });
        return;
    }

    setIsScheduling(true);
    try {
        const updateData: Partial<User> = { programId, startDate, customProgram: null };
        // Fit the plan to the days a week they train, week by week.
        const fitted = fitToSchedule(program.workouts, user.frequency);
        if (fitted) updateData.customProgram = fitted;

        await updateUser(user.id, updateData);

        // Clear any leftover per-day session docs from a previously assigned program (including
        // drag-and-drop "cleared" markers) so they don't keep shadowing this newly scheduled
        // program's workouts on the same calendar dates. Best-effort: a failure here shouldn't
        // block the program from being scheduled.
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        try {
            await clearFutureProgramSessions({ fromDate: today });
        } catch (err) {
            // Not fatal — the program itself is already scheduled — but it is not
            // cosmetic either: leftover docs shadow the new plan's workouts, so the
            // calendar can look empty. Say so rather than failing silently, which is
            // what made this hard to diagnose.
            logger.error('Failed to clear stale program sessions:', err);
            toast({
                title: 'Program scheduled, but the calendar may be stale',
                description: 'Some entries from your previous plan could not be cleared. Reschedule the program if days look empty.',
                variant: 'destructive',
            });
        }

        // Refresh the UserContext to update Today's Workout on dashboard/workout pages
        await refreshData();

        // If Garmin is connected, push the new plan immediately (fire-and-forget).
        if (user.garminConnectedAt) {
            // keepalive: the redirect below tears down this page, and a
            // cancelled sync request used to leave the pushed workouts
            // unrecorded — which is what made the next sync duplicate them.
            fetch('/api/garmin/sync-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true })
                .catch(() => {});
        }

        toast({
            title: 'Program Scheduled!',
            description: 'Your new training program has been added to your calendar.',
        });
        setIsScheduleDialogOpen(false);
        router.push('/dashboard');
    } catch (error) {
        console.error('Failed to schedule program:', error);
        toast({
            title: 'Error',
            description: 'Could not schedule the program. Please try again.',
            variant: 'destructive',
        });
    } finally {
        setIsScheduling(false);
    }
  };
  
  const isCurrentProgram = user?.programId === program?.id;

  if (loading) {
    return <Skeleton className="w-full h-[80vh]" />;
  }

  if (!program) {
    return null; // Should be redirected by useEffect
  }
  
  // CHANGED: Enable pace rendering if program has runs, regardless of programType tag
  const programHasRuns = program.workouts.some(w => hasRuns(w));

  return (
    <>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <Button variant="outline" asChild>
            <Link href="/programs">
                <ArrowLeft className="mr-2" />
                Back to Programs
            </Link>
        </Button>
        <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="accent" onClick={() => setIsScheduleDialogOpen(true)} className="w-full" disabled={isScheduling}>
                <CalendarPlus className="mr-2" />
                {isCurrentProgram ? 'Reschedule Program' : 'Schedule Program'}
            </Button>
            <Button variant="outline" onClick={handleDownloadPDF} className="w-full" disabled={isDownloading}>
                {isDownloading ? <Loader2 className="mr-2 animate-spin" /> : <Printer className="mr-2" />}
                {isDownloading ? 'Generating...' : 'Download PDF'}
            </Button>
        </div>
      </div>
      
      <Card>
          <CardHeader>
              <CardTitle>{program.name}</CardTitle>
              <CardDescription>{program.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {programHasRuns && !trainingPaces && (
                 <div className="mb-4 p-4 border border-yellow-400 bg-yellow-50 rounded-md text-yellow-800 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 mt-0.5" />
                    <div>
                        <h4 className="font-semibold">Paces Not Calculated</h4>
                        <p className="text-sm">To see your personalized training paces for this program, please add at least one benchmark race time to your profile.</p>
                        <Button variant="link" className="p-0 h-auto mt-1 text-sm text-yellow-800" asChild>
                           <Link href="/profile">Update Your Profile</Link>
                        </Button>
                    </div>
                </div>
            )}
              <Accordion type="single" collapsible className="w-full">
                  {program.workouts.map((workout: WorkoutDay) => (
                      <AccordionItem value={`day-${workout.day}`} key={workout.day}>
                          <AccordionTrigger>Day {workout.day}: {workout.title}</AccordionTrigger>
                          <AccordionContent className="space-y-4">
                            {/* Run segments */}
                            {hasRuns(workout) && (
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Running</p>
                                    <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                                        {workout.runs.map((run, index) => {
                                            const pace = trainingPaces ? formatPace(trainingPaces[run.paceZone]) : 'N/A';
                                            return (
                                                <li key={index}>
                                                    <span className="font-medium text-foreground">{run.description}</span>
                                                    <p className="text-sm">
                                                        Target Pace: <span className="font-semibold text-primary">{pace}</span> / km
                                                    </p>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            )}
                            {/* Strength / gym exercises */}
                            {hasExercises(workout) && (
                                <div>
                                    {hasRuns(workout) && (
                                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Exercises</p>
                                    )}
                                    <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                                        {workout.exercises.map((exercise, index) => (
                                            <li key={index}>
                                                <span className="font-medium text-foreground">{exercise.name}:</span> {exercise.details}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                          </AccordionContent>
                      </AccordionItem>
                  ))}
              </Accordion>
          </CardContent>
      </Card>
      
      {/* This component is now hidden from the user but used for PDF generation */}
      <div className="hidden print:block">
        <ProgramCalendarView program={program} />
      </div>

      <ProgramScheduleDialog
        program={program}
        isOpen={isScheduleDialogOpen}
        onClose={() => setIsScheduleDialogOpen(false)}
        onSchedule={handleScheduleProgram}
        isScheduling={isScheduling}
      />
    </>
  );
}
