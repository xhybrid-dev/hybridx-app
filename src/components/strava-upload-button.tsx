// src/components/strava-upload-button.tsx
'use client';
import { logger } from '@/lib/logger';
import { openExternal } from '@/lib/native';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, ExternalLink, Check, Loader2 } from 'lucide-react';
import { getAuthInstance } from '@/lib/firebase';

interface StravaUploadButtonProps {
  sessionId: string;
  activityName?: string;
  isUploaded?: boolean;
  stravaId?: string;
  disabled?: boolean;
}

export function StravaUploadButton({ 
  sessionId, 
  activityName, 
  isUploaded = false, 
  stravaId,
  disabled = false 
}: StravaUploadButtonProps) {
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(isUploaded);
  const [uploadedStravaId, setUploadedStravaId] = useState(stravaId);
  const { toast } = useToast();

  const handleUpload = async () => {
    if (uploaded || uploading) return;
    
    setUploading(true);
    
    try {
      // Proactively refresh the session cookie before making the API call
      const auth = await getAuthInstance();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('You must be logged in to upload to Strava.');
      }
      
      const idToken = await currentUser.getIdToken(true);
      const sessionResponse = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
          credentials: 'include'
      });

      if (!sessionResponse.ok) {
          throw new Error('Failed to refresh authentication session.');
      }

      // Now make the authenticated request
      const response = await fetch('/api/strava/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ sessionId })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload to Strava');
      }

      setUploaded(true);
      setUploadedStravaId(data.stravaActivityId);
      
      toast({
        title: 'Success!',
        description: `"${activityName || 'Activity'}" uploaded to Strava successfully.`,
      });

    } catch (error) {
      logger.error('Upload error:', error);
      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Failed to upload activity to Strava.',
        variant: 'destructive'
      });
    } finally {
      setUploading(false);
    }
  };

  const openInStrava = () => {
    if (uploadedStravaId) {
      void openExternal(`https://www.strava.com/activities/${uploadedStravaId}`);
    }
  };

  if (disabled) {
      return (
        <Button disabled className="w-full" variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Upload to Strava (Skipped Workout)
        </Button>
      )
  }

  if (uploaded && uploadedStravaId) {
    return (
      <Button
        variant="outline"
        onClick={openInStrava}
        className="text-orange-600 border-orange-200 hover:bg-orange-50 w-full"
      >
        <Check className="h-4 w-4 mr-2" />
        View on Strava
        <ExternalLink className="h-3 w-3 ml-1" />
      </Button>
    );
  }

  return (
    <Button
      onClick={handleUpload}
      disabled={disabled || uploading || uploaded}
      className="text-orange-600 bg-orange-100 hover:bg-orange-200 border-orange-200 border w-full"
    >
      {uploading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Upload className="h-4 w-4 mr-2" />
      )}
      {uploading ? 'Uploading...' : 'Upload to Strava'}
    </Button>
  );
}
