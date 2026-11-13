/**
 * Making and editing marks in the reader: the relative-time clock, marking a passage, the note editor
 * (open, save, cancel, delete), notes on a passage or a paragraph, reactions, and tool taps (moved
 * verbatim from ReaderScreen).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { commitOpenThemeField, type CreatedTheme } from '../pdf/themeField';
import { UserSettings } from '../../types';
import { ParagraphRange } from '../../utils/textFormatting';
import {
  expandToGroups,
  type TextMark,
  type TextMarkKind,
  type TextMarkPatch
} from '../../utils/textMarks';
import { planTextRanges } from '../../utils/textMarkView';
import { addThemeId } from '../../utils/markThemes';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { DEFAULT_TEXT_SIZE } from '../pdf/annotationModel';
import { SelectionAnchor } from '../pdf/SelectionPopover';
import { TextTool } from './readerParts';
import type { NewTextMark } from '../../utils/textMarks';
import type { Annotation } from '../pdf/annotationModel';

export interface UseReaderMarkingDeps {
  activeColor: string;
  activeThemeId: string;
  activeThemeIds: string[];
  addMarks: (ranges: ParagraphRange[], props: NewTextMark, paragraphs: string[]) => TextMark[];
  deleteMarks: (ids: Iterable<string>) => void;
  draftQuote: string;
  draftText: string;
  draftTitle: string;
  editingId: string;
  editorOpen: boolean;
  editorPara: number;
  markById: Map<string, TextMark>;
  marks: TextMark[];
  newNote: { ranges: ParagraphRange[]; quote: string; themeIds: string[]; color: string; paragraphOnly?: true; };
  paragraphs: string[];
  pendingSelection: ParagraphRange[];
  select: (ids: Iterable<string>, opts?: { additive?: boolean; }) => void;
  setDraftQuote: React.Dispatch<React.SetStateAction<string>>;
  setDraftText: React.Dispatch<React.SetStateAction<string>>;
  setDraftTitle: React.Dispatch<React.SetStateAction<string>>;
  setEditingId: React.Dispatch<React.SetStateAction<string>>;
  setNewNote: React.Dispatch<React.SetStateAction<{ ranges: ParagraphRange[]; quote: string; themeIds: string[]; color: string; paragraphOnly?: true; }>>;
  setPendingSelection: React.Dispatch<React.SetStateAction<ParagraphRange[]>>;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<SelectionAnchor>>;
  setTool: React.Dispatch<React.SetStateAction<TextTool>>;
  settings: UserSettings;
  textRef: React.RefObject<HTMLElement>;
  updateMarks: (ids: Iterable<string>, patch: TextMarkPatch) => void;
  viewById: Map<string, Annotation>;
}

export function useReaderMarking(deps: UseReaderMarkingDeps) {
  const { activeColor, activeThemeId, activeThemeIds, addMarks, deleteMarks, draftQuote, draftText, draftTitle, editingId, editorOpen, editorPara, markById, marks, newNote, paragraphs, pendingSelection, select, setDraftQuote, setDraftText, setDraftTitle, setEditingId, setNewNote, setPendingSelection, setSelectionAnchor, setTool, settings, textRef, updateMarks, viewById } = deps;

  // Relative note times ("5 minutes ago") move on once a minute.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const dropSelection = useCallback(() => {
    setPendingSelection(null);
    setSelectionAnchor(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  /**
   * Marks the selection, skipping any part that already carries the same mark. Never toggles —
   * a mark is removed deliberately, from its properties strip — and the new mark becomes the
   * selected one, so its colour or style can be changed straight away.
   */
  const applyMark = useCallback(
    (next: Exclude<TextTool, 'select'>, ranges: ParagraphRange[], themeOverride?: CreatedTheme | null) => {
      const isTerminology = next === 'terminology';
      const kind: TextMarkKind = isTerminology ? 'highlight' : next;
      // Every active theme; a theme just made in the menu's open "+ New theme" field (see
      // themeField.ts) joins them, and gives the colour when it is the only one.
      const themeIds = themeOverride ? addThemeId(activeThemeIds, themeOverride.id) : activeThemeIds;
      const color = themeOverride && themeIds[0] === themeOverride.id ? themeOverride.color : activeColor;
      // New marks where the words are not marked this way yet; the chosen themes added to a mark
      // already on them (one passage, several themes; textMarkView.ts, tested).
      const { create, tag } = planTextRanges(marks, ranges, kind, isTerminology, themeIds, color);
      for (const t of tag) updateMarks([t.id], { themeIds: t.themeIds, ...(t.color && { color: t.color }) });
      if (create.length === 0) {
        if (tag[0]) select([tag[0].id]);
        return;
      }
      const made = addMarks(
        create,
        {
          kind,
          themeIds,
          color: isTerminology ? settings.terminologyColor : color,
          isTerminology: isTerminology || undefined,
          author: settings.name
        },
        paragraphs
      );
      if (made[0]) select([made[0].id]);
    },
    [marks, addMarks, updateMarks, activeThemeIds, settings.terminologyColor, settings.name, activeColor, paragraphs, select]
  );

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setNewNote(null);
    setDraftText('');
    setDraftTitle('');
    setDraftQuote('');
  }, []);

  /** Escape discards; Tab stays inside; focus goes back to the opener, else the paragraph's Note button. */
  const editorRef = useRef<HTMLDivElement>(null);
  const editorParaRef = useRef(0);
  // Kept from while the editor is open: on close, `editorPara` already reads 0.
  if (editorOpen) editorParaRef.current = editorPara;
  useDialogFocus(editorRef, editorOpen, closeEditor, () =>
    document.querySelector<HTMLElement>(`#reader-para-${editorParaRef.current} [data-para-note]`) ?? textRef.current
  );

  const startEditing = useCallback(
    (id: string) => {
      const mark = markById.get(id);
      setNewNote(null);
      setEditingId(id);
      setDraftText(mark?.text ?? '');
      setDraftTitle(mark?.title ?? '');
      // The words the note cites: the selected passage it was made on, if any (all ranges joined).
      setDraftQuote(viewById.get(id)?.quote ?? '');
    },
    [markById, viewById]
  );

  /** Save: a new note is made only now, and only with words in it. */
  const saveEditing = useCallback(() => {
    const text = draftText.trim();
    const title = draftTitle.trim();
    if (newNote) {
      if (text || title) {
        const quote = draftQuote.trim();
        addMarks(
          newNote.ranges,
          {
            kind: 'note',
            themeIds: newNote.themeIds,
            color: newNote.color,
            text,
            title: title || undefined,
            author: settings.name,
            paragraphOnly: newNote.paragraphOnly,
            // Only an edited excerpt is stored, so an untouched one keeps each range's own words.
            ...(quote !== newNote.quote.trim() ? { quote } : {})
          },
          paragraphs
        );
      }
      closeEditor();
      return;
    }
    if (!editingId) return;
    const mark = markById.get(editingId);
    // Emptying an existing note (title and body) and saving it is how a note is cleared away.
    if (mark?.kind === 'note' && !text && !title) deleteMarks([editingId]);
    else if (mark && mark.kind === 'note') {
      const quote = draftQuote.trim();
      const shown = viewById.get(editingId)?.quote ?? '';
      // Only a changed quote is written, so an untouched note keeps each range's own words.
      updateMarks([editingId], { text, title: title || undefined, ...(quote !== shown.trim() ? { quote } : {}) });
    } else if (mark) updateMarks([editingId], { text });
    closeEditor();
  }, [newNote, editingId, markById, viewById, draftText, draftTitle, draftQuote, addMarks, deleteMarks, updateMarks, settings.name, paragraphs, closeEditor]);

  const deleteMark = useCallback(
    (id: string) => {
      deleteMarks([id]);
      if (editingId && expandToGroups(marks, [id]).has(editingId)) setEditingId(null);
    },
    [deleteMarks, editingId, marks]
  );

  /** A sticky note about the selected passage; the editor opens on a draft, made on Save. */
  const createNoteForSelection = useCallback(() => {
    if (!pendingSelection?.length) return;
    const ranges = pendingSelection;
    // Joined the way `textMarkViews` joins a group's ranges, so saving untouched writes no quote.
    const quote = ranges.map((r) => (paragraphs[r.paraIdx] ?? '').slice(r.start, r.end)).filter(Boolean).join(' ');
    dropSelection();
    setEditingId(null);
    setNewNote({ ranges, quote, themeIds: activeThemeIds, color: activeColor });
    setDraftText('');
    setDraftTitle('');
    setDraftQuote(quote);
  }, [pendingSelection, paragraphs, activeThemeIds, activeColor, dropSelection]);

  /** A note on a whole paragraph, with no passage picked (the paragraph's "Note" button). */
  const createParagraphNote = useCallback(
    (paraIdx: number) => {
      setEditingId(null);
      setNewNote({ ranges: [{ paraIdx, start: 0, end: 0 }], quote: '', themeIds: activeThemeIds, color: activeColor, paragraphOnly: true });
      setDraftText('');
      setDraftTitle('');
      setDraftQuote('');
    },
    [activeThemeIds, activeColor]
  );

  /** A ?, * or ! stamped before the selected passage. */
  const createReactionForSelection = useCallback(
    (kind: TextMarkKind) => {
      if (!pendingSelection?.length) return;
      const [made] = addMarks(
        pendingSelection,
        { kind, themeIds: activeThemeIds, color: activeColor, author: settings.name, fontSize: DEFAULT_TEXT_SIZE },
        paragraphs
      );
      dropSelection();
      if (made) select([made.id]);
    },
    [pendingSelection, addMarks, activeThemeIds, activeColor, settings.name, paragraphs, dropSelection, select]
  );

  /**
   * A tool was tapped. With text selected it marks that passage once and puts the tool back
   * down; with nothing selected it arms the tool for the next selection (tap again to disarm).
   */
  const handleToolTap = useCallback(
    (next: TextTool) => {
      if (next !== 'select' && pendingSelection?.length) {
        applyMark(next, pendingSelection, commitOpenThemeField());
        setTool('select');
        dropSelection();
        return;
      }
      setTool((current) => (current === next ? 'select' : next));
    },
    [pendingSelection, applyMark, dropSelection]
  );

  return { applyMark, clock, closeEditor, createNoteForSelection, createParagraphNote, createReactionForSelection, deleteMark, dropSelection, editorRef, handleToolTap, saveEditing, startEditing };
}
