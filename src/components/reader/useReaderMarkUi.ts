/**
 * The selected mark's on-screen box, the selection menu following its passage, scrolling to a mark,
 * and the one stable set of actions every paragraph is given (moved verbatim from ReaderScreen).
 */

import type { TextSpreadHandle } from '../TextSpread';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { type TextMark } from '../../utils/textMarks';
import { SelectionAnchor } from '../pdf/SelectionPopover';
import { Tab, ParagraphActions } from './readerParts';

export interface UseReaderMarkUiDeps {
  spreadHandle: React.RefObject<TextSpreadHandle | null>;
  activeControlTab: Tab;
  createParagraphNote: (paraIdx: number) => void;
  deleteMark: (id: string) => void;
  handleSwitchTab: (newTab: Tab) => void;
  isPanelOpen: boolean;
  marks: TextMark[];
  reduceMotion: boolean;
  select: (ids: Iterable<string>, opts?: { additive?: boolean; }) => void;
  selectedIds: string[];
  selectionAnchor: SelectionAnchor;
  setActiveParagraphIndex: React.Dispatch<React.SetStateAction<number>>;
  setHoveredId: React.Dispatch<React.SetStateAction<string>>;
  setOpenPin: React.Dispatch<React.SetStateAction<string>>;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<SelectionAnchor>>;
  showInlineNotes: boolean;
  startEditing: (id: string) => void;
  textRef: React.RefObject<HTMLElement>;
}

export function useReaderMarkUi(deps: UseReaderMarkUiDeps) {
  const { spreadHandle, activeControlTab, createParagraphNote, deleteMark, handleSwitchTab, isPanelOpen, marks, reduceMotion, select, selectedIds, selectionAnchor, setActiveParagraphIndex, setHoveredId, setOpenPin, setSelectionAnchor, showInlineNotes, startEditing, textRef } = deps;

  /** The selected mark's on-screen box, kept current while the page scrolls. */
  const [markRect, setMarkRect] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const selectedKey = selectedIds.join(' ');
  useEffect(() => {
    if (!selectedKey) {
      setMarkRect(null);
      return;
    }
    const measure = () => {
      const root = textRef.current;
      if (!root) return setMarkRect(null);
      const ids = selectedKey.split(' ');
      let els = ids.flatMap((id) => Array.from(root.querySelectorAll<HTMLElement>(`[data-mark-ids~="${id}"]`)));
      if (els.length === 0) els = ids.flatMap((id) => Array.from(root.querySelectorAll<HTMLElement>(`[data-note-card="${id}"]`)));
      const rects = els.flatMap((el) => Array.from(el.getClientRects()));
      if (rects.length === 0) return setMarkRect(null);
      const next = {
        left: Math.min(...rects.map((r) => r.left)),
        top: Math.min(...rects.map((r) => r.top)),
        right: Math.max(...rects.map((r) => r.right)),
        bottom: Math.max(...rects.map((r) => r.bottom))
      };
      // An unchanged box is not a new state: no re-render of the strip for a scroll that moved nothing.
      setMarkRect((prev) =>
        prev && prev.left === next.left && prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom ? prev : next
      );
    };
    measure();
    // Once per frame at most, however many scroll events a frame brings.
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [selectedKey, marks, showInlineNotes, isPanelOpen]);

  // The selection menu follows its passage when the page scrolls under it.
  useEffect(() => {
    if (!selectionAnchor) return;
    let frame = 0;
    const follow = () => {
      frame = 0;
      const sel = window.getSelection();
      const rect = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if (!rect || rect.width + rect.height <= 0) return;
      setSelectionAnchor((prev) =>
        prev && prev.left === rect.left && prev.top === rect.top && prev.bottom === rect.bottom
          ? prev
          : { left: rect.left, top: rect.top, bottom: rect.bottom }
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(follow);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, true);
    };
    // Re-subscribed only when a menu opens or closes, not on every move it makes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(selectionAnchor)]);

  /** Brings a mark into view. False while its text is not on screen yet, so the navigator retries. */
  const scrollToMark = useCallback(
    (id: string): boolean => {
      if (activeControlTab !== 'notes') {
        handleSwitchTab('notes');
        return false;
      }
      const root = textRef.current;
      const el =
        root?.querySelector<HTMLElement>(`[data-mark-ids~="${id}"]`) ??
        root?.querySelector<HTMLElement>(`[data-note-card="${id}"]`) ??
        null;
      if (!el) return false;
      if (spreadHandle.current) {
        spreadHandle.current.showElement(el);
        return true;
      }
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeControlTab, reduceMotion]
  );
  // The latest one, for retries started from a tab that is about to unmount (the excerpt board).
  const scrollToMarkRef = useRef(scrollToMark);
  scrollToMarkRef.current = scrollToMark;

  /**
   * What a paragraph can do, as one object that never changes: each call reads the latest
   * handlers from a ref, so a memoised paragraph is not re-rendered just because a handler was.
   */
  const handlersRef = useRef({ startEditing, deleteMark, createParagraphNote, select });
  handlersRef.current = { startEditing, deleteMark, createParagraphNote, select };
  const paragraphActions = useMemo<ParagraphActions>(
    () => ({
      // Clicking marked words selects the topmost visible mark there (not while selecting text).
      markClick: (e, id) => {
        if (window.getSelection()?.toString().trim()) return;
        e.stopPropagation();
        handlersRef.current.select([id]);
      },
      hover: (id) => setHoveredId(id),
      edit: (id) => handlersRef.current.startEditing(id),
      remove: (id) => handlersRef.current.deleteMark(id),
      togglePin: (id) => setOpenPin(id),
      addNote: (idx) => handlersRef.current.createParagraphNote(idx),
      activate: (idx) => setActiveParagraphIndex(idx)
    }),
    []
  );

  return { markRect, paragraphActions, scrollToMark, scrollToMarkRef };
}
