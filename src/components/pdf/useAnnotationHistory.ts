/**
 * Undo and redo for the whole annotation set.
 *
 * History is kept over the ANNOTATION LIST rather than per tool, which is what makes "every tool
 * undoable" true by construction: drawing a shape, moving one, recolouring one, writing a note,
 * changing a dash pattern and erasing are all the same operation as far as this is concerned —
 * one list replaced another — so no tool can be added later that forgets to be undoable.
 *
 * Snapshots are whole lists rather than diffs. Annotations are small plain objects and a document
 * rarely holds more than a few hundred, so the memory cost is trivial next to the complexity of
 * inverting every possible edit correctly.
 */

import { useCallback, useRef, useState } from 'react';
import { Annotation } from './annotationModel';

/** How many steps back the reader can go. Deep enough for a session, bounded so it cannot grow. */
const HISTORY_LIMIT = 100;

export interface AnnotationHistory {
  annotations: Annotation[];
  /** Records an undoable change. Accepts a value or an updater, like `setState`. */
  commit: (next: Annotation[] | ((prev: Annotation[]) => Annotation[])) => void;
  /**
   * Replaces the list WITHOUT recording a step, and clears the history.
   *
   * Used when a document's marks are read from disk. Without this the reader could undo past the
   * moment the document opened and wipe every mark they had ever made in it — an undo stack must
   * never reach back further than the session that filled it.
   */
  reset: (next: Annotation[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useAnnotationHistory(): AnnotationHistory {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // The stacks live in refs, not state: they are read and written inside the same callback that
  // sets the list, and a stale render-time copy would drop steps made in quick succession.
  const past = useRef<Annotation[][]>([]);
  const future = useRef<Annotation[][]>([]);
  const present = useRef<Annotation[]>([]);

  const sync = useCallback(() => {
    setCanUndo(past.current.length > 0);
    setCanRedo(future.current.length > 0);
  }, []);

  const commit = useCallback(
    (next: Annotation[] | ((prev: Annotation[]) => Annotation[])) => {
      const previous = present.current;
      const value = typeof next === 'function' ? (next as (p: Annotation[]) => Annotation[])(previous) : next;
      // An edit that changed nothing must not consume an undo step, or the reader presses undo
      // and watches nothing happen. Most no-op edits arrive as a fresh array of the very same
      // objects — `prev.map(...)` over a list where no element matched — so identity per element
      // catches them without a deep comparison.
      if (value === previous) return;
      if (
        value.length === previous.length &&
        value.every((mark, index) => mark === previous[index])
      ) {
        return;
      }

      past.current = [...past.current, previous].slice(-HISTORY_LIMIT);
      future.current = [];
      present.current = value;
      setAnnotations(value);
      sync();
    },
    [sync]
  );

  const reset = useCallback(
    (next: Annotation[]) => {
      past.current = [];
      future.current = [];
      present.current = next;
      setAnnotations(next);
      sync();
    },
    [sync]
  );

  const undo = useCallback(() => {
    const previous = past.current[past.current.length - 1];
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [present.current, ...future.current].slice(0, HISTORY_LIMIT);
    present.current = previous;
    setAnnotations(previous);
    sync();
  }, [sync]);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, present.current].slice(-HISTORY_LIMIT);
    present.current = next;
    setAnnotations(next);
    sync();
  }, [sync]);

  return { annotations, commit, reset, undo, redo, canUndo, canRedo };
}
