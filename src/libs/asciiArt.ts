/**
 * ASCII art for the terminal UI. Weather icons adapted from wego
 * (github.com/schachmat/wego, ISC License - Copyright (c) 2014-2017,
 * Markus Teich; see below) with ANSI color codes stripped and non-CP437
 * glyphs substituted so every character renders in the WebPlus IBM VGA font:
 *   ʻ ‚ (Unicode quote variants) → ' ,
 *   ‒ (figure dash)             → -
 *   ⚡ (lightning)               → redrawn from / and _
 *
 * ISC License: Permission to use, copy, modify, and/or distribute this
 * software for any purpose with or without fee is hereby granted, provided
 * that the above copyright notice and this permission notice appear in all
 * copies.
 *
 * Every icon is exactly 5 lines × 13 columns.
 */

// figlet "ANSI Shadow" - regenerate with: npx figlet-cli -f "ANSI Shadow" "<name>"
export const MASTHEAD = [
  "████████╗████████╗██╗   ██╗███╗   ██╗███████╗██╗    ██╗███████╗",
  "╚══██╔══╝╚══██╔══╝╚██╗ ██╔╝████╗  ██║██╔════╝██║    ██║██╔════╝",
  "   ██║      ██║    ╚████╔╝ ██╔██╗ ██║█████╗  ██║ █╗ ██║███████╗",
  "   ██║      ██║     ╚██╔╝  ██║╚██╗██║██╔══╝  ██║███╗██║╚════██║",
  "   ██║      ██║      ██║██╗██║ ╚████║███████╗╚███╔███╔╝███████║",
  "   ╚═╝      ╚═╝      ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝ ╚══╝╚══╝ ╚══════╝",
].join("\n");

export const MASTHEAD_404 = [
  "██╗  ██╗ ██████╗ ██╗  ██╗",
  "██║  ██║██╔═████╗██║  ██║",
  "███████║██║██╔██║███████║",
  "╚════██║████╔╝██║╚════██║",
  "     ██║╚██████╔╝     ██║",
  "     ╚═╝ ╚═════╝      ╚═╝",
].join("\n");

type IconLines = [string, string, string, string, string];

const ICONS: Record<string, IconLines> = {
  sunny: [
    "    \\ . /    ",
    "   - .-. -   ",
    "  - (   ) -  ",
    "   . `-' .   ",
    "    / ' \\    ",
  ],
  moon: [
    "     .--.    ",
    "    /  .'    ",
    "   |  |      ",
    "    \\  `.    ",
    "     `--'    ",
  ],
  partlyCloudy: [
    "   \\__/      ",
    " __/  .-.    ",
    "   \\_(   ).  ",
    "   /(___(__) ",
    "             ",
  ],
  cloudy: [
    "             ",
    "     .--.    ",
    "  .-(    ).  ",
    " (___.__)__) ",
    "             ",
  ],
  fog: [
    "             ",
    " _ - _ - _ - ",
    "  _ - _ - _  ",
    " _ - _ - _ - ",
    "             ",
  ],
  lightRain: [
    "     .-.     ",
    "    (   ).   ",
    "   (___(__)  ",
    "    ' ' ' '  ",
    "   ' ' ' '   ",
  ],
  heavyRain: [
    "     .-.     ",
    "    (   ).   ",
    "   (___(__)  ",
    "  ,',',','   ",
    "  ,',',','   ",
  ],
  lightShowers: [
    " _`/\"\".-.    ",
    "  ,\\_(   ).  ",
    "   /(___(__) ",
    "     ' ' ' ' ",
    "    ' ' ' '  ",
  ],
  heavyShowers: [
    " _`/\"\".-.    ",
    "  ,\\_(   ).  ",
    "   /(___(__) ",
    "   ,',',','  ",
    "   ,',',','  ",
  ],
  sleet: [
    "     .-.     ",
    "    (   ).   ",
    "   (___(__)  ",
    "    ' * ' *  ",
    "   * ' * '   ",
  ],
  lightSnow: [
    "     .-.     ",
    "    (   ).   ",
    "   (___(__)  ",
    "    *  *  *  ",
    "   *  *  *   ",
  ],
  heavySnow: [
    "     .-.     ",
    "    (   ).   ",
    "   (___(__)  ",
    "   * * * *   ",
    "  * * * *    ",
  ],
  snowShowers: [
    " _`/\"\".-.    ",
    "  ,\\_(   ).  ",
    "   /(___(__) ",
    "     *  *  * ",
    "    *  *  *  ",
  ],
  thunder: [
    "     .-.     ",
    "    (   ).   ",
    "   (___(__)  ",
    "   ,'7_,'7_  ",
    "   ,','7_,'  ",
  ],
  unknown: [
    "    .-.      ",
    "     __)     ",
    "    (        ",
    "     `-'     ",
    "      ?      ",
  ],
};

export interface WeatherIcon {
  art: string;
  label: string;
}

/**
 * Resolve an icon key (from wmo.ts) + day/night flag to renderable art.
 * "clear" is the only key with a night variant.
 */
export function weatherIcon(iconKey: string, isDay: boolean, label?: string): WeatherIcon {
  let key = iconKey;
  if (iconKey === "clear") key = isDay ? "sunny" : "moon";
  const lines = ICONS[key] || ICONS.unknown;
  return { art: lines.join("\n"), label: label || key };
}

/** AQI bar gauge: "[███░░░░░░░]" - 10 cells over the 0-500 EPA scale. */
export function aqiGauge(aqi: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(Math.min(aqi, 500) / 50)));
  return `[${"█".repeat(filled)}${"░".repeat(10 - filled)}]`;
}

/** Pollen bar gauge: "[███░░]" - 5 cells over the Universal Pollen Index (0-5). */
export function pollenGauge(value: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return `[${"█".repeat(filled)}${"░".repeat(5 - filled)}]`;
}

/** Moon phase (0..1 from suncalc) → display name. */
export function moonPhaseName(phase: number): string {
  const names = [
    "NEW MOON",
    "WAXING CRESCENT",
    "FIRST QUARTER",
    "WAXING GIBBOUS",
    "FULL MOON",
    "WANING GIBBOUS",
    "LAST QUARTER",
    "WANING CRESCENT",
  ];
  // 8 buckets centered on the canonical phase points.
  const idx = Math.round(phase * 8) % 8;
  return names[idx];
}
