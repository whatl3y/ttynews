import SunCalc from "suncalc";
import { moonPhaseName } from "../asciiArt";
import { SunMoonData } from "./types";

/** Pure local astronomy - no network, no cache. */
export function getSunMoon(lat: number, lon: number): SunMoonData {
  const now = new Date();
  const times = SunCalc.getTimes(now, lat, lon);
  const moon = SunCalc.getMoonIllumination(now);

  const iso = (d: Date | undefined): string | null =>
    d && !isNaN(d.getTime()) ? d.toISOString() : null;

  const sunrise = iso(times.sunrise);
  const sunset = iso(times.sunset);
  const dayLengthMin =
    sunrise && sunset
      ? Math.round((new Date(sunset).getTime() - new Date(sunrise).getTime()) / 60000)
      : null;

  return {
    sunrise,
    sunset,
    solarNoon: iso(times.solarNoon),
    dayLengthMin,
    moonPhase: moon.phase,
    moonPhaseName: moonPhaseName(moon.phase),
    moonIllumination: Math.round(moon.fraction * 100),
  };
}
