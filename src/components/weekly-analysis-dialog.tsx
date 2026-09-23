// src/components/weekly-analysis-dialog.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles, CheckCircle, ArrowRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { authedFetch } from '@/lib/client-auth';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';

interface WeeklyAnalysisDialogProps {
  userId: string;
  trigger?: React.ReactNode;
}

export function WeeklyAnalysisDialog({ trigger }: WeeklyAnalysisDialogProps) {
  // userId is part of the public props (still supplied by every caller) but
  // unused here: /api/ai/analyze-week resolves the caller from the auth token
  // via requireUser(), not from a client-supplied id.
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [customRequest, setCustomRequest] = useState('');
  const { toast } = useToast();

  const handleAnalyze = async () => {
    setLoading(true);
    setResult(null);
    try {
      const response = await authedFetch('/api/ai/analyze-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customRequest: customRequest.trim() || undefined,
        }),
      });

      if (!response.ok) throw new Error('Analysis failed');
      const data = await response.json();
      setResult(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Could not complete the analysis. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  
  const handleApplyChanges = async () => {
    if (!result?.adjustments || result.adjustments.length === 0) {
      toast({
        title: 'No Adjustments',
        description: 'There are no adjustments to apply.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const response = await authedFetch('/api/ai/apply-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustments: result.adjustments,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to apply adjustments');
      }

      const data = await response.json();

      toast({
        title: 'Plan Updated! 🎉',
        description: `Applied ${data.adjustmentsApplied} adjustment(s) to your personalized training plan.`,
      });

      setIsOpen(false);

      // Refresh the page to show updated workouts
      window.location.reload();
    } catch (error) {
      console.error('Error applying adjustments:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to apply adjustments. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" className="gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Analyze My Week
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
             <Sparkles className="h-5 w-5 text-purple-500" />
             AI Coach Analysis
          </DialogTitle>
          <DialogDescription>
             Reviewing your recent feedback to optimize your upcoming week.
          </DialogDescription>
        </DialogHeader>

        {!result && !loading && (
             <div className="py-6 space-y-6">
                 <p className="text-muted-foreground text-center">
                     Ready to check your progress? The AI will look at your recent workout notes and suggest tweaks to your schedule.
                 </p>

                 {/* Custom Request Input */}
                 <div className="space-y-2">
                   <Label htmlFor="customRequest" className="text-sm font-medium">
                     Custom Request (Optional)
                   </Label>
                   <Textarea
                     id="customRequest"
                     placeholder="e.g., 'I want longer metcon workouts', 'Add more running', 'Reduce volume this week'..."
                     value={customRequest}
                     onChange={(e) => setCustomRequest(e.target.value)}
                     className="min-h-[100px] resize-none"
                     maxLength={500}
                   />
                   <p className="text-xs text-muted-foreground">
                     Tell the AI how you'd like to adjust your program
                   </p>
                 </div>

                 <Button onClick={handleAnalyze} className="w-full">
                     <Sparkles className="mr-2 h-4 w-4" />
                     Start Analysis
                 </Button>
             </div>
        )}

        {loading && (
            <div className="py-12 flex flex-col items-center justify-center space-y-4">
                <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
                <p className="text-sm text-muted-foreground animate-pulse">Analyzing workout patterns...</p>
            </div>
        )}

        {result && (
            <div className="space-y-6">
                {customRequest && (
                  <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-purple-900 dark:text-purple-100">Your Request:</p>
                        <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">{customRequest}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                    <h3 className="font-semibold text-lg">Coach's Summary</h3>
                    <p className="text-sm text-foreground/90 leading-relaxed bg-muted p-4 rounded-md">
                        {result.analysis}
                    </p>
                </div>

                {result.needsAdjustment && result.adjustments?.length > 0 ? (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-lg">Recommended Adjustments</h3>
                            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                                {result.adjustments.length} Changes
                            </Badge>
                        </div>
                        
                        {result.adjustments.map((adj: any, idx: number) => (
                            <Card key={idx} className="border-l-4 border-l-yellow-400">
                                <CardContent className="pt-4">
                                    <div className="flex justify-between items-start mb-2">
                                        <Badge variant="secondary">Day {adj.day}</Badge>
                                        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Modification</span>
                                    </div>
                                    <div className="grid gap-2">
                                        <div className="text-sm">
                                            <span className="text-muted-foreground line-through mr-2">{adj.originalTitle}</span>
                                            <ArrowRight className="inline h-3 w-3 mx-1" />
                                            <span className="font-semibold text-foreground">{adj.modifiedTitle}</span>
                                        </div>
                                        <p className="text-sm text-muted-foreground italic">
                                            "{adj.reason}"
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                        <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
                        <h3 className="font-semibold">Plan Looks Great!</h3>
                        <p className="text-sm text-muted-foreground max-w-xs">
                            No adjustments needed. You're crushing it! Stick to the original schedule.
                        </p>
                    </div>
                )}
            </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => setIsOpen(false)}>Close</Button>
          {result && result.needsAdjustment && (
              <Button onClick={handleApplyChanges} className="bg-purple-600 hover:bg-purple-700">
                  Apply Adjustments
              </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
