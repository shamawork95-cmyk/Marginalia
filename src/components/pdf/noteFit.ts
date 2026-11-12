/**
 * Fitting a sticky note's or text box's words into its box in an exported PDF, without ever
 * dropping any (before 2.9, lines past the box's height were cut silently, mid-sentence).
 *
 * The text shrinks in half-point steps to a readable floor. If it still does not fit, the box keeps
 * as many lines as it can, its last line says where the rest went, and the whole text goes on a
 * "Notes continued" page at the end of the export. Pure (the measurer is passed in), so it is tested.
 */

/** Width of `text` at `size` points, in points. */
export type Measure = (text: string, size: number) => number;

/** Greedy word wrap; explicit line breaks are kept. A word longer than the width gets a line to itself. */
export function wrapLines(text: string, size: number, widthPt: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate, size) > widthPt) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export interface FitOptions {
  widthPt: number;
  heightPt: number;
  /** The size the text would like. */
  size: number;
  /** Never smaller than this. */
  minSize: number;
  /** Line height as a multiple of the size. */
  lineFactor: number;
  /** The last line when the text runs over, e.g. "… continued in Notes, p. 12". */
  continuation: string;
}

export interface FittedText {
  size: number;
  lineHeight: number;
  lines: string[];
  /** True when the box could not hold it all: the full text belongs on the notes page. */
  overflow: boolean;
}

export function fitText(text: string, o: FitOptions, measure: Measure): FittedText {
  const words = text.trim();
  for (let size = o.size; size >= o.minSize - 1e-9; size = Math.round((size - 0.5) * 2) / 2) {
    const lines = wrapLines(words, size, o.widthPt, measure);
    const lineHeight = size * o.lineFactor;
    if (lines.length * lineHeight <= o.heightPt + 1e-6) return { size, lineHeight, lines, overflow: false };
  }
  const size = o.minSize;
  const lineHeight = size * o.lineFactor;
  const all = wrapLines(words, size, o.widthPt, measure);
  const room = Math.max(1, Math.floor((o.heightPt + 1e-6) / lineHeight));
  // The continuation takes the last line that fits; at least the first line of text stays above it.
  const kept = room >= 2 ? all.slice(0, room - 1) : [];
  return { size, lineHeight, lines: [...kept, o.continuation], overflow: true };
}
