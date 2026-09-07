
import { config } from 'dotenv';
config();

import '@/ai/flows/motivational-coach.ts';
import '@/ai/flows/dashboard-summary.ts';
import '@/ai/flows/workout-summary.ts';
import '@/ai/flows/extend-workout.ts';
import '@/ai/flows/generate-workout.ts';
import '@/ai/flows/generate-article.ts';
import '@/ai/flows/adjust-training-plan.ts';
import '@/ai/flows/analyze-and-adjust.ts';
import '@/ai/flows/generate-race-plan.ts'; // ADDED
import '@/ai/flows/strava-description.ts';
import '@/ai/flows/parse-treadmill-workout.ts';
import '@/ai/schemas.ts';
