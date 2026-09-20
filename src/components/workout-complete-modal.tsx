// src/components/workout-complete-modal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { StravaUploadButton } from '@/components/strava-upload-button';
import { ShareWorkoutDialog } from '@/components/share-workout-dialog';
import type { WorkoutSession, Workout, RunningWorkout } from '@/models/types';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { differenceInMinutes } from 'date-fns';

interface WorkoutCompleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    session: WorkoutSession;
    userHasStrava?: boolean;
    workout: Workout | RunningWorkout;
}

export default function WorkoutCompleteModal({ isOpen, onClose, session, userHasStrava }: WorkoutCompleteModalProps) {
    // `workout` is part of the public props (workout/active/page.tsx passes it)
    // but unused here — session.workoutTitle already covers what this modal shows.
    const [duration, setDuration] = useState('');

    useEffect(() => {
        if (isOpen) {
            let initialDuration = '';
            if (session.stravaActivity?.moving_time) {
                const minutes = Math.floor(session.stravaActivity.moving_time / 60);
                initialDuration = `${minutes} mins`;
            } else if (session.duration) {
                initialDuration = session.duration;
            } else if (session.finishedAt) {
                const minutes = differenceInMinutes(session.finishedAt, session.startedAt);
                initialDuration = `${minutes} mins`;
            }
            setDuration(initialDuration);
        }
    }, [isOpen, session]);
    
    // Don't show the manual duration input if the activity was linked from Strava
    const showDurationInput = !session.stravaActivity?.moving_time;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Workout Complete! 🎉</DialogTitle>
                    <DialogDescription>
                        Great job finishing your workout. Here's your summary and sharing options.
                    </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                    <div className="text-center p-4 bg-muted/50 rounded-lg">
                        <h3 className="font-semibold text-lg">{session.workoutTitle}</h3>
                        <p className="text-sm text-muted-foreground">Workout logged successfully.</p>
                    </div>

                    <div className="space-y-3">
                         <Separator />
                         <p className="text-sm font-medium text-center">
                            Share your achievement
                         </p>
                        
                        {showDurationInput && (
                            <div className="space-y-2">
                                <Label htmlFor="duration-input">Duration (Optional)</Label>
                                <Input
                                    id="duration-input"
                                    value={duration}
                                    onChange={(e) => setDuration(e.target.value)}
                                    placeholder="e.g., 45 mins"
                                />
                            </div>
                        )}
                        
                        {userHasStrava && (
                            <StravaUploadButton
                                sessionId={session.id}
                                activityName={session.workoutTitle}
                                isUploaded={session.uploadedToStrava}
                                stravaId={session.stravaId}
                                disabled={session.skipped}
                            />
                        )}

                        <ShareWorkoutDialog
                            session={session}
                            trigger={
                                <Button variant="outline" className="w-full">
                                    Share Workout Image
                                </Button>
                            }
                        />
                    </div>

                    <Button onClick={onClose} className="w-full" variant="outline">
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
