/**
 * ANSI / terminal-text primitives for the tty (curl) renderer: SGR color
 * helpers, a control-character sanitizer, and display-width-aware padding /
 * wrapping that understands both embedded ANSI escapes and East Asian
 * double-width glyphs.
 *
 * Zero-dependency by design (mirrors the hand-rolled gzip in
 * middleware/compression.ts). The width logic is a compact wcwidth
 * approximation: wide CJK ranges count 2 cells; combining marks, ZWJ, and
 * variation selectors count 0; everything else counts 1. Box-drawing and
 * block-element characters are East Asian *Ambiguous* - counted 1 here, which
 * matches the default of virtually every modern emulator (an `?ascii` fallback
 * exists for the rest).
 *
 * Colors stay on the 16-color palette ONLY: truecolor (38;2;...) sequences
 * garble on non-supporting terminals instead of degrading, and 16-color green
 * IS the site's phosphor aesthetic anyway.
 */

const ESC = "\x1b";

// SGR spans use specific "off" codes (27 = inverse off, 22 = dim off) rather
// than a full reset so an inline span never cancels the line's green base.
const GREEN_ON = `${ESC}[32m`;
const INV_ON = `${ESC}[7m`;
const INV_OFF = `${ESC}[27m`;
const DIM_ON = `${ESC}[2m`;
const DIM_OFF = `${ESC}[22m`;
const ALERT_ON = `${ESC}[41;37m`; // red bg + white fg - reserved for severe weather / LIVE
const ALERT_OFF = `${ESC}[49;32m`; // bg back to default, fg back to phosphor green
const RESET = `${ESC}[0m`;

/** Styled-span painters. With color disabled every method is identity. */
export interface Paint {
  readonly color: boolean;
  /** Wrap a fully-assembled line in the green phosphor base. */
  line(s: string): string;
  /** Reverse video - the site's only emphasis besides ALL CAPS. */
  inv(s: string): string;
  /** Faint - maps the site's dimmed meta/sub text. */
  dim(s: string): string;
  /** Red-background alert - EXCLUSIVELY for severe weather and LIVE chips. */
  alert(s: string): string;
}

export function mkPaint(color: boolean): Paint {
  if (!color) {
    const id = (s: string) => s;
    return { color, line: id, inv: id, dim: id, alert: id };
  }
  return {
    color,
    line: (s) => `${GREEN_ON}${s}${RESET}`,
    inv: (s) => `${INV_ON}${s}${INV_OFF}`,
    dim: (s) => `${DIM_ON}${s}${DIM_OFF}`,
    alert: (s) => `${ALERT_ON}${s}${ALERT_OFF}`,
  };
}

/**
 * OSC 8 hyperlink (opt-in via ?links): renders as clickable text in iTerm2 /
 * Windows Terminal / kitty / VTE and degrades to the plain text elsewhere.
 * BEL terminator for maximum compatibility.
 */
export function osc8(url: string, text: string, enabled: boolean): string {
  if (!enabled || !url) return text;
  // A hostile URL must not smuggle a terminator that breaks out of the OSC.
  const safe = url.replace(/[\x00-\x1f\x7f]/g, "");
  return `${ESC}]8;;${safe}\x07${text}${ESC}]8;;\x07`;
}

// ── Sanitization ─────────────────────────────────────────────────────────────

// C0 controls, DEL, C1 controls, and bidi-override/isolate controls. Upstream
// strings (RSS headlines, GeoNames place names, venue names) reach the tty
// renderer with NO other escaping layer - Pug's HTML escaping does not apply -
// so a hostile headline could otherwise inject terminal escapes (title
// spoofing, OSC 52 clipboard writes, cursor games).
const CONTROL_RE = /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Sanitize an untrusted value for terminal output: collapse all whitespace
 * (including \n / \t) to single spaces, then strip every control character an
 * escape sequence could be built from. ALL interpolated upstream data must
 * pass through this (our own art/border constants do not).
 */
export function sanitizeTty(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").replace(CONTROL_RE, "").trim();
}

// ── Display width ────────────────────────────────────────────────────────────

// Matches our own SGR spans and OSC 8 links so width math sees only glyphs.
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** East Asian Wide / Fullwidth ranges (the ones that occur in practice). */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi, CJK symbols
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana .. CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) || // emoji (approx.)
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B+
  );
}

const COMBINING_RE = /\p{M}/u;

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp === 0x200d /* ZWJ */ || (cp >= 0xfe00 && cp <= 0xfe0f) /* VS */) return 0;
  if (COMBINING_RE.test(ch)) return 0;
  return isWide(cp) ? 2 : 1;
}

/** Terminal display width of a string (ANSI-aware, wcwidth-approximate). */
export function visWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch);
  return w;
}

/** Pad with trailing spaces to `width` display cells (never truncates). */
export function padVis(s: string, width: number): string {
  const gap = width - visWidth(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}

/** Pad with leading spaces to `width` display cells. */
export function padStartVis(s: string, width: number): string {
  const gap = width - visWidth(s);
  return gap > 0 ? " ".repeat(gap) + s : s;
}

/** Center within `width` display cells. */
export function centerVis(s: string, width: number): string {
  const gap = width - visWidth(s);
  if (gap <= 0) return s;
  const left = Math.floor(gap / 2);
  return " ".repeat(left) + s + " ".repeat(gap - left);
}

/**
 * Truncate to at most `width` display cells, appending "…" when cut. Safe on
 * plain (non-ANSI) strings only - callers truncate data BEFORE styling it.
 */
export function truncVis(s: string, width: number): string {
  if (width <= 0) return "";
  if (visWidth(s) <= width) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

/**
 * Word-wrap plain text to `width` display cells. Words longer than a line are
 * hard-broken so a single monster token can never overflow a panel border.
 */
export function wrapVis(s: string, width: number): string[] {
  const words = s.split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let lineW = 0;
  const push = () => {
    if (line) lines.push(line);
    line = "";
    lineW = 0;
  };
  for (let word of words) {
    let wordW = visWidth(word);
    while (wordW > width) {
      // Hard-break an over-long word at the line boundary.
      if (lineW > 0) push();
      let piece = "";
      let pieceW = 0;
      for (const ch of word) {
        const cw = charWidth(ch);
        if (pieceW + cw > width) break;
        piece += ch;
        pieceW += cw;
      }
      // A double-width glyph wider than the target could yield an empty piece
      // and spin forever - always consume at least one character.
      if (!piece) piece = String.fromCodePoint(word.codePointAt(0)!);
      lines.push(piece);
      word = word.slice(piece.length);
      wordW = visWidth(word);
    }
    if (!word) continue;
    const sep = lineW > 0 ? 1 : 0;
    if (lineW + sep + wordW > width) push();
    line += (lineW > 0 ? " " : "") + word;
    lineW += (lineW > 0 ? 1 : 0) + wordW;
  }
  push();
  return lines.length ? lines : [""];
}

// ── ASCII fallback (?ascii) ──────────────────────────────────────────────────

// For terminals whose fonts/locales mangle box-drawing or block glyphs
// (East Asian Ambiguous rendered double-wide, legacy codepages): substitute
// plain ASCII lookalikes. Applied to the WHOLE document, masthead included -
// degraded but never misaligned.
const ASCII_MAP: Record<string, string> = {
  "╔": "+", "╗": "+", "╚": "+", "╝": "+", "═": "=", "║": "|",
  "╡": "|", "╞": "|", "─": "-", "│": "|", "█": "#", "░": ".",
  "▒": ":", "›": ">", "·": "*", "↑": "^", "↓": "v", "…": "~",
};

const ASCII_RE = new RegExp(`[${Object.keys(ASCII_MAP).join("")}]`, "g");

export function toAsciiFallback(s: string): string {
  return s.replace(ASCII_RE, (ch) => ASCII_MAP[ch]);
}
