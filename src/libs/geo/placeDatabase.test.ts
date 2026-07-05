import { describe, it, expect, beforeAll } from "vitest";
import {
  loadPlaceDatabase,
  placeCount,
  getCityByPath,
  resolveCityQuery,
  resolveCountryToken,
  snapToNearest,
  nearbyPlaces,
  listCountries,
  regionsInCountry,
  postalPattern,
  countryName,
  usCityPopulation,
} from "./placeDatabase";
import { getCountryProfile } from "../i18n/countries";

// Integration test over the real vendored gazetteer (data/cities500.txt). Skips
// gracefully if the dataset hasn't been fetched yet (pnpm refresh-places).
const HAS_DATA = placeCountSafe();
function placeCountSafe(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("fs").existsSync(require("path").resolve("data/cities500.txt"));
  } catch {
    return false;
  }
}

describe.skipIf(!HAS_DATA)("placeDatabase (real gazetteer)", () => {
  beforeAll(() => {
    loadPlaceDatabase();
  });

  it("loads a large non-US city corpus", () => {
    expect(placeCount()).toBeGreaterThan(100000);
  });

  it("routes and resolves London (GB)", () => {
    const byPath = getCityByPath("gb", "england", "london");
    expect(byPath?.name).toBe("London");
    expect(byPath?.country).toBe("GB");
    expect(byPath?.path).toBe("/gb/england/london");
    expect(byPath?.timezone).toBe("Europe/London");

    expect(resolveCityQuery("London, GB")?.name).toBe("London");
    expect(resolveCityQuery("London, United Kingdom")?.country).toBe("GB");
    // Bare city resolves to the most populous match (London GB dwarfs the rest).
    expect(resolveCityQuery("London")?.country).toBe("GB");
  });

  it("resolves exonym + accented endonym city names", () => {
    // GeoNames stores Munich under its English exonym.
    expect(resolveCityQuery("Munich, DE")?.country).toBe("DE");
    expect(resolveCityQuery("Munich, Germany")?.country).toBe("DE");
    // Accented endonyms exercise NFKD diacritic folding (both accented + ASCII query).
    expect(resolveCityQuery("São Paulo, BR")?.country).toBe("BR");
    expect(resolveCityQuery("Sao Paulo, BR")?.name).toBe("São Paulo");
    expect(resolveCityQuery("Zürich, CH")?.country).toBe("CH");
  });

  it("excludes US cities (US stays on the zip overlay)", () => {
    expect(getCityByPath("us", "new-york", "new-york")).toBeNull();
  });

  it("snaps a coordinate to the nearest place (the universal IP path)", () => {
    expect(snapToNearest(51.5074, -0.1278, "GB")?.name).toBe("London");
    expect(snapToNearest(48.8566, 2.3522, "FR")?.country).toBe("FR");
  });

  it("builds a nearby-places mesh", () => {
    const london = getCityByPath("gb", "england", "london")!;
    const near = nearbyPlaces(london, 5);
    expect(near.length).toBe(5);
    expect(near[0].distanceKm).toBeLessThan(near[4].distanceKm + 1);
  });

  it("exposes country + region hubs and country metadata", () => {
    const countries = listCountries().map((c) => c.code);
    expect(countries).toContain("GB");
    expect(countries).toContain("DE");
    expect(regionsInCountry("GB")?.some((r) => r.name === "England")).toBe(true);
    expect(countryName("GB")).toBe("United Kingdom");
    expect(resolveCountryToken("Germany")).toBe("DE");
  });

  it("registers country locale metadata from countryInfo", () => {
    // Injected from countryInfo.txt for a country with no curated override.
    expect(getCountryProfile("NP").name).toBe("Nepal");
    expect(getCountryProfile("GB").measurement).toBe("uk");
  });

  it("compiles per-country postal regexes for typed-postal detection", () => {
    expect(postalPattern("GB")?.test("EC1A 1BB")).toBe(true);
    expect(postalPattern("DE")?.test("80331")).toBe(true);
  });

  it("keeps US city populations so search can pick the right namesake", () => {
    // Bare "Amsterdam": the world's most populous is Amsterdam, NL — and it dwarfs
    // any US Amsterdam, so search sends it abroad.
    const worldAmsterdam = resolveCityQuery("Amsterdam");
    expect(worldAmsterdam?.country).toBe("NL");
    expect(worldAmsterdam!.population).toBeGreaterThan(usCityPopulation("Amsterdam"));
    // Bare "San Jose": the US city (~1M) outweighs San José, CR (~335k), so it stays US.
    const worldSanJose = resolveCityQuery("San Jose");
    expect(usCityPopulation("San Jose")).toBeGreaterThan(worldSanJose!.population);
  });
});
