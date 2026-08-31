/**
 * Dismissing floating UI.
 *
 * Every menu, palette and properties strip in the workspace closes the same way — click anywhere
 * that is not inside it, or press Escape. Sharing one implementation is what keeps that promise
 * honest: a popover added later cannot accidentally be the one that stays on screen because
 * somebody forgot to write its outside-click handler.
 *
 * `pointerdown` rather than `click`, deliberately. A click fires only after the button is
 * released, so a menu would linger through the whole press of whatever the reader is reaching
 * for next; and a drag that starts outside the menu never produces a click at all, which left
 * menus stranded over the page while it was being marked up.
 */

import { RefObject, useEffect } from 'react';

export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onDismiss: () => void,
  /**
   * Elements that count as "inside" even though they are not children of `ref`.
   *
   * The properties strip needs this. It describes the selected mark, and the mark's own drag and
   * resize handles live on the page rather than in the strip — so without an exemption, reaching
   * for a handle would deselect the mark and take the handle away before the drag could begin.
   * Capture-phase listeners cannot be stopped by the handles themselves, which is why the
   * exemption has to be declared here rather than by calling `stopPropagation` down there.
   */
  ignoreSelector?: string
): void {
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && ref.current?.contains(target)) return;
      if (
        ignoreSelector &&
        target instanceof Element &&
        target.closest(ignoreSelector)
      ) {
        return;
      }
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, isOpen, onDismiss, ignoreSelector]);
}
