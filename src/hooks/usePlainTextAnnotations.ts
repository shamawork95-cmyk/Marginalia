/**
 * Server-backed, docId-keyed annotations for the text reader (TXT, EPUB, DOCX).
 *
 * A thin React wrapper over `createTextAnnotationSession`, which owns the rules: marks in the
 * `utils/textMarks` model (older notes and formats converted on read, written in the new shape
 * only after the first edit), the shared 100-step undo history, the 700ms debounced save (flushed
 * on unmount, on document change and on window close/reload/quit via `hooks/unloadFlush`), and
 * every entry it does not own (PDF marks) carried through untouched.
 *
 * A document that was never saved has no `docId` to key a record on. Given a `memory` key
 * instead, the same session runs against an in-memory store for this run of the app, seeded
 * with whatever older notes and formats the caller still holds for it. With neither, it returns
 * empty, no-op state.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { checkpointMarkBackup, fetchAnnotations, saveAnnotations, type Annotation as StoredEntry } from '../utils/documentStorage';
import type { ParagraphRange } from '../utils/textFormatting';
import type { NewTextMark, TextMark, TextMarkPatch } from '../utils/textMarks';
import { createTextAnnotationSession, TextAnnotationSession, TextAnnotationState } from './textAnnotationSession';
import { registerUnloadFlush } from './unloadFlush';
import type { DebouncedSaver } from './debouncedSaver';

const SAVE_DEBOUNCE_MS = 700;

/** Leaving a document: write the pending edit, then keep a mark backup of this visit (like the PDF workspace). */
export async function closeTextSession(session: TextAnnotationSession, checkpoint?: () => Promise<boolean>): Promise<void> {
  if ((await session.dispose()) && checkpoint) await checkpoint();
}

export interface PlainTextAnnotations extends TextAnnotationState {
  /** Undo/redo through the shared 100-step history. Every mark edit below is one step. */
  undo: () => void;
  redo: () => void;
  /** Marks a selection (one range per paragraph, as `rangesFromSelectionParts` returns). Linked by `groupId` when several. */
  addMarks: (ranges: ParagraphRange[], props: NewTextMark, paragraphs: string[]) => TextMark[];
  /** Edits the marks named and every other range of their groups. */
  updateMarks: (ids: Iterable<string>, patch: TextMarkPatch) => void;
  recolour: (ids: Iterable<string>, color: string) => void;
  retag: (ids: Iterable<string>, themeIds: string[]) => void;
  deleteMarks: (ids: Iterable<string>) => void;
  /** Selects whole groups; `additive` adds to the current selection (shift/cmd-click). */
  select: (ids: Iterable<string>, opts?: { additive?: boolean }) => void;
  clearSelection: () => void;
  /** One undoable edit over the whole list (links between marks). */
  commit: (fn: (prev: TextMark[]) => TextMark[]) => void;
  /** Loads a set the server just wrote (restore, import) and resets the undo history. */
  reset: (entries: StoredEntry[]) => void;
  /** Everything the document stores right now, PDF entries included. */
  entries: () => StoredEntry[];
  /** The autosave, to flush and pause around a restore or import. Null without a document. */
  saver: DebouncedSaver<StoredEntry[]> | null;
}

/** Marks of unsaved documents, for the rest of this run. */
const memoryStore = new Map<string, StoredEntry[]>();

const EMPTY_STATE: TextAnnotationState = { marks: [], isLoaded: false, canUndo: false, canRedo: false, selectedIds: [] };
const noSubscribe = () => () => {};
const noop = () => {};

export function usePlainTextAnnotations(
  docId: string | undefined,
  memory?: { key: string; seed: () => StoredEntry[] }
): PlainTextAnnotations {
  /**
   * One session per document, made inside the effect rather than memoised: StrictMode runs
   * effects twice in development, and a memoised session would be disposed by the first cleanup
   * and then ignore its own load. Tagged with its key so the render where the document changes
   * shows nothing rather than the previous document's marks.
   */
  const key = docId ?? (memory ? `memory:${memory.key}` : undefined);
  const [entry, setEntry] = useState<{ key: string; session: TextAnnotationSession } | null>(null);
  // Read once per document; the seed only matters the first time a document is opened.
  const seed = memory?.seed;

  useEffect(() => {
    if (!key) return;
    const session = docId
      ? createTextAnnotationSession({
          load: () => fetchAnnotations(docId),
          save: (entries) => saveAnnotations(docId, entries),
          delayMs: SAVE_DEBOUNCE_MS
        })
      : createTextAnnotationSession({
          load: async () => ({ annotations: memoryStore.get(key) ?? seed?.() ?? [] }),
          save: async (entries) => {
            memoryStore.set(key, entries);
            return true;
          },
          delayMs: 0
        });
    setEntry({ key, session });
    void session.load();
    const unregister = docId
      ? registerUnloadFlush(session.saver, (entries) => ({
          url: `/api/documents/${docId}/annotations`,
          body: JSON.stringify({ annotations: entries })
        }))
      : noop;
    return () => {
      unregister();
      // Writes a still-pending edit, so navigating away never loses it, then backs up the visit.
      void closeTextSession(session, docId ? () => checkpointMarkBackup(docId) : undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const session = entry && entry.key === key ? entry.session : null;
  const state = useSyncExternalStore(session ? session.subscribe : noSubscribe, session ? session.getState : () => EMPTY_STATE);

  return {
    ...state,
    undo: session ? session.undo : noop,
    redo: session ? session.redo : noop,
    addMarks: session ? session.addMarks : () => [],
    updateMarks: session ? session.updateMarks : noop,
    recolour: session ? session.recolour : noop,
    retag: session ? session.retag : noop,
    deleteMarks: session ? session.deleteMarks : noop,
    select: session ? session.select : noop,
    clearSelection: session ? session.clearSelection : noop,
    commit: session ? session.commit : noop,
    reset: session ? session.reset : noop,
    entries: session ? session.entries : () => [],
    saver: session ? session.saver : null
  };
}
