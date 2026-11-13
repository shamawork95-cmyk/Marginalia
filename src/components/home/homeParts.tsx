/**
 * My Collections' small parts: the tab-change animation classes and the expandable row that peeks at
 * one book's marks under a theme or terminology (moved verbatim from HomeScreen).
 */

import React, { useEffect, useState } from 'react';
import { ChevronRight } from '../icons';
import { fetchAnnotations, type Annotation } from '../../utils/documentStorage';
import {
  groupHeads,
  migrateTextEntries,
  sortTextMarks,
  type TextMark
} from '../../utils/textMarks';
import { plural } from '../../utils/plural';
import { hasTheme } from '../../utils/markThemes';

/**
 * The two tab entrances, written out in full.
 *
 * Tailwind generates classes by scanning the source, so a class name assembled at runtime never
 * reaches the stylesheet. Both directions have to appear literally for either to exist.
 */
export const TAB_IN_FORWARD = 'motion-safe:animate-[tab-in-forward_220ms_var(--ease-out)]';
export const TAB_IN_BACK = 'motion-safe:animate-[tab-in-back_220ms_var(--ease-out)]';

/**
 * A book listed under a theme, with a caret that peeks at what is actually filed under it.
 *
 * The count answers "how much"; it does not answer "which passages", which is what a reader
 * scanning a theme wants before opening a 400-page book. The marks are fetched only when the
 * caret is pressed — the library list carries metadata, not annotations, and reading every
 * document's marks up front to fill a row nobody expanded would be waste.
 */
/** A text-document mark as a drilldown row: located by paragraph, since it has no page. */
export const textRows = (marks: TextMark[]): Annotation[] => {
  const sorted = sortTextMarks(marks);
  return groupHeads(sorted).map((head) => ({
    ...head,
    paragraph: head.anchor.paragraphIndex + 1,
    // A mark across paragraphs reads as one passage: every range's words, in order.
    quote: (head.groupId ? sorted.filter((m) => m.groupId === head.groupId) : [head])
      .map((m) => m.quote)
      .filter(Boolean)
      .join(' '),
    page: undefined
  }));
};

export const MarkPeekRow: React.FC<{
  docId: string;
  title: string;
  count: number;
  /** Null for terminology, which is a flag on a mark rather than a theme. */
  themeId: string | null;
  onOpen: () => void;
}> = ({ docId, title, count, themeId, onOpen }) => {
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<Annotation[] | null>(null);

  useEffect(() => {
    if (!open || marks) return;
    let cancelled = false;
    void fetchAnnotations(docId).then((stored) => {
      if (cancelled || !stored) return;
      const keep = (a: { isTerminology?: unknown; themeId?: unknown; themeIds?: unknown; id: string }) =>
        themeId === null ? a.isTerminology === true : hasTheme(a, themeId);
      // Text documents store a mark across several paragraphs as one range per paragraph; the
      // header count is per mark, so the rows are too (one per group, in reading order).
      const { marks: text, others } = migrateTextEntries(stored.annotations);
      setMarks([...others.filter(keep), ...textRows(text.filter(keep))]);
    });
    return () => {
      cancelled = true;
    };
  }, [open, marks, docId, themeId]);

  /** The words a mark stands for: the passage it covers, what was written on it, or what it is. */
  const words = (a: Annotation) => {
    const quote = typeof a.quote === 'string' ? a.quote.trim() : '';
    const text = typeof a.text === 'string' ? a.text.trim() : '';
    const where = a.paragraph ? `in paragraph ${String(a.paragraph)}` : `on page ${String(a.page ?? '?')}`;
    return quote || text || `${String(a.kind ?? 'Mark')} ${where}`;
  };

  return (
    <li>
      <div className="flex items-center gap-1 py-1.5 text-[12px]">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 text-left truncate pr-2 font-serif text-stone-700 dark:text-stone-300 hover:text-gold transition-colors cursor-pointer"
        >
          {title}
        </button>
        <span className="font-spine text-[11px] tabular-nums text-muted shrink-0">
          {plural(count, 'mark')}
        </span>
        <button
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
          aria-label={open ? `Hide marks in ${title}` : `Show marks in ${title}`}
          title={open ? 'Hide these marks' : 'Show these marks'}
          className="p-1 rounded-md text-muted hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer transition-colors shrink-0"
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {open && (
        <ul className="pb-1.5 ml-1 pl-2 space-y-0.5 border-l border-stone-200 dark:border-stone-800">
          {marks === null ? (
            <li className="text-[11.5px] text-muted pl-2 py-1">Reading…</li>
          ) : marks.length === 0 ? (
            <li className="text-[11.5px] text-muted pl-2 py-1">Nothing filed here any more.</li>
          ) : (
            <>
              {marks.slice(0, 4).map((a) => (
                <li key={String(a.id)}>
                  <button
                    type="button"
                    onClick={onOpen}
                    className="w-full text-left pl-2 pr-1 py-1 rounded-md text-[11.5px] text-stone-600 dark:text-stone-400 hover:bg-stone-500/[0.07] hover:text-stone-900 dark:hover:text-stone-100 cursor-pointer transition-colors line-clamp-2"
                  >
                    <span className="text-muted tabular-nums mr-1.5">{a.paragraph ? `¶${String(a.paragraph)}` : `p${String(a.page ?? '?')}`}</span>
                    {words(a)}
                  </button>
                </li>
              ))}
              {marks.length > 4 && (
                <li className="pl-2 py-1">
                  <button
                    type="button"
                    onClick={onOpen}
                    className="text-[11px] font-semibold text-gold hover:underline cursor-pointer"
                  >
                    {marks.length - 4} more — open the book
                  </button>
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </li>
  );
};
