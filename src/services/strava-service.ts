// src/services/strava-service.ts
//
// Was a 'use server' module — everything it exported besides this interface
// (a private token-refresh helper, unused anywhere in the file or beyond) was
// dead, superseded by src/lib/strava-token.ts's getValidStravaToken, which is
// what every live Strava route actually calls. 'use server' is dropped along
// with it: a directive with no exported action left on the file is meaningless
// and risks a build-time complaint for exporting only a type.

// Define the structure of a Strava activity object
export interface StravaActivity {
    id: number;
    name: string;
    distance: number;
    moving_time: number;
    elapsed_time: number;
    total_elevation_gain: number;
    type: string;
    sport_type: string;
    start_date: string;
    start_date_local: string;
    timezone: string;
    utc_offset: number;
    location_city: string | null;
    location_state: string | null;
    location_country: string | null;
    start_latlng: [number, number];
    end_latlng: [number, number];
    map: {
        id: string;
        summary_polyline: string | null;
        resource_state: number;
    };
    // Detailed fields
    description?: string;
    average_speed: number;
    max_speed: number;
    average_cadence?: number;
    average_heartrate?: number;
    max_heartrate?: number;
    suffer_score?: number;
    embed_token?: string;
}
