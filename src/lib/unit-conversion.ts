
import { UnitSystem } from '@/models/types';

/**
 * Parses a weight string like "100kg", "220lbs", or "100" (assumed kg) into kilograms.
 * Returns null when the string cannot be parsed or the value is non-positive.
 */
export function parseWeightToKg(str: string): number | null {
  if (!str) return null;
  const lower = str.toLowerCase().trim();
  const num = parseFloat(lower);
  if (isNaN(num) || num <= 0) return null;
  return lower.includes('lb') ? Math.round(num * 0.453592 * 10) / 10 : num;
}

/**
 * Converts a weight string (e.g., "60kg", "135lbs") or number to the preferred unit system.
 * Assuming input strings without units are in kg.
 */
export function convertWeight(value: string | number, system: UnitSystem): string {
  let weightKg: number;

  if (typeof value === 'number') {
    weightKg = value;
  } else {
    const lowerVal = value.toLowerCase();
    const numericPart = parseFloat(lowerVal);
    if (isNaN(numericPart)) return value; // Return original if not a number

    if (lowerVal.includes('lb')) {
      weightKg = numericPart * 0.453592;
    } else {
      // Default to kg
      weightKg = numericPart;
    }
  }

  if (system === 'imperial') {
    const lbs = Math.round(weightKg * 2.20462);
    return `${lbs}lbs`;
  } else {
    // Round to 1 decimal place if needed, or integer if whole
    const kg = Math.round(weightKg * 10) / 10;
    return `${kg}kg`;
  }
}

/**
 * Converts a distance string (e.g., "5km", "10mi") or number (km) to the preferred unit system.
 */
export function convertDistance(value: string | number, system: UnitSystem): string {
    let distKm: number;

    if (typeof value === 'number') {
        distKm = value;
    } else {
        const lowerVal = value.toLowerCase();
        const numericPart = parseFloat(lowerVal);
        if (isNaN(numericPart)) return value;

        if (lowerVal.includes('mi')) {
            distKm = numericPart * 1.60934;
        } else if (lowerVal.includes('m') && !lowerVal.includes('km')) {
             // meters
             distKm = numericPart / 1000;
        } else {
            // Default to km
            distKm = numericPart;
        }
    }

    if (system === 'imperial') {
        const miles = distKm * 0.621371;
        return `${miles.toFixed(2)}mi`;
    } else {
        return `${distKm.toFixed(2)}km`;
    }
}

/**
 * Parses text containing weights and converts them to the target system.
 * Example: "4 sets @ 60kg" -> "4 sets @ 132lbs" (if imperial)
 */
export function convertTextWithUnits(text: string, system: UnitSystem): string {
    if (!text) return text;
    
    // Regex for finding weights like "60kg", "60 kg", "135lbs", "135 lbs"
    // Capture groups: 1=number, 2=unit
    const weightRegex = /(\d+(?:\.\d+)?)\s*(kg|lbs?)/gi;

    const convertedText = text.replace(weightRegex, (match, numStr, unit) => {
        const num = parseFloat(numStr);
        const isLbs = unit.toLowerCase().startsWith('lb');
        
        const weightKg = isLbs ? num * 0.453592 : num;

        if (system === 'imperial') {
             const lbs = Math.round(weightKg * 2.20462);
             return `${lbs}lbs`;
        } else {
             const kg = Math.round(weightKg * 10) / 10;
             return `${kg}kg`;
        }
    });

    // Regex for distances like "10km", "5 miles" could be added similarly if needed broadly
    // For now, let's stick to weights which are most common in descriptions like "4x8 @ 60kg"
    
    return convertedText;
}

/**
 * Parses text containing distances and converts them to the target system.
 * Example: "Run 5km" -> "Run 3.11mi" (if imperial)
 */
export function convertDistanceInText(text: string, system: UnitSystem): string {
    if (!text) return text;
    
    // Regex for finding distances like "5km", "5 km", "10miles", "10 mi"
    // Capture groups: 1=number, 2=unit
    const distRegex = /(\d+(?:\.\d+)?)\s*(km|kilometers?|mi|miles?)/gi;

    const convertedText = text.replace(distRegex, (match, numStr, unit) => {
        const num = parseFloat(numStr);
        const isMiles = unit.toLowerCase().startsWith('mi');
        
        const distKm = isMiles ? num * 1.60934 : num;

        if (system === 'imperial') {
             const miles = distKm * 0.621371;
             return `${miles.toFixed(2)}mi`;
        } else {
             const km = Math.round(distKm * 100) / 100;
             return `${km}km`;
        }
    });

    return convertedText;
}
