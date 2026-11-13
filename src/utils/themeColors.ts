/**
 * Colours for new themes that never sit close to a theme the reader already has.
 *
 * The old rule took the first palette colour not used yet: after the palettes' 24 colours it
 * repeated, and neighbours like Warm Terracotta and Golden Ochre, or Golden Ochre and Amber Sun
 * (the same hex), were hard to tell apart on the page. Now each candidate is measured against
 * every existing theme in OKLab (distances there follow what the eye sees, unlike RGB), and the
 * one farthest from its nearest neighbour wins. The palettes' own colours are preferred while one
 * of them is far enough; after that, colours are generated around the hue circle at the palettes'
 * lightness and strength, so the result still looks like it belongs.
 *
 * Pure and deterministic: the same themes always suggest the same colour.
 */

type Lab = [number, number, number];

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** `#rrggbb` (or `#rgb`) to OKLab; null for anything else. */
export function hexToOklab(hex: string): Lab | null {
  let m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    const s = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex.trim());
    if (!s) return null;
    m = ['', s[1] + s[1] + s[2] + s[2] + s[3] + s[3]] as unknown as RegExpExecArray;
  }
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(m![1].slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s
  ];
}

/** OKLCH (lightness 0–1, chroma, hue in degrees) to `#rrggbb`, or null when outside sRGB. */
export function oklchToHex(L: number, C: number, hDeg: number): string | null {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map(fromLinear);
  if (rgb.some((v) => v < -0.001 || v > 1.001)) return null;
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Perceptual distance between two colours (OKLab, ~0.02 is a just-visible step). Infinity if unreadable. */
export function colorDistance(a: string, b: string): number {
  const x = hexToOklab(a);
  const y = hexToOklab(b);
  if (!x || !y) return Infinity;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Two themes closer than this read as the same colour on the page. */
export const MIN_THEME_DISTANCE = 0.1;

const nearest = (color: string, existing: readonly string[]) =>
  existing.reduce((min, e) => Math.min(min, colorDistance(color, e)), Infinity);

/** Hues every 5°, at the palettes' lightness and strength (and a lighter and darker ring). */
const GENERATED: string[] = (() => {
  const out: string[] = [];
  for (const [L, C] of [
    [0.58, 0.13],
    [0.7, 0.11],
    [0.46, 0.1]
  ] as const) {
    for (let h = 0; h < 360; h += 5) {
      const hex = oklchToHex(L, C, h);
      if (hex) out.push(hex);
    }
  }
  return out;
})();

/**
 * The colour for a new theme: the palette colour farthest from every existing theme while one is
 * at least MIN_THEME_DISTANCE away; otherwise the generated colour farthest from them all.
 */
export function distinctThemeColor(existing: readonly string[], palette: readonly string[]): string {
  const used = existing.filter((c) => hexToOklab(c));
  const best = (list: readonly string[]) =>
    list.reduce<{ color: string; d: number } | null>((acc, c) => {
      const d = nearest(c, used);
      return !acc || d > acc.d + 1e-9 ? { color: c, d } : acc;
    }, null);
  const fromPalette = best(palette);
  if (fromPalette && fromPalette.d >= MIN_THEME_DISTANCE) return fromPalette.color;
  const generated = best(GENERATED);
  return (generated && (!fromPalette || generated.d > fromPalette.d) ? generated : fromPalette)?.color ?? palette[0] ?? '#52796f';
}
