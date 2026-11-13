/**
 * The annotation layer's constants and colour helpers (moved verbatim from AnnotationLayer).
 */


/** True for colours light enough that dark ink reads better on them than light. */
export function isDarkFill(hex: string): boolean {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const n = parseInt(full || '000000', 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance < 0.6;
}

/** '#rrggbb' with an alpha channel, for the translucent note fill. */
export function withAlpha(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const n = parseInt(full || '000000', 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}

/** Fallback weight for marks made before thickness was configurable. */
export const DEFAULT_WEIGHT = 0.0028;

/** A bracket's width when the reader drags straight down without spreading it out. */
export const DEFAULT_BRACKET_WIDTH = 0.02;

/**
 * How far the pointer must travel before a press on a mark becomes a drag.
 *
 * Below this it is a click, and the mark is selected without being moved. Clicking a sticky note
 * to read it should not shift it by the two or three pixels a hand moves while pressing a button.
 */
export const DRAG_THRESHOLD_PX = 4;

/** How a mark being manipulated is being changed. */
export type GestureMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'from' | 'to';
