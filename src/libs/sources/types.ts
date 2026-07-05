export interface CurrentWeather {
  tempF: number;
  feelsLikeF: number | null;
  humidity: number | null;
  weatherCode: number;
  condition: string;
  iconKey: string;
  isDay: boolean;
  windMph: number | null;
  windDir: number | null;
  windGustMph: number | null;
  precipIn: number | null;
  cloudCover: number | null;
}

export interface DailyForecast {
  date: string; // YYYY-MM-DD in the zip's local timezone
  weatherCode: number;
  condition: string;
  iconKey: string;
  highF: number;
  lowF: number;
  precipChance: number | null;
  sunrise: string | null; // ISO local
  sunset: string | null;
}

export interface HourlyForecast {
  time: string; // ISO local
  tempF: number;
  precipChance: number | null;
  weatherCode: number;
}

export interface WeatherData {
  provider: "open-meteo" | "nws";
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
  distanceMi: number | null;
  website: string | null;
}

export interface ParkItem {
  name: string;
  designation: string; // "National Park", "National Monument", ...
  url: string;
  distanceMi: number | null;
}

export interface CampItem {
  name: string;
  type: string; // "Campground", ...
  reservationUrl: string | null;
  distanceMi: number | null;
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
  league: string; // "MLB"
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

export interface PageData {
  zip: string;
  city: string;
  state: string;
  timezone: string;
  lat: number;
  lon: number;
  summary: string | null;
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
