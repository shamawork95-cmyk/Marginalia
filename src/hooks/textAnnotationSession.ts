/**
 * The text reader's annotation state for one document, without React.
 *
 * Holds the marks (`utils/textMarks`), the shared 100-step undo history (`hooks/historyCore`, the
 * same rules as the PDF workspace) and the debounced saver. `usePlainTextAnnotations` wraps it in
 * React; keeping it out of React is what lets the save and history rules be tested directly.
 *
 * Saving rules:
 * - Reading never writes. Older notes and formats are converted on read (`migrateTextEntries`)
 *   and reach disk in the new shape only after the reader's first edit. Before that save the store
 *   keeps the record in its old shape, once, as `{id}.json.legacy` (`{id}.json.bak` only holds the
 *   save before the latest one, so it loses the old shape after the second save).
 * - Nothing is written until the load succeeded. A document whose marks could not be read is
 *   never written over with the nothing we managed to load, and edits made then are ignored.
 * - Entries this session does not own (PDF marks, anything unrecognised) are written back as read.
 */

import type { Annotation as StoredEntry } from '../utils/documentStorage';
import type { ParagraphRange } from '../utils/textFormatting';
import {
  createTextMarks,
  deleteTextMarks,
  expandToGroups,
  migrateTextEntries,
  updateTextMarks,
  type NewTextMark,
  type TextMark,
  type TextMarkPatch
} from '../utils/textMarks';
import { createDebouncedSaver, DebouncedSaver } from './debouncedSaver';
import { emptyHistory, historyCommit, historyRedo, historyUndo, HistoryState } from './historyCore';

export interface TextAnnotationState {
  /** Every text mark; each range of a multi-paragraph mark is its own entry (see `groupId`). */
  marks: TextMark[];
  /** True once the document's marks were read. Edits before that, or after a failed read, are ignored. */
  isLoaded: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Selected mark ids, always whole groups. */
  selectedIds: string[];
}

export type TextAnnotationSession = ReturnType<typeof createTextAnnotationSession>;

export function createTextAnnotationSession(deps: {
  /** Reads the document's stored list; null when it could not be read. */
  load: () => Promise<{ annotations: StoredEntry[] } | null>;
  save: (entries: StoredEntry[]) => Promise<boolean>;
  delayMs?: number;
  now?: () => string;
  newId?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const saver: DebouncedSaver<StoredEntry[]> = createDebouncedSaver({ save: deps.save, delayMs: deps.delayMs ?? 700 });
  const listeners = new Set<() => void>();
  let history: HistoryState<TextMark> = emptyHistory([]);
  /** Entries this session does not own, written back untouched on every save. */
  let others: StoredEntry[] = [];
  let disposed = false;
  let state: TextAnnotationState = { marks: [], isLoaded: false, canUndo: false, canRedo: false, selectedIds: [] };

  const publish = (patch: Partial<TextAnnotationState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };

  /** Moves the history to `next` (null = no step), prunes the selection, and schedules a save. */
  const step = (next: HistoryState<TextMark> | null) => {
    if (!next || !state.isLoaded || disposed) return;
    history = next;
    const ids = new Set(next.present.map((m) => m.id));
    publish({
      marks: next.present,
      canUndo: next.past.length > 0,
      canRedo: next.future.length > 0,
      selectedIds: state.selectedIds.filter((id) => ids.has(id))
    });
    saver.schedule([...others, ...(next.present as unknown as StoredEntry[])]);
  };

  const commit = (next: TextMark[] | ((prev: TextMark[]) => TextMark[])) =>
    step(historyCommit(history, typeof next === 'function' ? next(history.present) : next));

  const updateMarks = (ids: Iterable<string>, patch: TextMarkPatch) =>
    commit((prev) => updateTextMarks(prev, ids, patch, now()));

  return {
    saver,
    getState: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },

    async load() {
      const stored = await deps.load();
      if (disposed || !stored) return;
      const { marks, others: rest } = migrateTextEntries(stored.annotations);
      others = rest;
      history = emptyHistory(marks);
      publish({ marks, isLoaded: true, canUndo: false, canRedo: false, selectedIds: [] });
    },

    /**
     * Replaces every mark with a set the server just wrote (a restored backup, an import) and
     * starts a fresh undo history, as page edits do: Undo must not bring back the set it replaced.
     * Writes nothing; the caller already saved it.
     */
    reset(entries: StoredEntry[]) {
      if (disposed) return;
      const { marks, others: rest } = migrateTextEntries(entries);
      others = rest;
      history = emptyHistory(marks);
      publish({ marks, isLoaded: true, canUndo: false, canRedo: false, selectedIds: [] });
    },

    /** Everything this document stores right now: other entries plus the text marks. */
    entries: (): StoredEntry[] => [...others, ...(history.present as unknown as StoredEntry[])],

    /** Stops taking edits and writes anything pending. Resolves true when nothing is left unsaved. */
    dispose() {
      disposed = true;
      return saver.flush();
    },

    commit,
    undo: () => step(historyUndo(history)),
    redo: () => step(historyRedo(history)),

    /** Marks a selection (one range per paragraph). Returns the marks made, linked by `groupId` when several. */
    addMarks(ranges: ParagraphRange[], props: NewTextMark, paragraphs: string[]): TextMark[] {
      if (!state.isLoaded || disposed || ranges.length === 0) return [];
      const made = createTextMarks(ranges, props, { paragraphs, now: now(), newId: deps.newId });
      commit((prev) => [...prev, ...made]);
      return made;
    },
    updateMarks,
    recolour: (ids: Iterable<string>, color: string) => updateMarks(ids, { color }),
    retag: (ids: Iterable<string>, themeIds: string[]) => updateMarks(ids, { themeIds }),
    deleteMarks: (ids: Iterable<string>) => {
      const list = [...ids];
      commit((prev) => deleteTextMarks(prev, list));
    },

    /** Selects the marks named and the rest of their groups; `additive` adds to the selection. */
    select(ids: Iterable<string>, opts: { additive?: boolean } = {}) {
      const picked = expandToGroups(history.present, ids);
      const base = opts.additive ? state.selectedIds : [];
      publish({ selectedIds: [...new Set([...base, ...picked])] });
    },
    clearSelection: () => publish({ selectedIds: [] })
  };
}
