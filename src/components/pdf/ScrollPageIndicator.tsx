/**
 * The page number that rides the scrollbar.
 *
 * Scrolling a seven-hundred-page book by dragging is a guess: the bar moves, pages blur past, and
 * the only page number on screen is in the toolbar at the top, nowhere near the hand doing the
 * work. This puts the number where the eye already is — beside the scrollbar, at the scroll
 * position — and takes it away again once the reader stops.
 *
 * It reads the container's own scroll offset rather than which page is intersecting the viewport,
 * because during a fast drag pages are unrendered placeholders and intersection lags badly behind
 * the thumb. Position in the scroll range is instant and always right.
 */

import React, { useEffect, useRef, useState } from 'react';

interface ScrollPageIndicatorProps {
  /** The element that scrolls. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  pageCount: number;
  isDark?: boolean;
}

/** How long the indicator lingers after the last scroll event. */
const LINGER_MS = 900;

export const ScrollPageIndicator: React.FC<ScrollPageIndicatorProps> = ({
  containerRef,
  pageCount,
  isDark = false
}) => {
  const [state, setState] = useState<{ page: number; offset: number } | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || pageCount === 0) return;

    const onScroll = () => {
      const scrollable = container.scrollHeight - container.clientHeight;
      if (scrollable <= 0) return;
      const progress = Math.min(1, Math.max(0, container.scrollTop / scrollable));

      // Which page the top of the viewport is looking at, rather than which fraction of the
      // document has gone by — the difference matters at the very end, where the last screenful
      // covers several pages and the reader is still on the second-to-last.
      const page = Math.min(pageCount, Math.max(1, Math.round(progress * (pageCount - 1)) + 1));

      // Tracked against the container's own box so the pill sits beside the thumb wherever the
      // viewer is on screen, not against the window.
      const box = container.getBoundingClientRect();
      setState({ page, offset: box.top + progress * (box.height - 40) + 8 });

      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setState(null), LINGER_MS);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [containerRef, pageCount]);

  if (!state) return null;

  const container = containerRef.current;
  const right = container ? window.innerWidth - container.getBoundingClientRect().right + 14 : 14;

  return (
    <div
      className={`fixed z-40 px-2.5 py-1 rounded-lg text-[12px] font-semibold tabular-nums select-none shadow-lg border pointer-events-none transition-opacity ${
        isDark
          ? 'bg-[#232a26] border-stone-700 text-stone-100'
          : 'bg-white/95 border-stone-200 text-stone-800'
      }`}
      style={{ top: state.offset, right }}
      aria-hidden
    >
      {state.page} / {pageCount}
    </div>
  );
};
