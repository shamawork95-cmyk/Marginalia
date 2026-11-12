/**
 * Themes from the selection menu, and the workspace's keyboard shortcuts (moved verbatim from
 * PdfWorkspace).
 */

import React, { useEffect, useCallback, useRef } from 'react';
import type { ThemeStore } from '../../themeStore';
import { UserSettings } from '../../../types';
import { FractionRect, PdfTool, isTextAnchored } from '../annotationModel';
import { SelectionAnchor } from '../SelectionPopover';
import { escapeConsumes, isTypingTarget, resolveWorkspaceKey } from '../workspaceKeys';

export interface UseWorkspaceKeysDeps {
  createNoteForSelection: () => void;
  deleteAnnotation: (id: string) => void;
  editingId: string;
  handleToolTap: (next: PdfTool) => void;
  pendingSelection: { page: number; rects: FractionRect[]; quote: string; }[];
  redo: () => void;
  retagAnnotation: (id: string, themeId: string | null, color: string) => void;
  selectedId: string;
  selectionAnchor: SelectionAnchor;
  setActiveThemeId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string>>;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<SelectionAnchor>>;
  setTool: React.Dispatch<React.SetStateAction<PdfTool>>;
  setToolColor: (which: string, color: string) => void;
  settings: UserSettings;
  themeStore: ThemeStore;
  tool: PdfTool;
  undo: () => void;
}

export function useWorkspaceKeys(deps: UseWorkspaceKeysDeps) {
  const { createNoteForSelection, deleteAnnotation, editingId, handleToolTap, pendingSelection, redo, retagAnnotation, selectedId, selectionAnchor, setActiveThemeId, setSelectedId, setSelectionAnchor, setTool, setToolColor, settings, themeStore, tool, undo } = deps;

  /**
   * Choosing a theme while a passage is selected: every mark the selection menu can make picks up
   * the theme's colour, not just whichever one the reader presses next — the menu has no single
   * "current tool" the way the toolbar has one. Shared by the menu's dots and the number keys.
   */
  /** A theme made in the selection menu, until settings carry it (the same tick picks it). */
  const justCreatedTheme = useRef<{ id: string; name: string; color: string } | null>(null);
  const createSelectionTheme = useCallback(
    (name: string, color: string) => {
      const r = themeStore!.create(name, color);
      if ('theme' in r) justCreatedTheme.current = r.theme;
      return r;
    },
    [themeStore]
  );
  const chooseSelectionTheme = useCallback(
    (id: string) => {
      setActiveThemeId(id);
      const theme =
        settings.activeThemes.find((t) => t.id === id) ?? (justCreatedTheme.current?.id === id ? justCreatedTheme.current : undefined);
      if (theme) {
        (['highlight', 'underline', 'strikeout', 'question', 'star', 'exclamation', 'note'] as const).forEach(
          (kind) => setToolColor(kind, theme.color)
        );
      }
    },
    [settings.activeThemes, setToolColor]
  );

  /**
   * Keyboard shortcuts (mapping in `workspaceKeys.ts`):
   * - Escape leaves whatever tool is active and closes the menus;
   * - Cmd/Ctrl+Z undo, Shift+Cmd+Z / Ctrl+Y redo;
   * - Delete or Backspace removes the selected mark;
   * - H U S N P E V pick a tool, acting on selected text the way tapping the tool does
   *   (N with text selected writes a sticky note about it, like the menu's Sticky note);
   * - 1–9 file the selected text or the selected mark under theme 1–9, or, with nothing
   *   selected, make it the theme new marks are filed under.
   *
   * None of them fire while the reader is typing (an input, a textarea, contenteditable, the
   * comment editor) or while a dialog is open: there, Escape means "close this", Cmd+Z means
   * "undo my typing", and a letter is a letter.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId || e.defaultPrevented || (e.repeat && !/^(z|y)$/i.test(e.key))) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const action = resolveWorkspaceKey(e);
      if (!action) return;

      const hasSelection = Boolean(selectionAnchor && pendingSelection?.length);
      switch (action.type) {
        case 'escape':
          if (escapeConsumes({ tool, markSelected: Boolean(selectedId), textSelected: hasSelection })) e.preventDefault();
          setTool('select');
          setSelectedId(null);
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
          if (!selectedId) return;
          e.preventDefault();
          deleteAnnotation(selectedId);
          return;
        case 'tool':
          e.preventDefault();
          if (action.tool === 'note' && hasSelection) {
            createNoteForSelection();
            setTool('select');
            return;
          }
          // A tool key with text selected marks it, exactly like tapping the toolbar button.
          handleToolTap(action.tool);
          if (hasSelection && isTextAnchored(action.tool)) window.getSelection()?.removeAllRanges();
          return;
        case 'theme': {
          const theme = settings.activeThemes[action.index];
          if (!theme) return;
          e.preventDefault();
          if (hasSelection) {
            chooseSelectionTheme(theme.id);
          } else if (selectedId) {
            retagAnnotation(selectedId, theme.id, theme.color);
          } else {
            setActiveThemeId(theme.id);
            if (tool !== 'erase' && tool !== 'select' && tool !== 'terminology') setToolColor(tool, theme.color);
          }
          return;
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    editingId,
    undo,
    redo,
    selectedId,
    selectionAnchor,
    pendingSelection,
    deleteAnnotation,
    createNoteForSelection,
    handleToolTap,
    chooseSelectionTheme,
    retagAnnotation,
    settings.activeThemes,
    tool,
    setToolColor
  ]);

  return { chooseSelectionTheme, createSelectionTheme };
}
