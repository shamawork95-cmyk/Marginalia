/**
 * The PDF workspace's toolbar row (inside focus mode's sliding chrome), the Find bar and focus mode's
 * exit (moved verbatim from PdfWorkspace).
 */

import React from 'react';
import { StickyNote } from '../../icons';
import { FocusChrome, FocusExit, FOCUS_HOTKEY } from '../../FocusMode';
import { HoverTooltip } from '../../HoverTooltip';
import { Maximize2, Minimize2, Search } from '../../icons';
import { FindBar, FIND_SHORTCUT } from '../../FindBar';
import { UserSettings } from '../../../types';
import {
  Annotation,
  BracketSide,
  FractionRect,
  NoteStyle,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont
} from '../annotationModel';
import { PdfToolbar } from '../PdfToolbar';
import { archiveRows } from '../../MarksArchive';
import { type PdfViewMode } from '../../../utils/documentStorage';
import type { MarksArchive } from '../../MarksArchive';
import type { DocumentFind } from '../../FindBar';

export interface WorkspaceToolbarProps {
  activeThemeId: string;
  annotations: Annotation[];
  archive: MarksArchive;
  bracketSide: BracketSide;
  canRedo: boolean;
  canUndo: boolean;
  currentPage: number;
  find: DocumentFind;
  fitWidth: () => Promise<void>;
  fitPage: () => Promise<void>;
  focusMode: boolean;
  goToPage: (page: number, animate?: boolean) => void;
  handleBracketSideChange: (side: BracketSide) => void;
  handleExport: () => Promise<void>;
  handleNoteStyleChange: (style: NoteStyle) => void;
  handleTextAlignChange: (align: TextAlign) => void;
  handleTextBoldChange: (bold: boolean) => void;
  handleTextFontChange: (font: TextFont) => void;
  handleTextItalicChange: (italic: boolean) => void;
  handleTextSizeChange: (fontSize: number) => void;
  handleToolColorChange: (which: string, color: string) => void;
  handleToolStrokeStyleChange: (which: string, strokeStyle: StrokeStyle) => void;
  handleToolTap: (next: PdfTool) => void;
  handleToolWeightChange: (which: string, weight: number) => void;
  handleViewModeChange: (mode: PdfViewMode) => void;
  isDark: boolean;
  isDeletingPage: boolean;
  isExporting: boolean;
  isInsertingPage: boolean;
  isPanelOpen: boolean;
  noteStyle: NoteStyle;
  onToggleFocus: () => void;
  openSubmenuFor: string;
  pageCount: number;
  pendingSelection: { page: number; rects: FractionRect[]; quote: string; }[];
  redo: () => void;
  scale: number;
  selectedId: string;
  setActiveThemeId: React.Dispatch<React.SetStateAction<string>>;
  setInsertPageMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setOpenSubmenuFor: React.Dispatch<React.SetStateAction<string>>;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  settings: UserSettings;
  submenuClosedAt: React.RefObject<{ tool: string; at: number; }>;
  textAlign: TextAlign;
  textBold: boolean;
  textFont: TextFont;
  textItalic: boolean;
  textSize: number;
  tool: PdfTool;
  toolColors: Record<string, string>;
  toolStrokeStyles: Record<string, StrokeStyle>;
  toolWeights: Record<string, number>;
  undo: () => void;
  viewMode: PdfViewMode;
  zoomTouchedRef: React.RefObject<boolean>;
}

export const WorkspaceToolbar: React.FC<WorkspaceToolbarProps> = ({ activeThemeId, annotations, archive, bracketSide, canRedo, canUndo, currentPage, find, fitPage, fitWidth, focusMode, goToPage, handleBracketSideChange, handleExport, handleNoteStyleChange, handleTextAlignChange, handleTextBoldChange, handleTextFontChange, handleTextItalicChange, handleTextSizeChange, handleToolColorChange, handleToolStrokeStyleChange, handleToolTap, handleToolWeightChange, handleViewModeChange, isDark, isDeletingPage, isExporting, isInsertingPage, isPanelOpen, noteStyle, onToggleFocus, openSubmenuFor, pageCount, pendingSelection, redo, scale, selectedId, setActiveThemeId, setInsertPageMenuOpen, setIsPanelOpen, setOpenSubmenuFor, setScale, settings, submenuClosedAt, textAlign, textBold, textFont, textItalic, textSize, tool, toolColors, toolStrokeStyles, toolWeights, undo, viewMode, zoomTouchedRef }) => (
  <>
      <FocusChrome focus={focusMode} selecting={Boolean(pendingSelection?.length || selectedId)}>
      <PdfToolbar
        // The expanded sidebar takes 220px off this row, which is what forced the tools together.
        // With it collapsed there is room to breathe, so the tools get their ordinary spacing back
        // rather than staying cramped for a constraint that is no longer there.
        compact={!settings.sidebarCollapsed}
        panelControls={
          <>
            <button
              type="button"
              onClick={find.open ? find.close : find.openFind}
              title={`Find in document (${FIND_SHORTCUT})`}
              aria-label="Find in document"
              aria-pressed={find.open}
              className={`p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer ${find.open ? 'text-gold dark:text-gold' : 'text-muted'}`}
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsPanelOpen(!isPanelOpen)}
              title={isPanelOpen ? 'Hide marks panel' : 'Show marks panel'}
              aria-label={isPanelOpen ? 'Hide marks panel' : 'Show marks panel'}
              // One glyph, not two. The note and the panel chevron said the same thing twice, and
              // read as two controls crammed into one button. Open state is carried by weight and
              // colour, the same way every other tool in this row shows it.
              className={`p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer transition-[background-color,transform] duration-150 ease-out active:scale-[0.94] ${
                isPanelOpen
                  ? 'text-gold dark:text-gold'
                  : 'text-muted'
              }`}
            >
              <StickyNote
                className="w-4 h-4"
                weight={isPanelOpen ? 'fill' : 'regular'}
              />
            </button>
            {onToggleFocus && (
              <HoverTooltip label={focusMode ? `Leave focus mode (${FOCUS_HOTKEY} or Esc)` : `Focus mode (${FOCUS_HOTKEY})`}>
                <button
                  type="button"
                  onClick={onToggleFocus}
                  aria-label={focusMode ? `Leave focus mode (${FOCUS_HOTKEY})` : `Focus mode (${FOCUS_HOTKEY})`}
                  aria-keyshortcuts={FOCUS_HOTKEY}
                  aria-pressed={focusMode}
                  className={`p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer ${focusMode ? 'text-gold dark:text-gold' : 'text-muted'}`}
                >
                  {focusMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </HoverTooltip>
            )}
          </>
        }
        tool={tool}
        onToolChange={handleToolTap}
        hasSelection={Boolean(pendingSelection?.length)}
        settings={settings}
        activeThemeId={activeThemeId}
        onThemeChange={setActiveThemeId}
        toolColors={toolColors}
        onToolColorChange={handleToolColorChange}
        toolWeights={toolWeights}
        onToolWeightChange={handleToolWeightChange}
        toolStrokeStyles={toolStrokeStyles}
        onToolStrokeStyleChange={handleToolStrokeStyleChange}
        noteStyle={noteStyle}
        onNoteStyleChange={handleNoteStyleChange}
        bracketSide={bracketSide}
        onBracketSideChange={handleBracketSideChange}
        textSize={textSize}
        onTextSizeChange={handleTextSizeChange}
        textAlign={textAlign}
        onTextAlignChange={handleTextAlignChange}
        textFont={textFont}
        onTextFontChange={handleTextFontChange}
        textBold={textBold}
        onTextBoldChange={handleTextBoldChange}
        textItalic={textItalic}
        onTextItalicChange={handleTextItalicChange}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo && !isInsertingPage && !isDeletingPage}
        canRedo={canRedo && !isInsertingPage && !isDeletingPage}
        openSubmenuFor={openSubmenuFor}
        onSubmenuOpened={() => setOpenSubmenuFor(null)}
        onSubmenuOpenChange={(id, open) => {
          if (!open) submenuClosedAt.current = { tool: id, at: performance.now() };
        }}
        scale={scale}
        onScaleChange={(next) => {
          zoomTouchedRef.current = true;
          setScale(next);
        }}
        onFitWidth={() => void fitWidth()}
        onFitPage={() => void fitPage()}
        currentPage={currentPage}
        pageCount={pageCount}
        onGoToPage={goToPage}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onInsertPage={() => setInsertPageMenuOpen(true)}
        markCount={annotations.length}
        onExport={() => void handleExport()}
        isExporting={isExporting}
        archiveRows={archiveRows(archive, annotations.length)}
        isDark={isDark}
      />
      {find.open && (
        <div className={`shrink-0 px-3 py-1.5 border-b ${isDark ? 'bg-night-2 border-stone-800' : 'bg-white border-stone-200'}`}>
          <FindBar find={find} isDark={isDark} />
        </div>
      )}
      </FocusChrome>
      {focusMode && onToggleFocus && <FocusExit onExit={onToggleFocus} isDark={isDark} />}
  </>
);
