/**
 * The zoom that fits a view's whole set of pages in the window: one page, the two-page book, or
 * the 2×2 and 3×2 grids. Pure, so it is tested.
 */

import type { PdfViewMode } from '../../../utils/documentStorage';

/** The row/column gap between pages (`gap-5`, 1.25rem). */
export const PAGE_GAP_PX = 20;
/** The scroll area's side padding the pages sit inside (24px each side). */
export const AREA_PAD_X = 48;
/** Its top and bottom padding. */
export const AREA_PAD_Y = 40;

export function viewGrid(mode: PdfViewMode): { cols: number; rows: number } {
  if (mode === 'grid6') return { cols: 3, rows: 2 };
  if (mode === 'grid4') return { cols: 2, rows: 2 };
  if (mode === 'spread') return { cols: 2, rows: 1 };
  return { cols: 1, rows: 1 };
}

/**
 * The scale at which `mode`'s pages fit `area`. `page` is a page's size at scale 1.
 * `whole`: fit the height too (Fit page; always for the book and the grids). Without it one page
 * fits the width only (Fit width), as a single scrolling page reads best.
 */
export function fitScale(
  mode: PdfViewMode,
  page: { width: number; height: number },
  area: { width: number; height: number },
  whole = mode !== 'single'
): number {
  const { cols, rows } = viewGrid(mode);
  const across = (area.width - AREA_PAD_X - (cols - 1) * PAGE_GAP_PX) / (cols * page.width);
  if (!whole) return across;
  const down = (area.height - AREA_PAD_Y - (rows - 1) * PAGE_GAP_PX) / (rows * page.height);
  return Math.min(across, down);
}
