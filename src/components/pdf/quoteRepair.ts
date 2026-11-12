/**
 * Repairing quotes that picked up the app's own menus (fixed for new marks in 2.8.0).
 *
 * Before 2.8.0 a PDF mark's quote was `Selection.toString()`, so a drag begun beside a line saved
 * the sidebar's and toolbar's labels ("SEARCH Marginalia • Annotator … THEME Key Concepts …") in
 * front of the passage, and they went on into the marks panel, search and every export.
 *
 * When a PDF opens, marks whose quote shows that chrome are repaired once (a repaired quote no
 * longer matches, so nothing is done twice). The new quote is rebuilt from pdf.js's own text items
 * under the mark's rectangles; failing that, the known chrome is stripped; failing that too, the
 * mark keeps its quote and is flagged `needsReview`. Pure, so it is tested; the workspace backs the
 * marks up before writing anything (see PdfWorkspace).
 */

export interface FractionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A pdf.js text item, already placed on the page as fractions of its width and height (top-left origin). */
export interface PlacedTextItem {
  str: string;
  box: FractionRect;
  /** The item ends a line. */
  eol?: boolean;
}

/** The app's fixed labels a stray selection could reach, in the case they are drawn. */
const CHROME_LABELS = [
  'Marginalia • Annotator',
  'For close readers,',
  'Built with care by',
  'Shama Iqbal Hussain.',
  'MY COLLECTIONS',
  'ADD DOCUMENT',
  'SEND FEEDBACK',
  'SETTINGS',
  'SEARCH',
  'THEME',
  'Untagged',
  'Tagging as'
];

/** Whether a quote carries app chrome: the sidebar credit, or two or more fixed labels. */
export function looksLikeAppChrome(quote: string): boolean {
  if (!quote) return false;
  if (quote.includes('Marginalia • Annotator') || quote.includes('Built with care by')) return true;
  return CHROME_LABELS.filter((l) => new RegExp(`(^|\\s)${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(quote)).length >= 2;
}

/** The quote with the chrome removed: every fixed label and the theme names that sat beside them. */
export function stripAppChrome(quote: string, themeNames: string[]): string {
  let out = quote;
  for (const label of [...CHROME_LABELS, ...themeNames].sort((a, b) => b.length - a.length)) {
    out = out.split(label).join(' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

const overlapY = (a: FractionRect, b: FractionRect) => Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * The words under `rects`: each item's characters whose centre lies inside a rect it shares at
 * least half its height with. Characters are spaced evenly across the item's width, which is how
 * pdf.js lays out the text layer too. Lines join with a space.
 */
export function quoteFromTextItems(items: PlacedTextItem[], rects: FractionRect[]): string {
  const parts: string[] = [];
  let lastLineY: number | null = null;
  for (const item of items) {
    if (!item.str) continue;
    const rect = rects.find((r) => overlapY(r, item.box) >= item.box.h * 0.5);
    if (!rect) continue;
    const chars = Array.from(item.str);
    const step = item.box.w / Math.max(1, chars.length);
    let taken = '';
    chars.forEach((ch, i) => {
      const cx = item.box.x + step * (i + 0.5);
      if (cx >= rect.x && cx <= rect.x + rect.w) taken += ch;
    });
    if (!taken) continue;
    const newLine = lastLineY !== null && Math.abs(item.box.y - lastLineY) > item.box.h * 0.5;
    if (parts.length && newLine && !/\s$/.test(parts[parts.length - 1])) parts.push(' ');
    parts.push(taken);
    lastLineY = item.box.y;
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export type QuoteRepair = { quote: string } | { needsReview: true };

/**
 * What to do with one mark's quote: a rebuilt quote, a stripped one, or a review flag. Null when
 * the quote is fine.
 */
export function repairQuote(
  quote: string | undefined,
  rebuilt: string | null,
  themeNames: string[]
): QuoteRepair | null {
  if (!quote || !looksLikeAppChrome(quote)) return null;
  if (rebuilt && !looksLikeAppChrome(rebuilt)) return { quote: rebuilt };
  const stripped = stripAppChrome(quote, themeNames);
  if (stripped && !looksLikeAppChrome(stripped)) return { quote: stripped };
  return { needsReview: true };
}
