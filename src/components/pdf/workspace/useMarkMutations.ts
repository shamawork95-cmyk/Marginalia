/**
 * Creating, deleting, editing and re-filing marks (moved verbatim from PdfWorkspace).
 */

import React, { useCallback } from 'react';
import { UserSettings } from '../../../types';
import { Annotation } from '../annotationModel';
import { pickTheme } from '../../../utils/markThemes';

export interface UseMarkMutationsDeps {
  annotations: Annotation[];
  draftText: string;
  editingId: string;
  setAnnotations: (next: Annotation[] | ((prev: Annotation[]) => Annotation[])) => void;
  setDraftText: React.Dispatch<React.SetStateAction<string>>;
  setEditingId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string>>;
  settings: UserSettings;
}

export function useMarkMutations(deps: UseMarkMutationsDeps) {
  const { annotations, draftText, editingId, setAnnotations, setDraftText, setEditingId, setSelectedId, settings } = deps;

  // ── Mutations ──
  const createAnnotation = useCallback(
    (annotation: Annotation) => {
      // `annotation.weight` is already correct — AnnotationLayer sets it from the ACTIVE TOOL's
      // own weight at the moment of drawing (see `finishDrag`). Re-deriving it here from
      // `toolWeights[annotation.kind]` used to look equivalent, back when every tool wrote its
      // own matching kind — but `mask` draws an ordinary `kind: 'ink'` stroke with its own much
      // thicker weight, and looking that back up by KIND rather than by TOOL silently replaced it
      // with the plain pen's thin default the instant the stroke was created.
      setAnnotations((prev) => [...prev, { ...annotation, author: settings.name }]);
      // Whatever was just drawn stays selected, so its properties menu appears beside it and its
      // colour and thickness can be changed straight away — the way every drawing app behaves.
      setSelectedId(annotation.id);
    },
    [settings.name]
  );

  const deleteAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
    setEditingId((prev) => (prev === id ? null : prev));
  }, []);

  /** Opens the editor for a mark whose text is already known — used for marks just created. */
  const startEditingId = useCallback((id: string, text: string) => {
    setEditingId(id);
    setDraftText(text);
  }, []);

  const startEditing = useCallback(
    (id: string) => {
      setEditingId(id);
      setDraftText(annotations.find((a) => a.id === id)?.text || '');
    },
    [annotations]
  );

  const saveEditing = useCallback(() => {
    if (!editingId) return;
    const id = editingId;
    const text = draftText.trim();
    setAnnotations((prev) => {
      const target = prev.find((a) => a.id === id);
      // A pin or text box the reader placed then dismissed without writing anything is a
      // misclick; dropping it keeps empty marks from accumulating.
      if ((target?.kind === 'note' || target?.kind === 'text') && !text) {
        return prev.filter((a) => a.id !== id);
      }
      return prev.map((a) => (a.id === id ? { ...a, text } : a));
    });
    setEditingId(null);
    setDraftText('');
  }, [editingId, draftText]);

  /** Applies a partial change to one mark — moving it, resizing it, restyling it, locking it. */
  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      setAnnotations((prev) => {
        const target = prev.find((a) => a.id === id);
        if (!target) return prev;
        // Setting a property to the value it already holds — re-picking the current colour, or
        // pressing the dash style that is already active — is not an edit, and must not land on
        // the undo stack. Geometry patches carry fresh objects and so always count as a change,
        // which is correct: a drag that moved the mark at all did move it.
        const changed = Object.entries(patch).some(
          ([key, value]) => !Object.is((target as unknown as Record<string, unknown>)[key], value)
        );
        if (!changed) return prev;
        return prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
      });
    },
    [setAnnotations]
  );

  /** A theme toggles on or off the mark (several themes per mark); a plain colour clears them. */
  const retagAnnotation = useCallback(
    (id: string, themeId: string | null, color: string) => {
      setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...pickTheme(a.themeIds ?? [], themeId, color, settings.activeThemes) } : a)));
    },
    [settings.activeThemes]
  );

  return { createAnnotation, deleteAnnotation, retagAnnotation, saveEditing, startEditing, startEditingId, updateAnnotation };
}
