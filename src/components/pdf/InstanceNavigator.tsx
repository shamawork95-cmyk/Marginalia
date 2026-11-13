/**
 * Steps through every mark in this document that matches what the reader asked to see.
 *
 * Opened by tapping a book under Key Concepts or Terminologies on the library dashboard: the
 * question there is "where are they", and dropping someone at page one of a 400-page book does
 * not answer it. The list is derived from the workspace's live annotation state rather than a
 * snapshot taken on open, so marking a new passage while this is up extends the run immediately
 * and erasing one shortens it — the count stays honest while the reader works.
 *
 * Motion is deliberately thin. This appears once per visit, so it earns a 200ms entrance; the
 * previous/next buttons are pressed repeatedly, so they animate nothing but their own press
 * feedback. Anything more would be in the reader's way by the fourth press.
 */

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, X } from '../icons';
import { AnnotationFocus } from '../../types';
import { Annotation, annotationBounds } from './annotationModel';
import { groupHeads, type TextMark } from '../../utils/textMarks';

/**
 * Marks matching the focus, in reading order. Exported for its own test.
 *
 * Takes PDF marks (ordered by page, then height on the page) or text-document marks (ordered by
 * paragraph, then character offset). A text mark covering several paragraphs is one stop, at its
 * first range, rather than one stop per paragraph.
 */
export function matchingAnnotations<T extends Annotation | TextMark>(
  annotations: T[],
  focus: AnnotationFocus
): T[] {
  const matching = annotations.filter((a) =>
    focus.kind === 'terminology' ? a.isTerminology === true : Boolean(a.themeIds?.includes(focus.themeId))
  );
  // Reading order: down the page, not creation order — someone stepping through marks is
  // walking the book, and the order they were drawn in is meaningless to that.
  const position = (a: T): [number, number] =>
    'anchor' in a ? [a.anchor.paragraphIndex, a.anchor.start] : [a.page, annotationBounds(a)?.y ?? 0];
  const heads = new Set(groupHeads(matching.filter((a): a is T & TextMark => 'anchor' in a)));
  return matching
    .filter((a) => !('anchor' in a) || heads.has(a as T & TextMark))
    .sort((a, b) => {
      const [pa, ya] = position(a);
      const [pb, yb] = position(b);
      return pa - pb || ya - yb;
    });
}

/**
 * The words a mark stands for.
 *
 * Text-anchored marks store the passage they cover (`quote`); a sticky note stores what the
 * reader wrote. A shape or a stroke has neither, so it is named by what it is and where.
 */
function preview(a: Annotation): string {
  const quote = typeof a.quote === 'string' ? a.quote.trim() : '';
  if (quote) return quote;
  const text = typeof a.text === 'string' ? a.text.trim() : '';
  if (text) return text;
  return `${a.kind.charAt(0).toUpperCase()}${a.kind.slice(1)} on page ${a.page}`;
}

interface InstanceNavigatorProps {
  focus: AnnotationFocus;
  annotations: Annotation[];
  /** Scrolls to a mark. Returns false when the page is not rendered yet, so the jump can retry. */
  onGoTo: (annotation: Annotation) => boolean | void;
  onClose: () => void;
  isDark?: boolean;
  /** Short location shown beside each listed mark. Text documents say paragraph, not page. */
  locationLabel?: (annotation: Annotation) => string;
}

const shortPage = (a: Annotation) => `p${a.page}`;

export const InstanceNavigator: React.FC<InstanceNavigatorProps> = ({
  focus,
  annotations,
  onGoTo,
  onClose,
  isDark = false,
  locationLabel = shortPage
}) => {
  const matches = React.useMemo(
    () => matchingAnnotations(annotations, focus),
    [annotations, focus]
  );
  const [index, setIndex] = React.useState(0);
  const [listOpen, setListOpen] = React.useState(false);
  const jumpedFor = React.useRef<string | null>(null);

  /**
   * Land on the first match. That jump IS the point of opening a book this way, so it retries
   * rather than being attempted once: the navigator mounts as soon as the marks load, which can
   * be before the page elements exist, and a silent miss left the reader at page one of a
   * 180-page book wondering what the pill was for.
   */
  const key = focus.kind === 'theme' ? focus.themeId : 'terminology';
  React.useEffect(() => {
    if (jumpedFor.current === key || matches.length === 0) return;

    let frame = 0;
    let attempts = 0;
    const attempt = () => {
      if (onGoTo(matches[0]) !== false) {
        jumpedFor.current = key;
        return;
      }
      // ~2s of frames. Past that the page genuinely is not coming, and retrying forever would
      // fight whatever the reader does next.
      if (++attempts < 120) frame = requestAnimationFrame(attempt);
    };
    setIndex(0);
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [key, matches, onGoTo]);

  // A mark deleted out from under the cursor must not leave the counter reading "4 of 2".
  const safeIndex = matches.length === 0 ? 0 : Math.min(index, matches.length - 1);

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (safeIndex + delta + matches.length) % matches.length;
    setIndex(next);
    onGoTo(matches[next]);
  };

  return (
    <div
      role="group"
      aria-label={`${focus.label} in this document`}
      data-instance-navigator
      className={`absolute left-1/2 bottom-5 z-30 flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-full border shadow-lg backdrop-blur-sm ${
        isDark ? 'bg-night-3/95 border-stone-700' : 'bg-white/95 border-stone-200'
      }`}
      style={{
        transform: 'translateX(-50%)',
        animation: 'instance-navigator-in 200ms cubic-bezier(0.23, 1, 0.32, 1) both'
      }}
    >
      <style>{`
        @keyframes instance-navigator-in {
          from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.98); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0)   scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-instance-navigator] { animation: none !important; }
        }
      `}</style>

      {/*
        Every match, with the words it covers.
        
        Stepping one at a time answers "show me the next one"; it does not answer "what did I
        mark in this book", which is the question a reader arriving from the library actually
        has. The list sits above the pill so the pill stays where the hand already is.
      */}
      {listOpen && matches.length > 0 && (
        <div
          className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[22rem] max-h-72 overflow-y-auto rounded-2xl border shadow-xl ${
            isDark ? 'bg-night-3 border-stone-700' : 'bg-white border-stone-200'
          }`}
        >
          <ul className="p-1.5 space-y-0.5">
            {matches.map((match, i) => (
              <li key={match.id}>
                <button
                  type="button"
                  onClick={() => {
                    setIndex(i);
                    onGoTo(match);
                  }}
                  className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                    i === safeIndex
                      ? 'bg-stone-500/[0.12]'
                      : 'hover:bg-stone-500/[0.07]'
                  }`}
                >
                  <span className="text-[10.5px] text-muted tabular-nums w-9 shrink-0 pt-0.5">
                    {locationLabel(match)}
                  </span>
                  <span className="flex-1 min-w-0 text-[12px] text-stone-700 dark:text-stone-300 line-clamp-2">
                    {preview(match)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <span
        aria-hidden
        className="w-2 h-2 rounded-[2px] shrink-0"
        style={{ backgroundColor: focus.color }}
      />
      <span className="text-[12px] font-medium text-stone-800 dark:text-stone-200 whitespace-nowrap">
        {focus.label}
      </span>
      <span className="text-[11.5px] text-muted tabular-nums whitespace-nowrap ml-1">
        {matches.length === 0 ? 'none here' : `${safeIndex + 1} of ${matches.length}`}
      </span>

      <button
        type="button"
        onClick={() => setListOpen((open) => !open)}
        disabled={matches.length === 0}
        aria-expanded={listOpen}
        aria-label={listOpen ? 'Hide the list of marks' : 'List every mark'}
        title={listOpen ? 'Hide the list' : 'List every mark'}
        className="p-1 rounded-full text-muted hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-35 disabled:cursor-default cursor-pointer transition-[transform,color] duration-150 ease-out active:scale-[0.92]"
      >
        <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-200 ${listOpen ? 'rotate-180' : ''}`} />
      </button>

      <span className="w-px h-5 bg-stone-200 dark:bg-stone-700 mx-1" aria-hidden />

      <button
        type="button"
        onClick={() => step(-1)}
        disabled={matches.length === 0}
        aria-label={`Previous ${focus.label} mark`}
        className="p-1.5 rounded-full text-muted hover:text-stone-900 dark:hover:text-white disabled:opacity-35 disabled:cursor-default cursor-pointer transition-[transform,color] duration-150 ease-out active:scale-[0.92]"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={matches.length === 0}
        aria-label={`Next ${focus.label} mark`}
        className="p-1.5 rounded-full text-muted hover:text-stone-900 dark:hover:text-white disabled:opacity-35 disabled:cursor-default cursor-pointer transition-[transform,color] duration-150 ease-out active:scale-[0.92]"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Stop stepping through marks"
        className="p-1.5 rounded-full text-muted hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer transition-[transform,color] duration-150 ease-out active:scale-[0.92]"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
