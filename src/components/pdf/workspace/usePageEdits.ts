/**
 * Inserting and deleting pages: each runs as a page operation (pending saves flushed, autosave
 * paused, marks renumbered on the server, then reloaded) (moved verbatim from PdfWorkspace).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Annotation } from '../annotationModel';
import { runPageOperation, type DebouncedSaver } from '../../../hooks/debouncedSaver';
import {
  deletePage,
  fetchAnnotations,
  insertPage,
  PageInsertHeight,
  PageInsertPlacement
} from '../../../utils/documentStorage';

export interface UsePageEditsDeps {
  currentPage: number;
  docId: string;
  goToPage: (page: number, animate?: boolean) => void;
  pageCount: number;
  pageOpBusyRef: React.RefObject<boolean>;
  resetAnnotations: (next: Annotation[]) => void;
  saver: DebouncedSaver<Annotation[]>;
  setFailure: React.Dispatch<React.SetStateAction<string>>;
  setFileVersion: React.Dispatch<React.SetStateAction<number>>;
}

export function usePageEdits(deps: UsePageEditsDeps) {
  const { currentPage, docId, goToPage, pageCount, pageOpBusyRef, resetAnnotations, saver, setFailure, setFileVersion } = deps;

  // ── Insert page ──
  const [insertPageMenuOpen, setInsertPageMenuOpen] = useState(false);
  const [insertPlacement, setInsertPlacement] = useState<PageInsertPlacement>('after');
  const [insertHeight, setInsertHeight] = useState<PageInsertHeight>('full');
  const [isInsertingPage, setIsInsertingPage] = useState(false);
  /** Set once an insert succeeds; applied by the effect below once the reloaded PDF actually
   *  reports enough pages to scroll to — reloading is asynchronous, so this can't happen inline. */
  const [pendingPageJump, setPendingPageJump] = useState<number | null>(null);

  useEffect(() => {
    if (pendingPageJump === null || pageCount < pendingPageJump) return;
    const target = pendingPageJump;
    setPendingPageJump(null);
    requestAnimationFrame(() => goToPage(target));
  }, [pendingPageJump, pageCount, goToPage]);

  /** Re-reads the marks the server just renumbered. */
  const reloadMarks = useCallback(async () => {
    const stored = await fetchAnnotations(docId);
    return stored ? ((stored.annotations as unknown as Annotation[]) || []) : null;
  }, [docId]);

  const handleInsertPage = useCallback(async () => {
    if (pageOpBusyRef.current) return;
    pageOpBusyRef.current = true;
    setIsInsertingPage(true);
    try {
      // Saves pending marks first, pauses the autosave while the server renumbers, then `reset`s
      // (not commits) the re-read marks: Undo must not put old page numbers onto the changed PDF.
      const outcome = await runPageOperation({
        saver,
        operate: () => insertPage(docId, insertPlacement, insertHeight, currentPage),
        reload: reloadMarks,
        reset: resetAnnotations
      });
      if (outcome.status === 'unsaved') {
        setFailure('Your latest marks could not be saved, so the page was not added. Try again once the Saved tick returns.');
        return;
      }
      if (outcome.status === 'failed') {
        setFailure('Could not add the page. The document was left unchanged.');
        return;
      }
      setFileVersion((v) => v + 1);
      if (!outcome.reloaded) setFailure('The page was added, but this document\'s marks could not be re-read. Reopen it before marking anything else — nothing more is saved until you do.');
      setInsertPageMenuOpen(false);
      if (outcome.result.insertedPages.length) setPendingPageJump(outcome.result.insertedPages[0]);
    } finally {
      pageOpBusyRef.current = false;
      setIsInsertingPage(false);
    }
  }, [docId, insertPlacement, insertHeight, currentPage, resetAnnotations, saver, reloadMarks]);

  /** Guards against a double-fire while a delete is in flight — the corner button's own inline
   *  confirm (see PdfPage.tsx) is the only confirmation now; there is no modal step above it. */
  const [isDeletingPage, setIsDeletingPage] = useState(false);

  const handleDeletePage = useCallback(
    async (pageNumber: number) => {
      if (isDeletingPage || pageOpBusyRef.current) return;
      pageOpBusyRef.current = true;
      setIsDeletingPage(true);
      try {
        // See `handleInsertPage`.
        const outcome = await runPageOperation({
          saver,
          operate: () => deletePage(docId, pageNumber),
          reload: reloadMarks,
          reset: resetAnnotations
        });
        if (outcome.status === 'unsaved') {
          setFailure(`Your latest marks could not be saved, so page ${pageNumber} was not deleted. Try again once the Saved tick returns.`);
          return;
        }
        if (outcome.status === 'failed') {
          setFailure(`Could not delete page ${pageNumber}. The document was left unchanged.`);
          return;
        }
        setFileVersion((v) => v + 1);
        if (!outcome.reloaded) setFailure('The page was deleted, but this document\'s marks could not be re-read. Reopen it before marking anything else — nothing more is saved until you do.');
        // The page that took the deleted one's place, or the new last page if it was the last one.
        setPendingPageJump(Math.min(pageNumber, outcome.result.pageCount));
      } finally {
        pageOpBusyRef.current = false;
        setIsDeletingPage(false);
      }
    },
    [docId, isDeletingPage, resetAnnotations, saver, reloadMarks]
  );

  return { handleDeletePage, handleInsertPage, insertHeight, insertPageMenuOpen, insertPlacement, isDeletingPage, isInsertingPage, setInsertHeight, setInsertPageMenuOpen, setInsertPlacement };
}
