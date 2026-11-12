/**
 * The PDF workspace's floating layer: the instance navigator, the scroll page indicator, the selected
 * mark's properties, the live selection overlay and the selection menu (moved verbatim from
 * PdfWorkspace).
 */

import React from 'react';
import type { ThemeStore } from '../../themeStore';
import { UserSettings } from '../../../types';
import { Annotation, AnnotationKind, FractionRect, PdfTool, isReaction } from '../annotationModel';
import { InstanceNavigator } from '../InstanceNavigator';
import { SelectionPopover, SelectionAnchor } from '../SelectionPopover';
import { LiveSelectionOverlay } from '../LiveSelectionOverlay';
import { MarkProperties } from '../MarkProperties';
import { ScrollPageIndicator } from '../ScrollPageIndicator';
import { copyText } from '../../MarksArchive';
import type { MarkLinks } from '../MarkProperties';
import { formatQuoteRef } from '../../../utils/quoteRef';
import { type CreatedTheme } from '../themeField';
import { NAVIGATOR_HEIGHT } from './docState';
import type { ThemeResult } from '../../themeStore';

export interface WorkspacePopoversProps {
  activeFocus: { kind: "theme"; themeId: string; label: string; color: string; } | { kind: "terminology"; label: string; color: string; };
  activeThemeId: string;
  annotations: Annotation[];
  applyTextMark: (tool: PdfTool, groups: { page: number; rects: FractionRect[]; quote: string; }[], colorOverride?: string, themeOverride?: CreatedTheme | null) => void;
  chooseSelectionTheme: (id: string) => void;
  createNoteForSelection: () => void;
  createReactionForSelection: (kind: AnnotationKind) => void;
  createSelectionTheme: (name: string, color: string) => ThemeResult;
  deleteAnnotation: (id: string) => void;
  documentTitle: string;
  editing: Annotation;
  isDark: boolean;
  isLoaded: boolean;
  layoutSettled: boolean;
  markLinksFor: (id: string) => MarkLinks;
  markRect: { left: number; top: number; right: number; bottom: number; };
  pageCount: number;
  pendingSelection: { page: number; rects: FractionRect[]; quote: string; }[];
  popoverTopInset: number;
  scrollRef: React.RefObject<HTMLDivElement>;
  scrollToAnnotation: (a: Annotation) => boolean;
  selectedMark: Annotation;
  selectionAnchor: SelectionAnchor;
  setActiveFocus: React.Dispatch<React.SetStateAction<{ kind: "theme"; themeId: string; label: string; color: string; } | { kind: "terminology"; label: string; color: string; }>>;
  setHoveredId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string>>;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<SelectionAnchor>>;
  setTool: React.Dispatch<React.SetStateAction<PdfTool>>;
  settings: UserSettings;
  startEditing: (id: string) => void;
  themeStore: ThemeStore;
  toolColors: Record<string, string>;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
}

export const WorkspacePopovers: React.FC<WorkspacePopoversProps> = ({ activeFocus, activeThemeId, annotations, applyTextMark, chooseSelectionTheme, createNoteForSelection, createReactionForSelection, createSelectionTheme, deleteAnnotation, documentTitle, editing, isDark, isLoaded, layoutSettled, markLinksFor, markRect, pageCount, pendingSelection, popoverTopInset, scrollRef, scrollToAnnotation, selectedMark, selectionAnchor, setActiveFocus, setHoveredId, setSelectedId, setSelectionAnchor, setTool, settings, startEditing, themeStore, toolColors, updateAnnotation }) => (
  <>
      {/* Stepping through the marks the reader came here to find. Reads from live annotation
          state, so marking or erasing while it is open changes the run under it. */}
      {activeFocus && isLoaded && layoutSettled && (
        <InstanceNavigator
          focus={activeFocus}
          annotations={annotations}
          // Brings the mark into view and raises it, without selecting it. Selecting opens the
          // properties strip, which is an editing gesture the reader did not ask for — stepping
          // through marks is reading, and what to change is their decision to make afterwards.
          onGoTo={(a) => {
            setHoveredId(a.id);
            return scrollToAnnotation(a);
          }}
          onClose={() => setActiveFocus(null)}
          isDark={isDark}
        />
      )}

      {/* The page number, beside the scrollbar, while the reader is scrolling. */}
      <ScrollPageIndicator containerRef={scrollRef} pageCount={pageCount} isDark={isDark} />

      {/* Properties for whatever is selected: colour, thickness, comment, delete. */}
      {selectedMark && markRect && !editing && (
        <MarkProperties
          mark={selectedMark}
          rect={markRect}
          settings={settings}
          isDark={isDark}
          // Colour and theme change together: a theme swatch carries its id along, and anything
          // else (a custom colour, a neutral, the free picker) carries `null` — leaving the mark's
          // OLD themeId in place after its colour visibly stopped matching that theme is exactly
          // the mismatch that made a retagged mark silently miscount on the cross-document dashboard.
          bottomInset={activeFocus ? NAVIGATOR_HEIGHT : 0}
          topInset={popoverTopInset}
          onColorChange={(color, themeId) => updateAnnotation(selectedMark.id, { color, themeId })}
          onWeightChange={(weight) => updateAnnotation(selectedMark.id, { weight })}
          onStrokeStyleChange={(strokeStyle) => updateAnnotation(selectedMark.id, { strokeStyle })}
          onNoteStyleChange={(noteStyle) => updateAnnotation(selectedMark.id, { noteStyle })}
          onBracketSideChange={(bracketSide) => updateAnnotation(selectedMark.id, { bracketSide })}
          onTextSizeChange={(fontSize) => updateAnnotation(selectedMark.id, { fontSize })}
          onTextAlignChange={(align) => updateAnnotation(selectedMark.id, { align })}
          onTextFontChange={(font) => updateAnnotation(selectedMark.id, { font })}
          onTextBoldChange={(bold) => updateAnnotation(selectedMark.id, { bold })}
          onTextItalicChange={(italic) => updateAnnotation(selectedMark.id, { italic })}
          onEdit={() => startEditing(selectedMark.id)}
          onDelete={() => deleteAnnotation(selectedMark.id)}
          // Pressing anywhere that is not this strip, a mark or a menu puts it away. Leaving a
          // mark selected — and its strip floating over the page — after the reader had visibly
          // moved on was the single most persistent annoyance in the editor.
          onDismiss={() => setSelectedId(null)}
          onCopyQuote={selectedMark.quote ? () => copyText(formatQuoteRef(selectedMark.quote!, documentTitle, { kind: 'page', page: selectedMark.page })) : undefined}
          links={markLinksFor(selectedMark.id)}
        />
      )}

      <LiveSelectionOverlay />

      {/* The selection menu — mark the passage, or write a note about it. */}
      {!editing && (
        <SelectionPopover
          anchor={selectionAnchor}
          isDark={isDark}
          bottomInset={activeFocus ? NAVIGATOR_HEIGHT : 0}
          topInset={popoverTopInset}
          toolColors={toolColors}
          themes={settings.activeThemes}
          activeThemeId={activeThemeId}
          onThemeChange={chooseSelectionTheme}
          onCreateTheme={themeStore ? createSelectionTheme : undefined}
          onCopyQuote={
            pendingSelection?.length
              ? () =>
                  copyText(
                    formatQuoteRef(pendingSelection.map((g) => g.quote).join(' '), documentTitle, { kind: 'page', page: pendingSelection[0].page })
                  )
              : undefined
          }
          onMark={(kind) => {
            if (isReaction(kind)) {
              createReactionForSelection(kind);
            } else {
              if (pendingSelection?.length) applyTextMark(kind, pendingSelection);
              setSelectionAnchor(null);
              window.getSelection()?.removeAllRanges();
            }
            // The menu acts on THIS passage and hands the workspace back in its resting state.
            // Arming the tool here would leave the next drag marking something by accident, and
            // the reader who wants to keep highlighting can say so from the toolbar.
            setTool('select');
          }}
          onCreateNote={() => {
            createNoteForSelection();
            setTool('select');
          }}
          onMarkTerminology={() => {
            if (pendingSelection?.length) applyTextMark('terminology', pendingSelection);
            setSelectionAnchor(null);
            window.getSelection()?.removeAllRanges();
            setTool('select');
          }}
          terminologyColor={settings.terminologyColor}
          // Dismissing takes the MENU away and leaves the passage selected. It fires on any
          // press outside — including a press on a toolbar tool — and clearing the selection
          // there would pull the passage out from under the very action being reached for.
          onDismiss={() => setSelectionAnchor(null)}
          // The X button means "done with this passage" — clear the selection too, or the
          // global mouseup listener above would see it's still live and reopen this menu.
          onClose={() => {
            setSelectionAnchor(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      )}
  </>
);
