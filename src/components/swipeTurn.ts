/**
 * Swipe to turn pages in the two-page spread (text reader and PDF book), beside the arrow buttons
 * and keys (2.8.0): a finger or pen flicked sideways across the book, or a two-finger sideways
 * swipe on a trackpad. A mouse drag stays a text selection; so does any swipe that ends with text
 * selected. Swiping left (towards the spine) turns forward, as in a paper book.
 */

import { useEffect, type RefObject } from 'react';

/** Below this the movement was a tap or a wobble, not a swipe (a clear sideways movement). */
export const SWIPE_MIN_PX = 60;
/** A swipe slower than this is a drag. */
export const SWIPE_MAX_MS = 800;
/** Sideways trackpad scrolling, summed, that counts as one swipe. */
export const WHEEL_SWIPE_PX = 90;
/** After a turn, further sideways scrolling is the same gesture's momentum, not a second swipe. */
export const WHEEL_COOLDOWN_MS = 700;

/** +1 next, -1 previous, 0 not a swipe. Mostly sideways, far enough, quick enough. */
export function swipeStep(dx: number, dy: number, ms: number): -1 | 0 | 1 {
  if (ms > SWIPE_MAX_MS || Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 1.5 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Turns `step` pages when the element under `ref` is swiped. `enabled` false detaches it.
 * `blocked` (read at the moment of the gesture) is true while a swipe must not turn, such as a
 * drawing tool being armed; text being selected always blocks it.
 */
export function useSwipeTurn(
  ref: RefObject<HTMLElement | null>,
  onStep: (step: 1 | -1) => void,
  enabled = true,
  blocked?: () => boolean
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; t: number; id: number } | null = null;
    let wheel = 0;
    let wheelTimer = 0;
    let cooldownUntil = 0;
    const selecting = () => Boolean(window.getSelection()?.toString().trim());

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !e.isPrimary || blocked?.() || selecting()) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const step = swipeStep(e.clientX - start.x, e.clientY - start.y, performance.now() - start.t);
      start = null;
      if (step && !selecting() && !blocked?.()) onStep(step);
    };
    const onCancel = () => (start = null);
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (blocked?.() || selecting()) return;
      const now = performance.now();
      if (now < cooldownUntil) return;
      wheel += e.deltaX;
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => (wheel = 0), 200);
      if (Math.abs(wheel) < WHEEL_SWIPE_PX) return;
      onStep(wheel > 0 ? 1 : -1);
      wheel = 0;
      cooldownUntil = now + WHEEL_COOLDOWN_MS;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.clearTimeout(wheelTimer);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('wheel', onWheel);
    };
  }, [ref, onStep, enabled, blocked]);
}
