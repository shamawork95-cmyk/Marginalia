/**
 * The reader's floating layer: the instance navigator, the selected mark's properties, the marks
 * archive's dialogs and the selection menu (moved verbatim from ReaderScreen).
 */

import React from 'react';
import { type CreatedTheme } from '../pdf/themeField';
import type { MarkLinks } from '../pdf/MarkProperties';
import type { ThemeStore } from '../themeStore';
import { AnnotationFocus, UserSettings } from '../../types';
import { ParagraphRange } from '../../utils/textFormatting';
import type { PlainTextAnnotations } from '../../hooks/usePlainTextAnnotations';
import { type TextMarkKind } from '../../utils/textMarks';
import { SelectionPopover, SelectionAnchor } from '../pdf/SelectionPopover';
import { MarkProperties } from '../pdf/MarkProperties';
import type { PanelContext } from '../pdf/useAnchoredPanel';
import { InstanceNavigator } from '../pdf/InstanceNavigator';
import { TextTool, isReactionKind, Tab } from './readerParts';
import type { MarksArchive } from '../MarksArchive';
import type { Annotation } from '../pdf/annotationModel';
import type { TextMarkPatch } from '../../utils/textMarks';

export interface ReaderPopoversProps {
  activeControlTab: Tab;
  activeFocus: AnnotationFocus;
  activeThemeId: string;
  annotations: PlainTextAnnotations;
  applyMark: (next: Exclude<TextTool, "select">, ranges: ParagraphRange[], themeOverride?: CreatedTheme | null) => void;
  archive: MarksArchive;
  bottomInset: 0 | 60;
  clearSelection: () => void;
  copyQuoteOf: (id: string, quote: string) => Promise<boolean>;
  copySelectionQuote: (ranges: ParagraphRange[]) => Promise<boolean>;
  createNoteForSelection: () => void;
  createReactionForSelection: (kind: TextMarkKind) => void;
  deleteMark: (id: string) => void;
  dropSelection: () => void;
  editorOpen: boolean;
  isDark: boolean;
  markLinksFor: (id: string) => MarkLinks;
  markRect: { left: number; top: number; right: number; bottom: number; };
  pendingSelection: ParagraphRange[];
  placementContext: () => PanelContext;
  popoverTopInset: number;
  scrollToMark: (id: string) => boolean;
  selectedView: Annotation;
  selectionAnchor: SelectionAnchor;
  selectionInView: boolean;
  setActiveFocus: React.Dispatch<React.SetStateAction<AnnotationFocus>>;
  setActiveThemeId: React.Dispatch<React.SetStateAction<string>>;
  setHoveredId: React.Dispatch<React.SetStateAction<string>>;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<SelectionAnchor>>;
  setTool: React.Dispatch<React.SetStateAction<TextTool>>;
  settings: UserSettings;
  startEditing: (id: string) => void;
  themeStore: ThemeStore;
  toolColors: { [k: string]: string; };
  updateMarks: (ids: Iterable<string>, patch: TextMarkPatch) => void;
  views: Annotation[];
}

export const ReaderPopovers: React.FC<ReaderPopoversProps> = ({ activeControlTab, activeFocus, activeThemeId, annotations, applyMark, archive, bottomInset, clearSelection, copyQuoteOf, copySelectionQuote, createNoteForSelection, createReactionForSelection, deleteMark, dropSelection, editorOpen, isDark, markLinksFor, markRect, pendingSelection, placementContext, popoverTopInset, scrollToMark, selectedView, selectionAnchor, selectionInView, setActiveFocus, setActiveThemeId, setHoveredId, setSelectionAnchor, setTool, settings, startEditing, themeStore, toolColors, updateMarks, views }) => (
  <>
      {/* Stepping through the marks the reader came here to find (opened from the library). */}
      {activeFocus && annotations.isLoaded && (
        <div className="fixed inset-x-0 bottom-0 max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] h-0 z-30">
          <InstanceNavigator
            focus={activeFocus}
            annotations={views}
            onGoTo={(a) => {
              setHoveredId(a.id);
              return scrollToMark(a.id);
            }}
            onClose={() => setActiveFocus(null)}
            isDark={isDark}
            locationLabel={(a) => `¶${a.page}`}
          />
        </div>
      )}

      {/* Properties for the selected mark: colour, weight, line style, note style, comment, delete. */}
      {selectedView && markRect && !editorOpen && (
        <MarkProperties
          mark={selectedView}
          rect={markRect}
          settings={settings}
          isDark={isDark}
          bottomInset={bottomInset}
          topInset={popoverTopInset}
          placementContext={placementContext}
          onColorChange={(color, themeId) => updateMarks([selectedView.id], { color, themeId })}
          onWeightChange={(weight) => updateMarks([selectedView.id], { weight })}
          onStrokeStyleChange={(strokeStyle) => updateMarks([selectedView.id], { strokeStyle })}
          onNoteStyleChange={(noteStyle) => updateMarks([selectedView.id], { noteStyle })}
          onTextSizeChange={(fontSize) => updateMarks([selectedView.id], { fontSize })}
          // Brackets and text boxes do not exist on text documents; their controls never show.
          onBracketSideChange={() => {}}
          onTextAlignChange={() => {}}
          onTextFontChange={() => {}}
          onTextBoldChange={() => {}}
          onTextItalicChange={() => {}}
          onEdit={() => startEditing(selectedView.id)}
          onDelete={() => deleteMark(selectedView.id)}
          onDismiss={clearSelection}
          onCopyQuote={selectedView.quote ? () => copyQuoteOf(selectedView.id, selectedView.quote!) : undefined}
          links={markLinksFor(selectedView.id)}
        />
      )}

      {archive.ui}

      {/* The selection menu — mark the passage, or write a note about it. */}
      {!editorOpen && activeControlTab === 'notes' && (
        <SelectionPopover
          anchor={selectionInView ? selectionAnchor : null}
          isDark={isDark}
          topInset={popoverTopInset}
          bottomInset={bottomInset}
          toolColors={toolColors}
          themes={settings.activeThemes}
          activeThemeId={activeThemeId}
          onThemeChange={setActiveThemeId}
          onCreateTheme={themeStore?.create}
          onCopyQuote={pendingSelection?.length ? () => copySelectionQuote(pendingSelection) : undefined}
          onMark={(kind) => {
            if (isReactionKind(kind as TextMarkKind)) createReactionForSelection(kind as TextMarkKind);
            else {
              if (pendingSelection?.length) applyMark(kind as 'highlight' | 'underline' | 'strikeout', pendingSelection);
              dropSelection();
            }
            setTool('select');
          }}
          onCreateNote={() => {
            createNoteForSelection();
            setTool('select');
          }}
          onMarkTerminology={() => {
            if (pendingSelection?.length) applyMark('terminology', pendingSelection);
            dropSelection();
            setTool('select');
          }}
          terminologyColor={settings.terminologyColor}
          onDismiss={() => setSelectionAnchor(null)}
          // Never over the text or a note card: the margin, above, below, the nav, or a gap.
          avoidSelector="[data-note-card]"
          placementContext={placementContext}
          onClose={dropSelection}
        />
      )}
  </>
);
