/**
 * The reader's marks as it draws them: group heads, views, lookups, each paragraph's marks and notes
 * (kept as the same arrays while unchanged, so memoised paragraphs skip), the selected and hovered ids
 * per paragraph, and the editor's state (moved verbatim from ReaderScreen).
 */

import { useCallback, useMemo, useRef } from 'react';
import { UserSettings } from '../../types';
import { ParagraphRange } from '../../utils/textFormatting';
import { groupHeads, expandToGroups, type TextMark } from '../../utils/textMarks';
import { markColor, reuseUnchanged, textMarkViews } from '../../utils/textMarkView';
import { FALLBACK_COLOR, isReactionKind, NoteItem } from './readerParts';

export interface UseReaderMarkViewsDeps {
  editingId: string;
  hoveredId: string;
  marks: TextMark[];
  newNote: { ranges: ParagraphRange[]; quote: string; themeId: string | null; color: string; paragraphOnly?: true; };
  paragraphs: string[];
  selectedIds: string[];
  settings: UserSettings;
}

export function useReaderMarkViews(deps: UseReaderMarkViewsDeps) {
  const { editingId, hoveredId, marks, newNote, paragraphs, selectedIds, settings } = deps;

  const heads = useMemo(() => groupHeads(marks), [marks]);
  const views = useMemo(
    () => textMarkViews(marks, paragraphs, settings.terminologyColor),
    [marks, paragraphs, settings.terminologyColor]
  );
  const viewById = useMemo(() => new Map(views.map((v) => [v.id, v])), [views]);
  const markById = useMemo(() => new Map(marks.map((m) => [m.id, m])), [marks]);
  const noteHeads = useMemo(() => heads.filter((m) => m.kind === 'note'), [heads]);

  /**
   * Everything a paragraph draws, grouped by paragraph in one pass (not a filter per paragraph),
   * and kept as last render's arrays wherever nothing changed so memoised paragraphs skip.
   */
  const paraCache = useRef<{ marks: Map<number, TextMark[]>; notes: Map<number, NoteItem[]> }>({
    marks: new Map(),
    notes: new Map()
  });
  const paraData = useMemo(() => {
    const byPara = new Map<number, TextMark[]>();
    const glyphs = new Map<number, string[]>();
    const notesBy = new Map<number, NoteItem[]>();
    const headIds = new Set(heads.map((m) => m.id));
    for (const m of marks) {
      const p = m.anchor.paragraphIndex;
      (byPara.get(p) ?? byPara.set(p, []).get(p)!).push(m);
      if (isReactionKind(m.kind) && headIds.has(m.id)) (glyphs.get(p) ?? glyphs.set(p, []).get(p)!).push(m.id);
    }
    for (const n of noteHeads) {
      const p = n.anchor.paragraphIndex;
      (notesBy.get(p) ?? notesBy.set(p, []).get(p)!).push({ mark: n, quote: viewById.get(n.id)?.quote });
    }
    const prev = paraCache.current;
    const next = {
      marks: reuseUnchanged(prev.marks, byPara),
      notes: reuseUnchanged(prev.notes, notesBy, (a, b) => a.mark === b.mark && a.quote === b.quote)
    };
    paraCache.current = next;
    return { ...next, glyphs: new Map([...glyphs].map(([p, ids]) => [p, ids.join(' ')])) };
  }, [marks, heads, noteHeads, viewById]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hoveredSet = useMemo(() => (hoveredId ? expandToGroups(marks, [hoveredId]) : new Set<string>()), [marks, hoveredId]);
  /** Selected and hovered ids per paragraph, so only the paragraphs they touch see a new prop. */
  const idsByPara = useCallback(
    (ids: Set<string>) => {
      const map = new Map<number, string[]>();
      for (const id of ids) {
        const p = markById.get(id)?.anchor.paragraphIndex;
        if (p !== undefined) (map.get(p) ?? map.set(p, []).get(p)!).push(id);
      }
      return new Map([...map].map(([p, list]) => [p, list.sort().join(' ')]));
    },
    [markById]
  );
  const selByPara = useMemo(() => idsByPara(selectedSet), [idsByPara, selectedSet]);
  const hovByPara = useMemo(() => idsByPara(hoveredSet), [idsByPara, hoveredSet]);
  const selectedView = selectedIds.map((id) => viewById.get(id)).find(Boolean);
  const editing = editingId ? markById.get(editingId) : undefined;
  const editorOpen = Boolean(editing || newNote);
  const editorIsNote = Boolean(newNote) || editing?.kind === 'note';
  const editorColor = newNote ? newNote.color : editing ? (editing.isTerminology ? settings.terminologyColor : markColor(editing.color, FALLBACK_COLOR)) : FALLBACK_COLOR;
  const editorPara = newNote ? newNote.ranges[0].paraIdx : (editing?.anchor.paragraphIndex ?? 0);
  const colorOf = (m: TextMark) => (m.isTerminology ? settings.terminologyColor : markColor(m.color, FALLBACK_COLOR));

  return { colorOf, editing, editorColor, editorIsNote, editorOpen, editorPara, heads, hovByPara, markById, noteHeads, paraData, selByPara, selectedView, viewById, views };
}
