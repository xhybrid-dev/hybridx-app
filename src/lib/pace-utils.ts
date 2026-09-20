
// src/lib/pace-utils.ts
import type { User, RunningProgram } from '@/models/types';

/**
 * VDOT calculation based on Jack Daniels' formula.
 * VDOT is a measure of your running ability.
 */
function calculateVdot(distanceMeters: number, timeSeconds: number): number {
    if (timeSeconds <= 0) return 0;
    const velocity = distanceMeters / (timeSeconds / 60); // meters per minute
    const percentMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * timeSeconds) + 0.2989558 * Math.exp(-0.1932605 * timeSeconds);
    const vo2 = -4.60 + 0.182258 * velocity + 0.000104 * velocity * velocity;
    return vo2 / percentMax;
}

/**
 * Calculates training paces based on VDOT.
 * These percentages are derived from Jack Daniels' Running Formula tables.
 */
function getPacesFromVdot(vdot: number): Record<string, number> {
    const maxVelocity = 29.54 + 5.000663 * vdot - 0.007546 * vdot * vdot; // meters per minute
    const metersPerKm = 1000;

    const calculatePace = (percentage: number) => {
        const pacePerMeter = 1 / (maxVelocity * percentage); // minutes per meter
        return (pacePerMeter * metersPerKm) * 60; // seconds per kilometer
    };
    
    return {
        easy: calculatePace(0.7),      // ~70% of max velocity
        marathon: calculatePace(0.83), // ~83%
        threshold: calculatePace(0.88),// ~88%
        interval: calculatePace(0.975),// ~97.5%
        repetition: calculatePace(1.05), // ~105%
        recovery: calculatePace(0.65),   // ~65%
    };
}


/**
 * Converts a time string (e.g., "25:30" or "1:55:00") to seconds.
 * It uses the race type to infer whether a two-part time is H:MM or MM:SS.
 */
export function timeStringToSeconds(timeStr: string, raceType: RunningProgram['targetRace']): number {
    if (!timeStr) return 0;
    
    const parts = timeStr.split(':').map(part => parseInt(part, 10) || 0);

    let hours = 0, minutes = 0, seconds = 0;

    if (parts.length === 3) { // HH:MM:SS
        [hours, minutes, seconds] = parts;
    } else if (parts.length === 2) { // Could be MM:SS or HH:MM
        // Use race type to make an educated guess
        if (raceType === 'half-marathon' || raceType === 'marathon') {
            [hours, minutes] = parts; // Assume HH:MM for longer races
        } else {
            [minutes, seconds] = parts; // Assume MM:SS for shorter races
        }
    } else if (parts.length === 1) { // SS
        seconds = parts[0];
    } else {
        return 0; // Invalid format
    }

    return (hours * 3600) + (minutes * 60) + seconds;
}


/**
 * Converts total seconds to a time string (e.g., "25:30" or "01:55:00").
 */
export function secondsToTimeString(totalSeconds: number): string {
    if (!totalSeconds || totalSeconds <= 0) return '';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.round(totalSeconds % 60);
    
    const paddedMinutes = minutes < 10 ? `0${minutes}` : minutes;
    const paddedSeconds = seconds < 10 ? `0${seconds}` : seconds;

    if (hours > 0) {
        return `${hours}:${paddedMinutes}:${paddedSeconds}`;
    }
    return `${minutes}:${paddedSeconds}`;
}


/**
 * Converts a race time over a distance to a pace in seconds per kilometer.
 */
export function calculatePacePerKm(timeSeconds: number, distanceKm: number): number {
    if (!timeSeconds || !distanceKm) return 0;
    return timeSeconds / distanceKm;
}

/**
 * Primary function to calculate all training zones for a user based on their best race performance.
 */
export function calculateTrainingPaces(user: User): Record<string, number> | null {
    const runningProfile = user.runningProfile;
    if (!runningProfile?.benchmarkPaces) return null;

    const benchmarks = [
        { name: 'mile', distance: 1609.34, time: runningProfile.benchmarkPaces.mile || 0 },
        { name: 'fiveK', distance: 5000, time: runningProfile.benchmarkPaces.fiveK || 0 },
        { name: 'tenK', distance: 10000, time: runningProfile.benchmarkPaces.tenK || 0 },
        { name: 'halfMarathon', distance: 21097.5, time: runningProfile.benchmarkPaces.halfMarathon || 0 },
    ];
    
    let bestVdot = 0;
    
    // Find the best VDOT from all provided benchmarks
    for (const benchmark of benchmarks) {
        if (benchmark.time > 0) {
            const vdot = calculateVdot(benchmark.distance, benchmark.time);
            if (vdot > bestVdot) {
                bestVdot = vdot;
            }
        }
    }
    
    if (bestVdot === 0) return null; // No valid benchmarks provided

    const paces = getPacesFromVdot(bestVdot);
    
    // Apply safety adjustments based on experience
    const adjustmentFactor = user.experience === 'beginner' ? 1.08 : user.experience === 'intermediate' ? 1.04 : 1.0;
    
    const adjustedPaces: Record<string, number> = {};
    for (const zone in paces) {
        adjustedPaces[zone] = Math.round(paces[zone] * adjustmentFactor);
    }
    
    return adjustedPaces;
}

/**
 * Formats a pace in seconds per kilometer to a "MM:SS" string.
 */
export function formatPace(paceSeconds: number): string {
    if (paceSeconds <= 0) return "N/A";
    const minutes = Math.floor(paceSeconds / 60);
    const seconds = Math.round(paceSeconds % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}
