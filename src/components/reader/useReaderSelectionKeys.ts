/**
 * Reading the live selection into a passage (and marking it at once when a tool is armed), and the
 * reader's keyboard shortcuts (moved verbatim from ReaderScreen).
 */

import React, { useEffect } from 'react';
import { type CreatedTheme } from '../pdf/themeField';
import { UserSettings } from '../../types';
import {
  ParagraphRange,
  rangesFromSelectionParts,
  selectionParagraphParts,
  selectionState
} from '../../utils/textFormatting';
import { inputKindOf, selectionTrigger, type InputKind } from '../../utils/selectionTrigger';
import { SelectionAnchor } from '../pdf/SelectionPopover';
import { escapeConsumes, isTypingTarget, resolveWorkspaceKey } from '../pdf/workspaceKeys';
import { PARA_TEXT_ID_PREFIX, TextTool } from './readerParts';
import type { TextMarkPatch } from '../../utils/textMarks';

export interface UseReaderSelectionKeysDeps {
  applyMark: (next: Exclude<TextTool, "select">, ranges: ParagraphRange[], themeOverride?: CreatedTheme | null) => void;
  clearSelection: () => void;
  createNoteForSelection: () => void;
  deleteMarks: (ids: Iterable<string>) => void;
  dropSelection: () => void;
  editorOpen: boolean;
  handleToolTap: (next: TextTool) => void;
  pendingSelection: ParagraphRange[];
  redo: () => void;
  selectedIds: string[];
  selectionAnchor: SelectionAnchor;
  setActiveThemeId: React.Dispatch<React.SetStateAction<string>>;
  setPendingSelection: React.Dispatch<React.SetStateAction<ParagraphRange[]>>;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<SelectionAnchor>>;
  setTool: React.Dispatch<React.SetStateAction<TextTool>>;
  settings: UserSettings;
  textRef: React.RefObject<HTMLElement>;
  tool: TextTool;
  undo: () => void;
  updateMarks: (ids: Iterable<string>, patch: TextMarkPatch) => void;
}

export function useReaderSelectionKeys(deps: UseReaderSelectionKeysDeps) {
  const { applyMark, clearSelection, createNoteForSelection, deleteMarks, dropSelection, editorOpen, handleToolTap, pendingSelection, redo, selectedIds, selectionAnchor, setActiveThemeId, setPendingSelection, setSelectionAnchor, setTool, settings, textRef, tool, undo, updateMarks } = deps;

  /**
   * Reads the live selection, the same rules as the PDF workspace: the menu acts on exactly this
   * passage. A mouse or pen release reads it at once, and an armed tool marks it; after touch
   * (long-press, selection handles: no mouseup, often no pointerup) or keyboard selection it is
   * read once the selection settles, and an armed tool waits for a tap. See `selectionTrigger`.
   */
  useEffect(() => {
    const sync = (applyArmedTool: boolean) => {
      // Typing a new theme's name in the selection menu moves the browser's selection; the passage stays.
      if ((document.activeElement as HTMLElement | null)?.closest('[data-keep-selection]')) return;
      const sel = window.getSelection();
      const state =
        sel && !sel.isCollapsed && textRef.current
          ? selectionState(sel.toString().trim(), rangesFromSelectionParts(selectionParagraphParts(textRef.current, PARA_TEXT_ID_PREFIX)))
          : null;
      if (!state) {
        if (!sel?.toString().trim()) {
          setPendingSelection(null);
          setSelectionAnchor(null);
        }
        return;
      }
      // An armed tool marks the passage at once, so only the new mark's toolbar shows, not the menu too.
      if (applyArmedTool && tool !== 'select') {
        applyMark(tool, state.ranges);
        dropSelection();
        return;
      }
      setPendingSelection(state.ranges);
      const rect = sel!.rangeCount ? sel!.getRangeAt(0).getBoundingClientRect() : null;
      if (rect && rect.width + rect.height > 0) setSelectionAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom });
    };

    let last: InputKind | null = null;
    let timer: number | undefined;
    const run = (event: 'pointerup' | 'selectionchange') => {
      const t = selectionTrigger(last, event);
      if (t.mode === 'ignore') return;
      window.clearTimeout(timer);
      if (t.mode === 'now') {
        const apply = t.applyArmedTool;
        timer = window.setTimeout(() => sync(apply), 0);
        return;
      }
      timer = window.setTimeout(() => {
        const node = window.getSelection()?.anchorNode;
        if (node && !textRef.current?.contains(node)) return;
        sync(false);
      }, t.delayMs);
    };
    const onPointerDown = (e: PointerEvent) => {
      last = inputKindOf(e.pointerType);
    };
    const onPointerUp = (e: PointerEvent) => {
      last = inputKindOf(e.pointerType);
      run('pointerup');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTypingTarget(e.target)) last = 'key';
    };
    const onSelectionChange = () => run('selectionchange');
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [tool, applyMark, dropSelection]);

  /**
   * Keyboard shortcuts, the PDF workspace's (`workspaceKeys.ts`): Escape, undo/redo, Delete,
   * H U S pick a tool (acting on selected text), N writes a note about the selection, V puts the
   * tool down, 1–9 choose a theme (or re-file the selected mark). Never while typing or in a dialog.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editorOpen || e.defaultPrevented || (e.repeat && !/^(z|y)$/i.test(e.key))) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const action = resolveWorkspaceKey(e);
      if (!action) return;
      const hasSelection = Boolean(selectionAnchor && pendingSelection?.length);
      switch (action.type) {
        case 'escape':
          if (escapeConsumes({ tool, markSelected: selectedIds.length > 0, textSelected: hasSelection })) e.preventDefault();
          setTool('select');
          clearSelection();
          setSelectionAnchor(null);
          return;
        case 'undo':
          e.preventDefault();
          undo();
          return;
        case 'redo':
          e.preventDefault();
          redo();
          return;
        case 'delete':
          if (selectedIds.length === 0) return;
          e.preventDefault();
          deleteMarks(selectedIds);
          return;
        case 'tool': {
          const t = action.tool;
          if (t === 'note') {
            if (!hasSelection) return;
            e.preventDefault();
            createNoteForSelection();
            return;
          }
          if (t !== 'select' && t !== 'highlight' && t !== 'underline' && t !== 'strikeout') return;
          e.preventDefault();
          handleToolTap(t);
          return;
        }
        case 'theme': {
          const theme = settings.activeThemes[action.index];
          if (!theme) return;
          e.preventDefault();
          if (!hasSelection && selectedIds.length) updateMarks(selectedIds, { themeId: theme.id, color: theme.color });
          else setActiveThemeId(theme.id);
          return;
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    editorOpen,
    tool,
    selectionAnchor,
    pendingSelection,
    selectedIds,
    clearSelection,
    undo,
    redo,
    deleteMarks,
    updateMarks,
    createNoteForSelection,
    handleToolTap,
    settings.activeThemes
  ]);

  return {  };
}
