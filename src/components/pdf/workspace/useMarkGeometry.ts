/**
 * Marks grouped by page, and the selected mark's on-screen box kept current while the page scrolls
 * (moved verbatim from PdfWorkspace).
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Annotation, annotationBounds } from '../annotationModel';

export interface UseMarkGeometryDeps {
  annotations: Annotation[];
  editingId: string;
  focusMode: boolean;
  scale: number;
  scrollRef: React.RefObject<HTMLDivElement>;
  selectedId: string;
}

export function useMarkGeometry(deps: UseMarkGeometryDeps) {
  const { annotations, editingId, focusMode, scale, scrollRef, selectedId } = deps;

  const byPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of annotations) {
      const list = map.get(a.page);
      if (list) list.push(a);
      else map.set(a.page, [a]);
    }
    return map;
  }, [annotations]);

  /**
   * The selected mark's rectangle in viewport coordinates, for placing its properties menu.
   *
   * Re-measured on scroll and zoom rather than captured once, so the menu tracks the mark instead
   * of being left behind on the page. Capture phase is needed to see the viewer's own scroll
   * container, whose scroll events do not bubble.
   */
  const selectedMark = selectedId ? annotations.find((a) => a.id === selectedId) : undefined;
  const [markRect, setMarkRect] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!selectedMark) {
      setMarkRect(null);
      return;
    }
    const measure = () => {
      const pageEl = scrollRef.current?.querySelector<HTMLElement>(`[data-page-number="${selectedMark.page}"]`);
      const bounds = annotationBounds(selectedMark);
      if (!pageEl || !bounds) {
        setMarkRect(null);
        return;
      }
      const box = pageEl.getBoundingClientRect();
      setMarkRect({
        left: box.left + bounds.x * box.width,
        top: box.top + bounds.y * box.height,
        right: box.left + (bounds.x + bounds.w) * box.width,
        bottom: box.top + (bounds.y + bounds.h) * box.height
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [selectedMark, scale]);

  const editing = editingId ? annotations.find((a) => a.id === editingId) : undefined;
  // The viewer's top edge: popovers above a passage must not climb over the toolbar. Read at
  // render, which every popover move already causes (anchor and mark rect are state).
  // In focus mode the toolbar slides over the page when called, so menus keep clear of where it lands.
  const popoverTopInset = focusMode
    ? (document.querySelector<HTMLElement>('.focus-chrome')?.offsetHeight ?? 0)
    : (scrollRef.current?.getBoundingClientRect().top ?? 0);

  return { byPage, editing, markRect, popoverTopInset, selectedMark };
}
