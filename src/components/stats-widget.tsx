'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Flame, Target, Calendar } from 'lucide-react';
import { StreakData } from '@/utils/streak-calculator';
import { cn } from '@/lib/utils';

interface StatsWidgetProps {
  streakData: StreakData;
  loading?: boolean;
}

export function StatsWidget({ streakData, loading }: StatsWidgetProps) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
              <div className="h-4 w-4 bg-muted animate-pulse rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted animate-pulse rounded mb-1" />
              <div className="h-3 w-24 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const weeks = (n: number) => (n === 1 ? 'week' : 'weeks');
  const stats = [
    {
      title: 'Current Streak',
      value: streakData.currentStreak,
      suffix: `${weeks(streakData.currentStreak)} hitting ${streakData.weeklyTarget} sessions`,
      icon: Flame,
      color: streakData.currentStreak > 0 ? 'text-orange-500' : 'text-muted-foreground',
      bgColor: streakData.currentStreak > 0 ? 'bg-orange-500/10' : 'bg-muted/10',
    },
    {
      title: 'Total Workouts',
      value: streakData.totalWorkouts,
      suffix: 'completed',
      icon: Target,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'This Week',
      value: `${streakData.thisWeekWorkouts} / ${streakData.weeklyTarget}`,
      suffix:
        streakData.thisWeekWorkouts >= streakData.weeklyTarget
          ? 'week hit — rest days are part of the plan'
          : 'training days',
      icon: Calendar,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      title: 'Longest Streak',
      value: streakData.longestStreak,
      suffix: weeks(streakData.longestStreak),
      icon: TrendingUp,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <div className={cn('p-2 rounded-lg', stat.bgColor)}>
                <Icon className={cn('h-4 w-4', stat.color)} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.suffix}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
