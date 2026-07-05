/**
 * Canonical data shapes. Weather is stored in CANONICAL METRIC (°C, km/h, mm);
 * the presenter converts to the visitor's display units at render time, so one
 * cached weather value serves every unit preference and the units toggle costs no
 * extra cache entries.
 */

export interface CurrentWeather {
  tempC: number;
  feelsLikeC: number | null;
  humidity: number | null;
  weatherCode: number;
  condition: string;
  iconKey: string;
  isDay: boolean;
  windKmh: number | null;
  windDir: number | null;
  windGustKmh: number | null;
  precipMm: number | null;
  cloudCover: number | null;
}

export interface DailyForecast {
  date: string; // YYYY-MM-DD in the place's local timezone
  weatherCode: number;
  condition: string;
  iconKey: string;
  highC: number;
  lowC: number;
  precipChance: number | null;
  sunrise: string | null; // ISO local
  sunset: string | null;
}

export interface HourlyForecast {
  time: string; // ISO local
  tempC: number;
  precipChance: number | null;
  weatherCode: number;
}

export interface WeatherData {
  provider: "open-meteo" | "nws" | "met-norway";
  current: CurrentWeather;
  daily: DailyForecast[]; // 10 (open-meteo) or ≤7 (nws)
  hourly: HourlyForecast[];
  fetchedAt: string;
}

export interface NewsStory {
  title: string;
  url: string; // Google redirect URLs kept as-is
  sourceName: string;
  sourceUrl?: string;
  publishedAt: string | null;
  score: number;
  corroborations: string[]; // distinct feed ids that carried this story
}

export interface NewsData {
  stories: NewsStory[];
  fetchedAt: string;
}

export interface AlertItem {
  id: string;
  event: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  headline: string;
  description: string;
  onset: string | null;
  ends: string | null;
  senderName: string;
}

export interface AirQualityData {
  provider: "airnow" | "open-meteo";
  scale: "us" | "eu"; // which AQI scale the value/category use
  aqi: number;
  category: string;
  pollutant: string;
  observedAt: string | null;
  fetchedAt: string;
}

export interface EventItem {
  name: string;
  url: string | null;
  startsAt: string | null; // ISO (UTC) for sorting
  startDateLocal: string | null; // YYYY-MM-DD
  startTimeLocal: string | null; // HH:MM
  venue: string | null;
  provider: "Ticketmaster" | "SeatGeek";
}

export interface EventsData {
  events: EventItem[];
  fetchedAt: string;
}

export interface QuakeItem {
  magnitude: number;
  place: string;
  time: string; // ISO
  url: string;
  distanceKm: number | null;
}

export interface PlaceItem {
  name: string;
  category: string;
  address: string | null;
  distanceM: number | null; // canonical meters
  website: string | null;
}

export interface ParkItem {
  name: string;
  designation: string; // "National Park", "National Monument", ...
  url: string;
  distanceKm: number | null; // canonical km
}

export interface CampItem {
  name: string;
  type: string; // "Campground", ...
  reservationUrl: string | null;
  distanceKm: number | null; // canonical km
}

export interface PollenType {
  name: string; // "Tree" | "Grass" | "Weed"
  value: number; // Universal Pollen Index 0-5
  category: string; // "Low" | "Moderate" | "High" | ...
}

export interface PollenData {
  types: PollenType[];
  fetchedAt: string;
}

export interface ElectionInfo {
  name: string;
  electionDay: string; // YYYY-MM-DD
  registrationUrl: string | null;
  pollingFinderUrl: string | null;
  ballotUrl: string | null;
}

export interface SportsGame {
  league: string; // "MLB" | "Premier League"
  team: string; // "New York Yankees"
  teamAbbrev: string;
  opponentAbbrev: string;
  homeAway: "vs" | "@";
  teamScore: string | null;
  oppScore: string | null;
  status: "live" | "final" | "scheduled";
  detail: string; // "Top 5th" | "Final" | "7:05 PM"
  startsAt: string; // ISO
  won: boolean | null; // only meaningful when final
}

export interface SunMoonData {
  sunrise: string | null; // ISO
  sunset: string | null;
  solarNoon: string | null;
  dayLengthMin: number | null;
  moonPhase: number; // 0..1
  moonPhaseName: string; // "WAXING GIBBOUS"
  moonIllumination: number; // 0..100
}

/**
 * The intrinsic facts of a place - the identity a page renders for. Both US zips
 * and global cities map to this via geo/context.ts. Render-time preferences
 * (units/language) are NOT stored here; they are applied by the presenter so the
 * page bundle cache stays per-place.
 */
export interface PlaceContext {
  id: string; // "us:{zip}" or a GeoNames geonameId
  kind: "us-zip" | "city";
  country: string; // ISO 3166-1 alpha-2
  city: string;
  admin1Code: string; // US state code or GeoNames admin1
  admin1Name: string; // "Ohio" | "England"
  postal: string | null; // US zip, else null
  lat: number;
  lon: number;
  timezone: string; // IANA
  canonicalPath: string; // "/43215" | "/gb/england/london"
}

export interface PageData {
  place: PlaceContext;
  summary: string | null; // generated in the place's default local language
  weather: WeatherData | null;
  alerts: AlertItem[] | null;
  news: NewsData | null;
  air: AirQualityData | null;
  events: EventsData | null;
  quakes: QuakeItem[] | null;
  sports: SportsGame[] | null;
  places: PlaceItem[] | null;
  parks: ParkItem[] | null;
  camps: CampItem[] | null;
  pollen: PollenData | null;
  election: ElectionInfo | null;
  sunMoon: SunMoonData | null;
  generatedAt: string;
}
