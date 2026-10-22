'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Pause, Play, RotateCw, Plus, Minus, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useWakeLock } from '@/hooks/use-wake-lock';
import type { TimerMode, TimerRound, TimerRecord } from '@/models/types';

const generateTimeOptions = (): number[] => {
  const opts: number[] = [];
  for (let i = 15; i <= 240; i += 15) opts.push(i);
  for (let i = 270; i <= 600; i += 30) opts.push(i);
  for (let i = 660; i <= 3600; i += 60) opts.push(i);
  return opts;
};

const TIME_OPTIONS = generateTimeOptions();

const fmt = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};

const fmtShort = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const fmtOption = (seconds: number): string =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

interface WorkoutTimerProps {
  onComplete?: (record: TimerRecord) => void;
}

export function WorkoutTimer({ onComplete }: WorkoutTimerProps = {}) {
  const [timerMode, setTimerMode] = useState<TimerMode>('for-time');

  const [amrapDuration, setAmrapDuration] = useState(600);
  const [amrapRounds, setAmrapRounds] = useState(0);
  const [emomRounds, setEmomRounds] = useState(10);
  const [emomInterval, setEmomInterval] = useState(60);
  const [tabataWork, setTabataWork] = useState(20);
  const [tabataRest, setTabataRest] = useState(10);
  const [tabataRounds, setTabataRounds] = useState(8);

  const [time, setTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [currentSet, setCurrentSet] = useState(1);
  const [currentRound, setCurrentRound] = useState(1);
  const [workoutLog, setWorkoutLog] = useState<TimerRound[]>([]);
  const [lastSplitTime, setLastSplitTime] = useState(0);

  const [tabataPhase, setTabataPhase] = useState<'work' | 'rest'>('work');
  const [tabataCurrentRound, setTabataCurrentRound] = useState(1);
  const [emomTime, setEmomTime] = useState(emomInterval);

  const [repCount, setRepCount] = useState(0);
  const [repMode, setRepMode] = useState<'count-up' | 'count-down'>('count-up');
  const [targetReps, setTargetReps] = useState(10);
  const [currentRepSet, setCurrentRepSet] = useState(1);
  const [repLog, setRepLog] = useState<{ set: number; reps: number }[]>([]);

  const [summaryOpen, setSummaryOpen] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef(0);
  const elapsedTimeRef = useRef(0);
  const lastTickRef = useRef(0);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  useEffect(() => {
    audioRefs.current = {
      work: new Audio('/sounds/start.mp3'),
      rest: new Audio('/sounds/rest.mp3'),
      complete: new Audio('/sounds/compete.mp3'),
      countdown: new Audio('/sounds/countdown.mp3'),
    };
  }, []);

  const playSound = (key: string) => {
    const a = audioRefs.current[key];
    if (a) { a.currentTime = 0; a.play().catch(() => {}); }
  };

  const logSet = useCallback((onDone?: () => void) => {
    const elapsed = Math.round(elapsedTimeRef.current / 1000);
    const duration = elapsed - lastSplitTime;
    setWorkoutLog((prev) => {
      const log = JSON.parse(JSON.stringify(prev)) as TimerRound[];
      const idx = log.findIndex((r) => r.roundNumber === currentRound);
      if (idx > -1) {
        log[idx].sets.push({ setNumber: currentSet, duration });
        log[idx].totalDuration = elapsed - log[idx].startTime;
      }
      return log;
    });
    setLastSplitTime(elapsed);
    onDone?.();
  }, [lastSplitTime, currentSet, currentRound]);

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) { clearTimeout(countdownRef.current); countdownRef.current = null; }
    setCountdown(0);
  }, []);

  const resetState = useCallback(() => {
    setIsRunning(false);
    cancelCountdown();
    elapsedTimeRef.current = 0;
    setWorkoutLog([]);
    setLastSplitTime(0);
    setCurrentSet(1);
    setCurrentRound(1);
    setTabataCurrentRound(1);
    setTabataPhase('work');
    setTime(0);
    if (timerMode === 'emom') setEmomTime(emomInterval);
    if (timerMode === 'amrap') setAmrapRounds(0);
    setRepCount(repMode === 'count-up' ? 0 : targetReps);
    setCurrentRepSet(1);
    setRepLog([]);
  }, [timerMode, repMode, targetReps, emomInterval, cancelCountdown]);

  useEffect(() => { resetState(); }, [timerMode, resetState]);
  useEffect(() => { if (timerMode === 'emom') setEmomTime(emomInterval); }, [emomInterval, emomRounds, timerMode]);
  useEffect(() => { if (timerMode === 'reps') setRepCount(repMode === 'count-up' ? 0 : targetReps); }, [repMode, targetReps, timerMode]);

  const emomTotal = emomRounds * emomInterval;

  // Inline final-set logic so onComplete always receives the complete log
  const handleComplete = useCallback(() => {
    setIsRunning(false);
    playSound('complete');
    setSummaryOpen(true);

    let finalLog = workoutLog;
    if (timerMode === 'for-time') {
      const elapsed = Math.round(elapsedTimeRef.current / 1000);
      const duration = elapsed - lastSplitTime;
      const newLog = JSON.parse(JSON.stringify(workoutLog)) as TimerRound[];
      const idx = newLog.findIndex((r) => r.roundNumber === currentRound);
      if (idx > -1) {
        newLog[idx].sets.push({ setNumber: currentSet, duration });
        newLog[idx].totalDuration = elapsed - newLog[idx].startTime;
      }
      finalLog = newLog;
      setWorkoutLog(newLog);
      setLastSplitTime(elapsed);
    }

    onComplete?.({
      timerMode,
      totalTime: Math.round(elapsedTimeRef.current / 1000),
      completedAt: new Date().toISOString(),
      workoutLog: timerMode === 'for-time' ? finalLog : undefined,
      amrapRounds: timerMode === 'amrap' ? amrapRounds : undefined,
      repLog: timerMode === 'reps' ? repLog : undefined,
    });
  }, [timerMode, workoutLog, lastSplitTime, currentRound, currentSet, amrapRounds, repLog, onComplete]);

  useEffect(() => {
    if (!isRunning) { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      elapsedTimeRef.current = now - startTimeRef.current;
      const elapsed = Math.floor(elapsedTimeRef.current / 1000);
      const lastElapsed = Math.floor((lastTickRef.current - startTimeRef.current) / 1000);
      if (elapsed > lastElapsed) {
        switch (timerMode) {
          case 'for-time': setTime(elapsed); break;
          case 'amrap': {
            const rem = amrapDuration - elapsed;
            setTime(rem);
            if (rem <= 0) { setTime(0); handleComplete(); }
            else if (rem === 3) playSound('countdown');
            break;
          }
          case 'emom': {
            const newEmomTime = emomInterval - (elapsed % emomInterval);
            if (newEmomTime !== emomTime) {
              setEmomTime(newEmomTime);
              if (newEmomTime === 3) playSound('countdown');
            }
            if (emomTotal > 0 && elapsed >= emomTotal) { setEmomTime(0); handleComplete(); }
            break;
          }
          case 'tabata': {
            const cycle = tabataWork + tabataRest;
            const inCycle = elapsed % cycle;
            const roundNum = Math.floor(elapsed / cycle) + 1;
            if (roundNum > tabataRounds) { handleComplete(); break; }
            if (roundNum !== tabataCurrentRound) setTabataCurrentRound(roundNum);
            if (inCycle < tabataWork) {
              if (tabataPhase !== 'work') setTabataPhase('work');
              setTime(tabataWork - inCycle);
            } else {
              const restRem = cycle - inCycle;
              if (tabataPhase !== 'rest') { setTabataPhase('rest'); playSound('rest'); }
              setTime(restRem);
              if (restRem === 3) playSound('countdown');
            }
            break;
          }
        }
      }
      lastTickRef.current = now;
    }, 50);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning, timerMode, amrapDuration, emomInterval, emomRounds, emomTotal,
      tabataWork, tabataRest, tabataRounds, handleComplete, emomTime, tabataPhase, tabataCurrentRound]);

  const handleStartStop = useCallback(() => {
    if (countdown > 0) { cancelCountdown(); return; }
    if (isRunning) { elapsedTimeRef.current = Date.now() - startTimeRef.current; setIsRunning(false); return; }
    const doStart = () => {
      setCountdown(0); setIsRunning(true);
      startTimeRef.current = Date.now() - elapsedTimeRef.current;
      lastTickRef.current = Date.now();
      if (elapsedTimeRef.current === 0 && timerMode === 'for-time') {
        setWorkoutLog([{ roundNumber: 1, sets: [], startTime: 0, totalDuration: 0 }]);
      }
    };
    if (elapsedTimeRef.current === 0) {
      playSound('countdown');
      const sequence = (n: number) => {
        if (n > 0) { setCountdown(n); countdownRef.current = setTimeout(() => sequence(n - 1), 1000); }
        else doStart();
      };
      sequence(3);
    } else { doStart(); }
  }, [isRunning, countdown, timerMode, cancelCountdown]);

  const handleNextSet = useCallback(() => {
    if (!isRunning) return;
    logSet(() => setCurrentSet((s) => s + 1));
  }, [isRunning, logSet]);

  const handleNextRound = useCallback(() => {
    if (!isRunning) return;
    const elapsed = Math.round(elapsedTimeRef.current / 1000);
    logSet(() => {
      const next = currentRound + 1;
      setCurrentRound(next); setCurrentSet(1); setLastSplitTime(elapsed);
      setWorkoutLog((prev) => [...prev, { roundNumber: next, sets: [], startTime: elapsed, totalDuration: 0 }]);
    });
  }, [currentRound, isRunning, logSet]);

  const handleAmrapRound = () => { if (isRunning) setAmrapRounds((r) => r + 1); };
  const handleRepCounter = (dir: 'up' | 'down') => setRepCount((c) => dir === 'up' ? c + 1 : Math.max(0, c - 1));
  const handleNextRepSet = () => {
    setRepLog((prev) => [...prev, { set: currentRepSet, reps: repCount }]);
    setCurrentRepSet((s) => s + 1);
    setRepCount(repMode === 'count-up' ? 0 : targetReps);
  };

  const isCountingDown = countdown > 0;
  // Keep the phone awake from the 3-2-1 until the timer is paused or finished.
  useWakeLock(isRunning || isCountingDown);
  const hasData = time > 0 || (timerMode === 'amrap' && amrapRounds > 0);
  const nonEmptyRounds = workoutLog.filter((r) => r.sets.length > 0);

  const renderDisplay = () => {
    if (isCountingDown) return <p className="text-8xl font-bold tabular-nums text-primary">{countdown}</p>;
    if (timerMode === 'amrap') return <p className="text-6xl font-bold tabular-nums">{fmt(time)}</p>;
    if (timerMode === 'tabata') return (
      <div className="text-center space-y-1">
        <p className={`text-3xl font-bold uppercase tracking-widest ${tabataPhase === 'work' ? 'text-red-500' : 'text-green-500'}`}>{tabataPhase}</p>
        <p className="text-6xl font-bold tabular-nums">{fmtShort(time)}</p>
        <p className="text-lg text-muted-foreground">Round {tabataCurrentRound} / {tabataRounds}</p>
      </div>
    );
    if (timerMode === 'emom') {
      const elapsed = Math.floor(elapsedTimeRef.current / 1000);
      const roundNum = Math.min(Math.max(1, Math.floor(elapsed / emomInterval) + 1), emomRounds);
      return (
        <div className="text-center space-y-1">
          <p className="text-6xl font-bold tabular-nums">{fmtShort(emomTime)}</p>
          <p className="text-lg text-muted-foreground">Round {roundNum} / {emomRounds}</p>
        </div>
      );
    }
    return <p className="text-6xl font-bold tabular-nums">{fmt(time)}</p>;
  };

  return (
    <div className="space-y-3">
      <Tabs value={timerMode} onValueChange={(v) => setTimerMode(v as TimerMode)}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="for-time" className="text-xs px-1">For Time</TabsTrigger>
          <TabsTrigger value="amrap" className="text-xs px-1">AMRAP</TabsTrigger>
          <TabsTrigger value="emom" className="text-xs px-1">EMOM</TabsTrigger>
          <TabsTrigger value="tabata" className="text-xs px-1">Tabata</TabsTrigger>
          <TabsTrigger value="reps" className="text-xs px-1">Reps</TabsTrigger>
        </TabsList>
        <TabsContent value="for-time" />
        <TabsContent value="amrap">
          <Card><CardContent className="p-3 space-y-2">
            <Label className="text-xs text-muted-foreground">Duration</Label>
            <Select value={amrapDuration.toString()} onValueChange={(v) => setAmrapDuration(parseInt(v))} disabled={isRunning || isCountingDown}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{TIME_OPTIONS.map((o) => <SelectItem key={o} value={o.toString()}>{fmtOption(o)}</SelectItem>)}</SelectContent>
            </Select>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="emom">
          <Card><CardContent className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Rounds</Label>
                <Input type="number" value={emomRounds || ''} onChange={(e) => setEmomRounds(parseInt(e.target.value) || 0)} onFocus={(e) => e.target.select()} disabled={isRunning || isCountingDown} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Interval</Label>
                <Select value={emomInterval.toString()} onValueChange={(v) => setEmomInterval(parseInt(v))} disabled={isRunning || isCountingDown}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIME_OPTIONS.map((o) => <SelectItem key={o} value={o.toString()}>{fmtOption(o)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-center text-muted-foreground">Total: {fmt(emomRounds * emomInterval)}</p>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="tabata">
          <Card><CardContent className="p-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'tw', label: 'Work (s)', val: tabataWork, set: setTabataWork },
                { id: 'tr', label: 'Rest (s)', val: tabataRest, set: setTabataRest },
                { id: 'tn', label: 'Rounds', val: tabataRounds, set: setTabataRounds },
              ].map(({ id, label, val, set }) => (
                <div key={id} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <Input type="number" value={val || ''} onChange={(e) => set(parseInt(e.target.value) || 0)} onFocus={(e) => e.target.select()} disabled={isRunning || isCountingDown} className="h-9" />
                </div>
              ))}
            </div>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="reps">
          <div className="space-y-3">
            <Card><CardContent className="p-3 space-y-3">
              <RadioGroup value={repMode} onValueChange={(v) => setRepMode(v as 'count-up' | 'count-down')} className="flex justify-around">
                <div className="flex items-center gap-2"><RadioGroupItem value="count-up" id="rep-up" /><Label htmlFor="rep-up" className="text-sm">Count Up</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="count-down" id="rep-dn" /><Label htmlFor="rep-dn" className="text-sm">Count Down</Label></div>
              </RadioGroup>
              {repMode === 'count-down' && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Target Reps</Label>
                  <Input type="number" value={targetReps || ''} onChange={(e) => setTargetReps(parseInt(e.target.value) || 0)} onFocus={(e) => e.target.select()} className="h-9" />
                </div>
              )}
            </CardContent></Card>
            <Card>
              <CardHeader className="pb-1 pt-3"><CardTitle className="text-center text-sm text-muted-foreground">Set {currentRepSet}</CardTitle></CardHeader>
              <CardContent className="text-center py-2"><p className="text-8xl font-bold tabular-nums">{repCount}</p></CardContent>
              <CardFooter className="grid grid-cols-2 gap-3 pb-3">
                <Button size="lg" variant="outline" onClick={() => handleRepCounter('down')} className="h-14"><Minus /></Button>
                <Button size="lg" variant="outline" onClick={() => handleRepCounter('up')} className="h-14"><Plus /></Button>
              </CardFooter>
            </Card>
            <Button onClick={handleNextRepSet} className="w-full h-11 font-semibold">Next Set</Button>
            {repLog.length > 0 && (
              <Card><CardContent className="p-3">
                <ul className="space-y-1">
                  {repLog.map((item) => (
                    <li key={item.set} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Set {item.set}</span>
                      <span className="font-semibold">{item.reps} reps</span>
                    </li>
                  ))}
                </ul>
              </CardContent></Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {timerMode !== 'reps' && (
        <>
          <Card className="border-accent/40">
            <CardContent className="flex flex-col items-center justify-center py-6 min-h-[140px]">{renderDisplay()}</CardContent>
            <CardFooter className="grid grid-cols-2 gap-3 pb-4">
              <Button size="lg" variant={isRunning || isCountingDown ? 'destructive' : 'default'} onClick={handleStartStop} className="flex items-center gap-2 h-11">
                {isRunning ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                {isCountingDown ? 'Cancel' : isRunning ? 'Pause' : 'Start'}
              </Button>
              <Button size="lg" variant="outline" onClick={resetState} className="flex items-center gap-2 h-11">
                <RotateCw className="h-5 w-5" />Reset
              </Button>
            </CardFooter>
          </Card>
          {timerMode === 'for-time' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Card><CardContent className="py-3 text-center"><p className="text-xs text-muted-foreground">Round</p><p className="text-5xl font-bold tabular-nums">{currentRound}</p></CardContent></Card>
                <Card><CardContent className="py-3 text-center"><p className="text-xs text-muted-foreground">Set</p><p className="text-5xl font-bold tabular-nums">{currentSet}</p></CardContent></Card>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button size="lg" onClick={handleNextSet} disabled={!isRunning} className="h-11 font-semibold">Next Set</Button>
                <Button size="lg" onClick={handleNextRound} disabled={!isRunning} className="h-11 font-semibold">Next Round</Button>
              </div>
            </>
          )}
          {timerMode === 'amrap' && (
            <>
              <Card><CardContent className="py-3 text-center"><p className="text-xs text-muted-foreground">Rounds Completed</p><p className="text-5xl font-bold tabular-nums">{amrapRounds}</p></CardContent></Card>
              <Button size="lg" onClick={handleAmrapRound} disabled={!isRunning} className="w-full h-11 font-semibold flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />Log Round
              </Button>
            </>
          )}
          <Button variant="outline" className="w-full" disabled={!hasData} onClick={handleComplete}>Complete &amp; View Summary</Button>
        </>
      )}

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Workout Summary</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="text-center rounded-lg bg-muted p-4">
              <p className="text-sm text-muted-foreground">Total Time</p>
              <p className="text-4xl font-bold text-primary">{fmt(time)}</p>
            </div>
            {timerMode === 'amrap' && (
              <div className="text-center rounded-lg bg-muted p-4">
                <p className="text-sm text-muted-foreground">Rounds Completed</p>
                <p className="text-4xl font-bold text-primary">{amrapRounds}</p>
              </div>
            )}
            {timerMode === 'for-time' && nonEmptyRounds.length > 0 && (
              <ScrollArea className="h-48">
                <div className="space-y-4 pr-4">
                  {nonEmptyRounds.map((round) => (
                    <div key={round.roundNumber}>
                      <p className="font-semibold text-sm mb-1">Round {round.roundNumber} — {fmt(round.totalDuration)}</p>
                      <Table>
                        <TableHeader><TableRow><TableHead>Set</TableHead><TableHead>Duration</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {round.sets.map((s, i) => (
                            <TableRow key={`${round.roundNumber}-${s.setNumber}-${i}`}>
                              <TableCell className="font-medium">{s.setNumber}</TableCell>
                              <TableCell>{fmt(s.duration)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSummaryOpen(false)}>Close</Button>
            <Button onClick={() => { resetState(); setSummaryOpen(false); }}>Start New</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
