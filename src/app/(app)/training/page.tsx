'use client';
// src/app/(app)/training/page.tsx
// Merged Training Load + Training Form page.
// Data source: /api/strava/training-form (TrainingFormSummary ⊇ TrainingSummary)

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Activity,
  Brain,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  Footprints,
  Bike,
  Waves,
  Dumbbell,
  PersonStanding,
  Gauge,
  Heart,
  Zap,
  Info,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
} from 'recharts';
import { cn } from '@/lib/utils';
import { getAuthInstance } from '@/lib/firebase';
import { analyzeTrainingLoad } from '@/ai/flows/training-load-analysis';
import type { TrainingLoadAnalysisOutput } from '@/ai/flows/training-load-analysis';
import type { TrainingFormSummary, PMCDataPoint, ActivityCategory } from '@/services/training-load-service';
import { formatTrainingSummaryForAI } from '@/services/training-load-service';
import { useUser } from '@/contexts/user-context';
import { format, parseISO } from 'date-fns';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  run:      'hsl(var(--primary))',
  ride:     'hsl(220 70% 55%)',
  swim:     'hsl(200 80% 50%)',
  strength: 'hsl(280 60% 55%)',
  walk:     'hsl(150 60% 45%)',
  rowing:   'hsl(30 80% 55%)',
  other:    'hsl(var(--muted-foreground))',
};

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  run:      'Running',
  ride:     'Cycling',
  swim:     'Swimming',
  strength: 'Strength',
  walk:     'Walking / Hiking',
  rowing:   'Rowing',
  other:    'Other',
};

const FORM_ZONES = [
  { label: 'Overreaching', range: 'TSB < -40', color: 'bg-red-500',     desc: 'High injury risk — rest immediately' },
  { label: 'Fatigued',     range: '-40 to -25', color: 'bg-orange-500',  desc: 'Accumulated fatigue — reduce load' },
  { label: 'Building',     range: '-25 to -10', color: 'bg-yellow-500',  desc: 'Productive stress — monitor recovery' },
  { label: 'Optimal',      range: '-10 to +5',  color: 'bg-emerald-500', desc: 'Peak performance zone' },
  { label: 'Fresh',        range: '+5 to +25',  color: 'bg-green-500',   desc: 'Well recovered — ready to push' },
  { label: 'Very Fresh',   range: 'TSB > +25',  color: 'bg-blue-500',    desc: 'Possible detraining if extended' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fatigueColor(status: string) {
  switch (status) {
    case 'very_fresh':   return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'fresh':        return 'bg-green-100 text-green-800 border-green-200';
    case 'optimal':      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'building':     return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'fatigued':     return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'overreaching': return 'bg-red-100 text-red-800 border-red-200';
    default:             return 'bg-muted text-muted-foreground';
  }
}

function fatigueDescription(status: string): string {
  switch (status) {
    case 'very_fresh':   return "You're well-rested. A great time to push hard or start a new training block.";
    case 'fresh':        return "Your body has recovered well. You're ready for quality training.";
    case 'optimal':      return "You're in the sweet spot — fit enough to train hard, not worn down.";
    case 'building':     return "You're working hard and accumulating fitness. Keep recovery sessions easy.";
    case 'fatigued':     return "Your body is carrying real fatigue. Prioritise sleep and easy sessions.";
    case 'overreaching': return "You need rest. Consider 1–2 full recovery days before training hard again.";
    default:             return '';
  }
}

function formatMinutes(mins: number): string {
  if (mins === 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function TsbTrendIcon({ tsb, prev }: { tsb: number; prev?: number }) {
  if (prev !== undefined) {
    const delta = tsb - prev;
    if (delta > 2)  return <ArrowUpRight className="h-3.5 w-3.5 text-green-600" />;
    if (delta < -2) return <ArrowDownRight className="h-3.5 w-3.5 text-orange-600" />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  if (tsb > 5)   return <TrendingUp className="h-4 w-4 text-green-600" />;
  if (tsb < -10) return <TrendingDown className="h-4 w-4 text-orange-600" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function CategoryIcon({ category, className }: { category: ActivityCategory; className?: string }) {
  const cls = cn('h-4 w-4', className);
  switch (category) {
    case 'run':      return <Footprints className={cls} />;
    case 'ride':     return <Bike className={cls} />;
    case 'swim':     return <Waves className={cls} />;
    case 'strength': return <Dumbbell className={cls} />;
    case 'walk':     return <PersonStanding className={cls} />;
    default:         return <Activity className={cls} />;
  }
}

// ── Chart types ───────────────────────────────────────────────────────────────

// Projected days carry no actual values (null), so the solid lines end at today
// instead of dropping to zero across the projection window.
interface ChartPoint extends Omit<PMCDataPoint, 'load' | 'atl' | 'ctl' | 'tsb'> {
  load: number | null;
  atl: number | null;
  ctl: number | null;
  tsb: number | null;
  ctlProj: number | null;
  atlProj: number | null;
  tsbProj: number | null;
  isProjected: boolean;
}

// ── Custom tooltips ───────────────────────────────────────────────────────────

function PMCTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ChartPoint | undefined;
  if (!d) return null;
  const ctl  = d.isProjected ? d.ctlProj  : d.ctl;
  const atl  = d.isProjected ? d.atlProj  : d.atl;
  const tsb  = d.isProjected ? d.tsbProj  : d.tsb;
  const load = d.isProjected ? null       : d.load;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-xl text-xs space-y-1 min-w-[160px]">
      <div className="flex items-center gap-2">
        <p className="font-medium">{format(parseISO(d.date), 'MMM d, yyyy')}</p>
        {d.isProjected && <span className="text-[10px] text-muted-foreground border rounded px-1">projected</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {load != null && load > 0 && (<><span className="text-muted-foreground">Load</span><span className="font-mono font-medium text-right">{load}</span></>)}
        {ctl  != null && (<><span className="text-muted-foreground">Fitness (CTL)</span><span className="font-mono font-medium text-right text-blue-500">{ctl}</span></>)}
        {atl  != null && (<><span className="text-muted-foreground">Fatigue (ATL)</span><span className="font-mono font-medium text-right text-rose-500">{atl}</span></>)}
        {tsb  != null && (
          <>
            <span className="text-muted-foreground">Form (TSB)</span>
            <span className={cn('font-mono font-medium text-right', (tsb ?? 0) > 5 ? 'text-green-500' : (tsb ?? 0) < -10 ? 'text-orange-500' : 'text-muted-foreground')}>
              {(tsb ?? 0) > 0 ? '+' : ''}{tsb}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function LoadTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-xl text-xs space-y-1">
      <p className="font-medium">{d.weekLabel}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono font-medium text-right">{d.totalMinutes} min</span>
        {Object.entries(d.byCategory || {}).map(([cat, mins]) => (
          <div key={cat} className="contents">
            <span className="text-muted-foreground">{CATEGORY_LABELS[cat as ActivityCategory] || cat}</span>
            <span className="font-mono font-medium text-right">{mins as number} min</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Metric Card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, sublabel, icon: Icon, color, trend }: {
  label: string; value: string | number; sublabel: string;
  icon: React.ElementType; color: string; trend?: React.ReactNode;
}) {
  return (
    <div className="bg-muted/40 rounded-xl p-4 space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
        <Icon className={cn('h-4 w-4', color)} />
      </div>
      <div className="flex items-center gap-2">
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {trend}
      </div>
      <p className="text-[11px] text-muted-foreground">{sublabel}</p>
    </div>
  );
}

// ── Page skeleton ─────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const { user } = useUser();
  const [data, setData] = useState<TrainingFormSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // AI analysis
  const [aiAnalysis, setAiAnalysis] = useState<TrainingLoadAnalysisOutput | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // "What do these numbers mean?" collapsible
  const [explainerOpen, setExplainerOpen] = useState(false);

  // PMC time range
  const [timeRange, setTimeRange] = useState<30 | 60 | 90>(60);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const auth = await getAuthInstance();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');

      const idToken = await currentUser.getIdToken(true);
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        credentials: 'include',
      });

      const res = await fetch('/api/strava/training-form', {
        credentials: 'include',
        cache: 'no-cache',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code) setErrorCode(body.code);
        throw new Error(body.error || 'Failed to load training data');
      }

      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleGenerateAnalysis = async () => {
    if (!data) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await analyzeTrainingLoad({
        userName: user?.firstName ?? 'Athlete',
        userGoal: user?.goal ?? 'hybrid',
        trainingSummaryText: formatTrainingSummaryForAI(data),
      });
      setAiAnalysis(result);
    } catch (err) {
      setAiError('Analysis failed. Please try again.');
    } finally {
      setAiLoading(false);
    }
  };

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>
      <PageSkeleton />
    </div>
  );

  if (error || !data || data.activitiesAnalysed === 0) {
    const needsReconnect = errorCode === 'STRAVA_REAUTH' || errorCode === 'STRAVA_SCOPE_MISSING';
    const heading = needsReconnect
      ? 'Strava needs reconnecting'
      : errorCode === 'STRAVA_RATE_LIMITED'
        ? 'Strava is busy right now'
        : errorCode === 'STRAVA_UNAVAILABLE'
          ? "Couldn't reach Strava"
          : error
            ? "Couldn't load your training data"
            : 'No training data available';

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center space-y-3">
          {needsReconnect ? <AlertTriangle className="h-10 w-10 text-orange-500/60" /> : <Activity className="h-10 w-10 text-muted-foreground/40" />}
          <p className="font-semibold">{heading}</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            {error ?? 'Connect Strava and log some activities to see your training report.'}
          </p>
          <div className="flex items-center gap-2">
            {needsReconnect && (
              <Link href="/profile">
                <Button size="sm">Reconnect Strava</Button>
              </Link>
            )}
            <Button variant="outline" size="sm" onClick={fetchData}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const { loadMetrics, weeklyBreakdown, activityTypeSummary, activitiesAnalysed, dailyPMC } = data;

  const pmcData = dailyPMC.slice(-timeRange);
  const current  = pmcData.at(-1) ?? null;
  const previous = pmcData.length > 1 ? pmcData.at(-2) : null;
  const weekAgo  = pmcData.length > 7 ? pmcData.at(-8) : null;
  const ctlDelta = weekAgo ? Math.round((current!.ctl - weekAgo.ctl) * 10) / 10 : 0;

  const todayStr = new Date().toISOString().slice(0, 10);

  const historicalChart: ChartPoint[] = pmcData.map((p, i) => ({
    ...p,
    ctlProj: i === pmcData.length - 1 ? p.ctl : null,
    atlProj: i === pmcData.length - 1 ? p.atl : null,
    tsbProj: i === pmcData.length - 1 ? p.tsb : null,
    isProjected: false,
  }));

  const projectionPoints: ChartPoint[] = [];
  let projAtl = current?.atl ?? 0;
  let projCtl = current?.ctl ?? 0;
  for (let i = 1; i <= 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    projAtl = projAtl + (0 - projAtl) * (1 / 7);
    projCtl = projCtl + (0 - projCtl) * (1 / 42);
    const projTsb = projCtl - projAtl;
    projectionPoints.push({
      date: d.toISOString().slice(0, 10),
      load: null, ctl: null, atl: null, tsb: null,
      ctlProj: Math.round(projCtl * 10) / 10,
      atlProj: Math.round(projAtl * 10) / 10,
      tsbProj: Math.round(projTsb * 10) / 10,
      isProjected: true,
    });
  }
  const chartData: ChartPoint[] = [...historicalChart, ...projectionPoints];

  const activeCategories: ActivityCategory[] = Object.keys(
    weeklyBreakdown.reduce((acc, w) => ({ ...acc, ...w.byCategory }), {})
  ) as ActivityCategory[];

  const weeklyChartData = weeklyBreakdown.map(w => ({ weekLabel: w.weekLabel, totalMinutes: w.totalMinutes, byCategory: w.byCategory }));

  const tickInterval = timeRange <= 30 ? 4 : timeRange <= 60 ? 6 : 10;

  const formatDate = (dateStr: string) => {
    try { return format(parseISO(dateStr), 'MMM d'); } catch { return dateStr; }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-8">

      {/* Back link + title */}
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Gauge className="h-5 w-5 text-primary" />
          Training Load &amp; Form
        </h1>
        <p className="text-sm text-muted-foreground">
          Based on {activitiesAnalysed} Strava activities
        </p>
      </div>

      {/* ── Status Banner ──────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className={cn(
          'px-4 py-3 flex items-center justify-between',
          fatigueColor(loadMetrics.fatigueStatus).replace('text-', 'border-b border-').split(' ')[0],
          fatigueColor(loadMetrics.fatigueStatus),
        )}>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={cn('text-xs font-semibold', fatigueColor(loadMetrics.fatigueStatus))}>
              {loadMetrics.fatigueLabel}
            </Badge>
            <p className="text-xs hidden sm:block">{fatigueDescription(loadMetrics.fatigueStatus)}</p>
          </div>
          {current && previous && <TsbTrendIcon tsb={current.tsb} prev={previous.tsb} />}
        </div>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground sm:hidden mb-3">{fatigueDescription(loadMetrics.fatigueStatus)}</p>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="Fitness" icon={Heart} color="text-blue-600"
              value={current?.ctl ?? loadMetrics.ctl}
              sublabel={ctlDelta !== 0 ? `${ctlDelta > 0 ? '+' : ''}${ctlDelta} vs last week` : '42-day EWMA (CTL)'}
              trend={ctlDelta > 0 ? <ArrowUpRight className="h-3.5 w-3.5 text-blue-600" /> : ctlDelta < 0 ? <ArrowDownRight className="h-3.5 w-3.5 text-orange-500" /> : undefined}
            />
            <MetricCard
              label="Fatigue" icon={Zap} color="text-rose-500"
              value={current?.atl ?? loadMetrics.atl}
              sublabel="7-day EWMA (ATL)"
            />
            <MetricCard
              label="Form" icon={Gauge}
              color={(current?.tsb ?? loadMetrics.tsb) > 5 ? 'text-green-600' : (current?.tsb ?? loadMetrics.tsb) < -10 ? 'text-orange-600' : 'text-muted-foreground'}
              value={`${(current?.tsb ?? loadMetrics.tsb) > 0 ? '+' : ''}${current?.tsb ?? loadMetrics.tsb}`}
              sublabel="CTL minus ATL (TSB)"
              trend={current && previous ? <TsbTrendIcon tsb={current.tsb} prev={previous.tsb} /> : undefined}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── PMC Chart ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Performance Management Chart</CardTitle>
              <CardDescription>Fitness, fatigue &amp; form over time · dashed = 14-day projection</CardDescription>
            </div>
            <div className="flex gap-1">
              {([30, 60, 90] as const).map(range => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    timeRange === range ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {range}d
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="60%"  stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="ctlFillProj" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="tsbFillPos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#22c55e" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="loadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#94a3b8" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={tickInterval} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <Tooltip content={<PMCTooltip />} cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                <ReferenceLine x={todayStr} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Today', position: 'insideTopRight', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                <Bar dataKey="load" fill="url(#loadFill)" radius={[2, 2, 0, 0]} maxBarSize={5} opacity={0.7} />
                <Area type="monotone" dataKey="ctl" stroke="#3b82f6" strokeWidth={2.5} fill="url(#ctlFill)" fillOpacity={1} dot={false} connectNulls={false} isAnimationActive={false} name="Fitness (CTL)" />
                <Area type="monotone" dataKey="ctlProj" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5 4" fill="url(#ctlFillProj)" fillOpacity={1} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
                <Line type="monotone" dataKey="atl" stroke="#ef4444" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} name="Fatigue (ATL)" />
                <Line type="monotone" dataKey="atlProj" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
                <Area type="monotone" dataKey="tsb" stroke="#22c55e" strokeWidth={2} fill="url(#tsbFillPos)" fillOpacity={1} baseValue={0} dot={false} connectNulls={false} isAnimationActive={false} name="Form (TSB)" />
                <Line type="monotone" dataKey="tsbProj" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-5 mt-3 text-xs">
            <div className="flex items-center gap-1.5"><div className="w-5 rounded-full" style={{ height: 3, backgroundColor: '#3b82f6' }} /><span className="text-muted-foreground">Fitness (CTL)</span></div>
            <div className="flex items-center gap-1.5"><div className="w-5 rounded-full" style={{ height: 3, backgroundColor: '#ef4444' }} /><span className="text-muted-foreground">Fatigue (ATL)</span></div>
            <div className="flex items-center gap-1.5"><div className="w-5 rounded-full" style={{ height: 3, backgroundColor: '#22c55e' }} /><span className="text-muted-foreground">Form (TSB)</span></div>
            <div className="flex items-center gap-1.5"><div className="w-5 rounded-full" style={{ height: 2, borderTop: '2px dashed #94a3b8' }} /><span className="text-muted-foreground">Projected</span></div>
          </div>
        </CardContent>
      </Card>

      {/* ── Weekly Volume Chart ─────────────────────────────────────────────── */}
      {weeklyChartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Weekly Training Volume</CardTitle>
            <CardDescription>Total training time by activity type (last 4 weeks)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyChartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="weekLabel" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit="m" />
                  <Tooltip content={<LoadTooltip />} />
                  {activeCategories.map((cat, i) => (
                    <Bar key={cat} dataKey={`byCategory.${cat}`} stackId="a" fill={CATEGORY_COLORS[cat]} name={CATEGORY_LABELS[cat]} radius={i === activeCategories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2 text-xs">
              {activeCategories.map(cat => (
                <div key={cat} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                  <span className="text-muted-foreground">{CATEGORY_LABELS[cat]}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Activity Breakdown ──────────────────────────────────────────────── */}
      {activityTypeSummary.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activity Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activityTypeSummary.map(t => (
              <div key={t.category} className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0" style={{ backgroundColor: `${CATEGORY_COLORS[t.category as ActivityCategory]}22` }}>
                  <CategoryIcon category={t.category as ActivityCategory} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{t.label}</p>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>This week: <span className="font-medium text-foreground">{formatMinutes(t.last7daysMinutes)}</span></span>
                    <span>Last 28d: <span className="font-medium text-foreground">{formatMinutes(t.last28daysMinutes)}</span>
                      {t.activityCount28 > 0 && <span> ({t.activityCount28} sessions)</span>}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Coach's Analysis (AI) ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Coach's Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!aiAnalysis && !aiLoading && (
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-muted-foreground">Get a personalised AI coaching analysis of your current training state.</p>
              <Button onClick={handleGenerateAnalysis} className="gap-2">
                <Brain className="h-4 w-4" /> Generate Analysis
              </Button>
              {aiError && <p className="text-sm text-destructive">{aiError}</p>}
            </div>
          )}
          {aiLoading && (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-4/6" />
              <Skeleton className="h-4 w-full mt-4" /><Skeleton className="h-4 w-3/4" />
              <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Analysing your training data…
              </div>
            </div>
          )}
          {aiAnalysis && (
            <div className="space-y-4 text-sm">
              <section className="rounded-lg bg-muted/30 p-4 space-y-1.5">
                <h3 className="font-semibold flex items-center gap-1.5"><TsbTrendIcon tsb={loadMetrics.tsb} /> How You're Feeling</h3>
                <p className="text-muted-foreground leading-relaxed">{aiAnalysis.fatigueAssessment}</p>
              </section>
              <section className="rounded-lg bg-muted/30 p-4 space-y-1.5">
                <h3 className="font-semibold">Training Balance</h3>
                <p className="text-muted-foreground leading-relaxed">{aiAnalysis.trainingBalance}</p>
              </section>
              <section className="rounded-lg bg-muted/30 p-4 space-y-1.5">
                <h3 className="font-semibold">This Week</h3>
                <p className="text-muted-foreground leading-relaxed">{aiAnalysis.weekAhead}</p>
              </section>
              {aiAnalysis.recommendations.length > 0 && (
                <section className="rounded-lg bg-primary/5 border border-primary/20 p-4 space-y-2">
                  <h3 className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Recommendations</h3>
                  <ul className="space-y-2">
                    {aiAnalysis.recommendations.map((rec, i) => (
                      <li key={i} className="flex gap-2 text-muted-foreground">
                        <span className="text-primary font-bold shrink-0">{i + 1}.</span>
                        <span className="leading-snug">{rec}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {aiAnalysis.riskFlags.length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-semibold text-orange-700 dark:text-orange-400 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Flags to Watch</h3>
                  <ul className="space-y-1.5">
                    {aiAnalysis.riskFlags.map((flag, i) => (
                      <li key={i} className="flex gap-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/50 text-orange-700 dark:text-orange-400 rounded-lg p-3">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span className="leading-snug text-xs">{flag}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <Button variant="outline" size="sm" className="w-full" onClick={handleGenerateAnalysis} disabled={aiLoading}>
                Refresh Analysis
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── VDOT Calculator promo ───────────────────────────────────────────── */}
      <Card className="border-accent/30 bg-gradient-to-r from-accent/5 to-accent/10">
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">Know your training paces?</p>
            <p className="text-xs text-muted-foreground">Use our VDOT Calculator to get all five Daniels zones from a recent race.</p>
          </div>
          <Link href="/vdot">
            <Button size="sm" variant="outline" className="shrink-0">
              VDOT Calculator
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* ── Form Zones Reference ────────────────────────────────────────────── */}
      <Card>
        <button onClick={() => setExplainerOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:text-primary transition-colors">
          <span className="flex items-center gap-2"><Info className="h-4 w-4" /> Understanding your numbers</span>
          {explainerOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {explainerOpen && (
          <CardContent className="pt-0 pb-4 space-y-4">
            <Separator />
            <div className="space-y-2">
              {FORM_ZONES.map(zone => (
                <div key={zone.label} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-xs', loadMetrics.fatigueLabel.toLowerCase().includes(zone.label.toLowerCase()) ? 'bg-muted ring-1 ring-primary/20' : '')}>
                  <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', zone.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{zone.label}</span>
                      <span className="text-muted-foreground font-mono shrink-0">{zone.range}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5">{zone.desc}</p>
                  </div>
                  {loadMetrics.fatigueLabel.toLowerCase().includes(zone.label.toLowerCase()) && (
                    <Badge variant="outline" className="text-[10px] shrink-0">You</Badge>
                  )}
                </div>
              ))}
            </div>
            <Separator />
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="space-y-1"><p className="font-semibold text-foreground">Fitness (CTL)</p><p>Your <strong>Chronic Training Load</strong> — 42-day average. A rising CTL means you're getting fitter.</p></div>
              <div className="space-y-1"><p className="font-semibold text-foreground">Fatigue (ATL)</p><p>Your <strong>Acute Training Load</strong> — 7-day average. Shows how tired you are right now.</p></div>
              <div className="space-y-1"><p className="font-semibold text-foreground">Form (TSB)</p><p><strong>Training Stress Balance</strong> = CTL − ATL. Positive means fresh; negative means carrying fatigue. Aim for −10 to +5 on race day.</p></div>
            </div>
          </CardContent>
        )}
      </Card>

    </div>
  );
}
