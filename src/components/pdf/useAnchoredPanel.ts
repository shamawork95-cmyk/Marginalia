/**
 * Keeping a floating panel inside the window.
 *
 * Both the selection menu and the properties strip are positioned from something on the page —
 * a passage, a mark — and both used a hard-coded guess at their own width to stay on screen. That
 * guess was wrong the moment a panel grew: the bracket strip carries a palette, four weights,
 * three dash styles and two directions, and ran off the right edge of the window with its last
 * controls unreachable.
 *
 * So the panel is measured instead of guessed. It renders once at its preferred position, is
 * measured before the browser paints, and is nudged back inside the viewport if it does not fit —
 * flipping above its anchor when there is no room below. Measuring in a layout effect rather than
 * an ordinary one is what keeps that correction from being visible as a flicker.
 */

import { RefObject, useLayoutEffect, useState } from 'react';

/** Breathing room between a panel and the window edge. */
const MARGIN = 8;

export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
}

export function useAnchoredPanel(
  ref: RefObject<HTMLElement | null>,
  anchor: AnchorRect | null,
  /** Anything that changes the panel's own size, so it is re-measured when its contents change. */
  deps: unknown[] = []
): { left: number; top: number; visibility: 'hidden' | 'visible' } {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) {
      setPosition(null);
      return;
    }

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const maxLeft = window.innerWidth - width - MARGIN;
      const maxTop = window.innerHeight - height - MARGIN;

      // Below the anchor by preference, above it when that would overflow the bottom. The flip
      // is what keeps a panel off a mark near the foot of the page from being pushed up over the
      // mark it describes.
      const below = anchor.bottom + height + MARGIN <= window.innerHeight;
      const top = below ? anchor.bottom + MARGIN : anchor.top - height - MARGIN;

      setPosition({
        left: Math.max(MARGIN, Math.min(anchor.left, Math.max(MARGIN, maxLeft))),
        top: Math.max(MARGIN, Math.min(top, Math.max(MARGIN, maxTop)))
      });
    };

    measure();
    // A window resize can leave a panel hanging off an edge it used to fit inside.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, anchor?.left, anchor?.top, anchor?.bottom, ...deps]);

  return {
    left: position?.left ?? (anchor?.left ?? 0),
    top: position?.top ?? (anchor?.bottom ?? 0),
    // Hidden for the single frame between mounting and being measured, so a panel is never seen
    // at the wrong place before it is corrected.
    visibility: position ? 'visible' : 'hidden'
  };
}
