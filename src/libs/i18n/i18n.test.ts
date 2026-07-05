import { describe, it, expect } from "vitest";
import { getCountryProfile } from "./countries";
import {
  resolveMeasurement,
  formatTemp,
  formatWind,
  formatDistanceKm,
  distanceUnitLabel,
} from "./units";
import { t, languageName, isRtl } from "./strings";

describe("countries", () => {
  it("pins the imperial/uk/metric systems", () => {
    expect(getCountryProfile("US").measurement).toBe("imperial");
    expect(getCountryProfile("gb").measurement).toBe("uk");
    expect(getCountryProfile("FR").measurement).toBe("metric");
  });
  it("derives primary language and defaults the long tail", () => {
    expect(getCountryProfile("de").lang).toBe("de");
    expect(getCountryProfile("US").lang).toBe("en");
    const unknown = getCountryProfile("zz");
    expect(unknown.measurement).toBe("metric");
    expect(unknown.lang).toBe("en");
  });
});

describe("units (canonical metric -> display)", () => {
  it("resolves the measurement system with an optional override", () => {
    expect(resolveMeasurement("US")).toBe("imperial");
    expect(resolveMeasurement("GB")).toBe("uk");
    expect(resolveMeasurement("FR")).toBe("metric");
    expect(resolveMeasurement("US", "metric")).toBe("metric");
    expect(resolveMeasurement("FR", "imperial")).toBe("imperial");
  });
  it("converts temperature", () => {
    expect(formatTemp(0, "metric")).toBe("0°C");
    expect(formatTemp(0, "imperial")).toBe("32°F");
    expect(formatTemp(20, "imperial")).toBe("68°F");
    expect(formatTemp(20, "uk")).toBe("20°C");
  });
  it("converts wind (uk keeps mph, only metric uses km/h)", () => {
    expect(formatWind(16.09344, "imperial")).toBe("10 MPH");
    expect(formatWind(16.09344, "uk")).toBe("10 MPH");
    expect(formatWind(16, "metric")).toBe("16 KM/H");
  });
  it("converts distance", () => {
    expect(formatDistanceKm(1.609344, "imperial")).toBe("1 MI");
    expect(formatDistanceKm(5, "metric")).toBe("5 KM");
    expect(distanceUnitLabel("uk")).toBe("MI");
  });
});

describe("strings", () => {
  it("translates, interpolates, and falls back to English", () => {
    expect(t("form.enter", "en")).toBe("Enter");
    expect(t("form.enter", "de")).toBe("Los");
    expect(t("form.enter", "xx")).toBe("Enter"); // unseeded language -> English
    expect(t("empty.noData", "en", { msg: "FOO" })).toBe("NO DATA - FOO");
    expect(t("empty.noData", "es", { msg: "FOO" })).toBe("SIN DATOS - FOO");
  });
  it("knows native language names and RTL scripts", () => {
    expect(languageName("de")).toBe("Deutsch");
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("en")).toBe(false);
  });
});
