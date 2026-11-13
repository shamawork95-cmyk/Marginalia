/**
 * The PDF workspace: our own viewer and annotation editor, with the notes panel beside it.
 *
 * Built on pdf.js directly rather than on a viewer library, because owning the annotation model
 * is what makes the rest possible — marks carry their theme, hovering a note can light up exactly
 * the passage it refers to, and the AI's extracted themes can become highlights without asking a
 * third party's permission.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReadingProgress } from '../../hooks/useReadingProgress';
import { GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { Loader2, ArrowLeft, Check } from '../icons';
import type { ThemeStore } from '../themeStore';
import { AnnotationFocus, Screen, TransitionType, UserSettings } from '../../types';
import { FractionRect } from './annotationModel';
import { useAnnotationHistory } from './useAnnotationHistory';
import { gateWhileBusy } from '../../hooks/debouncedSaver';
import { ErrorDialog } from '../ErrorDialog';
import { SelectionAnchor } from './SelectionPopover';
import { originalDocumentUrl, type PdfViewMode } from '../../utils/documentStorage';
import { usePdfToolStyles } from './workspace/usePdfToolStyles';
import { DEFAULT_ZOOM } from './workspace/docState';
import { useMarkGeometry } from './workspace/useMarkGeometry';
import { usePageEdits } from './workspace/usePageEdits';
import { useWorkspaceExtras } from './workspace/useWorkspaceExtras';
import { usePdfNavigation } from './workspace/usePdfNavigation';
import { useWorkspaceKeys } from './workspace/useWorkspaceKeys';
import { useTextMarking } from './workspace/useTextMarking';
import { useMarkMutations } from './workspace/useMarkMutations';
import { usePdfDocument } from './workspace/usePdfDocument';
import { WorkspaceDialogs } from './workspace/WorkspaceDialogs';
import { WorkspacePopovers } from './workspace/WorkspacePopovers';
import { WorkspaceBody } from './workspace/WorkspaceBody';
import { WorkspaceToolbar } from './workspace/WorkspaceToolbar';

// pdf.js parses off the main thread. Resolving the worker through `import.meta.url` lets the
// bundler fingerprint and ship it, which is what makes this work offline in the packaged app —
// a CDN worker URL would leave the viewer dead with no network.
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();


interface PdfWorkspaceProps {
  docId: string;
  /**
   * What the reader asked to be shown, when they opened this document by tapping a book on the
   * library dashboard rather than opening it outright. Turns into the navigator at the foot of
   * the page. See `AnnotationFocus`.
   */
  focus?: AnnotationFocus;
  /**
   * True when the reader asked to carry on with this book (Continue annotating), false when they
   * opened it fresh from the library. Only the PAGE is affected: zoom and single/spread view are
   * preferences about how a book is displayed and are restored either way, while the page is a
   * position in it, and someone opening a book has not asked to be put back where they stopped.
   */
  resumeReading?: boolean;
  documentTitle: string;
  settings: UserSettings;
  isDark?: boolean;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  /** Focus mode: header and toolbar step away (App owns it; F and Escape). */
  focusMode?: boolean;
  onToggleFocus?: () => void;
  /** Themes, for the selection menu's "+ New theme". */
  themeStore?: ThemeStore;
  /** Adds the themes a marks import brought with it. */
  onAddThemes?: (themes: UserSettings['activeThemes']) => void;
  /** Opened from a motif trace: the page to show first (1-based). */
  jumpToPage?: number;
}

export const PdfWorkspace: React.FC<PdfWorkspaceProps> = ({
  docId,
  documentTitle,
  focus,
  resumeReading = false,
  settings,
  isDark = false,
  onNavigate,
  focusMode = false,
  onToggleFocus,
  themeStore,
  onAddThemes,
  jumpToPage
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const pageCount = pdf?.numPages ?? 0;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scale, setScale] = useState(DEFAULT_ZOOM);
  /** Single page per row, or two side by side like an open book. */
  const [viewMode, setViewMode] = useState<PdfViewMode>('single');
  /** Guards the one-time fit, so re-rendering never overrides a zoom the reader chose. */
  const fittedRef = useRef<string | null>(null);
  /** Guards the one-time restore of the last page read, the same way `fittedRef` guards zoom. */
  const restoredPageRef = useRef<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  // How far through the PDF the reader has got (page of pages), saved debounced by the hook.
  const reportProgress = useReadingProgress(docId);
  useEffect(() => {
    if (pageCount > 0) reportProgress(currentPage, pageCount);
  }, [currentPage, pageCount, reportProgress]);
  const { activeColor, activeThemeId, activeThemeIds, toggleActiveTheme, bracketSide, noteStyle, setActiveThemeId, setBracketSide, setNoteStyle, setTextAlign, setTextBold, setTextFont, setTextItalic, setTextSize, setTool, setToolColor, setToolStrokeStyle, setToolWeight, textAlign, textBold, textFont, textItalic, textSize, tool, toolColors, toolStrokeStyles, toolWeights } = usePdfToolStyles({ settings });

  /**
   * The marks, behind an undo history.
   *
   * `commit` replaces `setAnnotations` everywhere below, which is what makes every tool undoable
   * without each one having to opt in — see `useAnnotationHistory`. `reset` is used only when the
   * stored set is read from disk, so undo can never reach back past the moment the document
   * opened and erase work from an earlier session.
   */
  const {
    annotations,
    commit,
    reset: resetAnnotations,
    undo: undoHistory,
    redo: redoHistory,
    canUndo,
    canRedo
  } = useAnnotationHistory();
  /**
   * True while a page insert/delete runs. Marks drawn then would carry pre-renumbering page
   * numbers and be dropped, so every mark change (tools, undo, redo) is ignored meanwhile.
   */
  const pageOpBusyRef = useRef(false);
  const setAnnotations = useMemo(() => gateWhileBusy(() => pageOpBusyRef.current, commit), [commit]);
  const undo = useMemo(() => gateWhileBusy(() => pageOpBusyRef.current, undoHistory), [undoHistory]);
  const redo = useMemo(() => gateWhileBusy(() => pageOpBusyRef.current, redoHistory), [redoHistory]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  /**
   * Whatever last failed in here.
   *
   * These operations used to fail into `console.error` or a bare `return`: an export that
   * produced no file, an inserted page that never appeared, a save that silently did not happen.
   * The last one is the reason this exists at all — marks the reader believes are on disk and are
   * not is the only failure in Marginalia that loses work.
   */
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * True once this document's zoom has been decided and applied.
   *
   * The instance navigator waits for it. Fitting the zoom re-lays out every page, which throws
   * away any scroll offset set before it — so jumping to the first mark the moment the marks
   * loaded landed correctly and was then silently undone, leaving the reader on page 1 of a
   * 180-page book with a pill claiming to be showing them mark 1 of 2.
   */
  const [layoutSettled, setLayoutSettled] = useState(false);

  /** Cleared when the reader dismisses the navigator; re-seeded if they arrive with a new focus. */
  const [activeFocus, setActiveFocus] = useState(focus ?? null);
  useEffect(() => setActiveFocus(focus ?? null), [focus]);

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isExporting, setIsExporting] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  /**
   * The text the reader has selected, remembered independently of which tool is active.
   *
   * This is what makes both orders of operation work. Selecting text and THEN tapping Highlight
   * has to apply to that selection, so the selection cannot be discarded just because no marking
   * tool was active when it was made. It is held until the reader selects something else or
   * clicks away, which also lets the same tool be tapped repeatedly to toggle the mark on and off.
   *
   * A selection can cross a page break, so it is stored as one group per page.
   */
  const [pendingSelection, setPendingSelection] = useState<
    { page: number; rects: FractionRect[]; quote: string }[] | null
  >(null);
  /** Where to put the selection menu, in viewport coordinates. */
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  /** Which tool's colour/thickness submenu to open next — see the selection menu below. */
  const [openSubmenuFor, setOpenSubmenuFor] = useState<string | null>(null);
  /**
   * When a tool's options panel last closed, and which tool's it was.
   *
   * A press on the tool button lands outside the panel, so the panel dismisses itself on
   * `pointerdown` — before the button's `click` handler has run. By the time the handler asks
   * "is this panel open?" the answer is already no, and it would dutifully open it again: the
   * panel would flicker shut and back, and could never be closed by tapping the tool. Recording
   * the moment it closed is how the handler tells "the press I am handling closed it" from "it
   * was closed long before this press".
   */
  const submenuClosedAt = useRef<{ tool: string; at: number } | null>(null);

  /**
   * Bumped after a page is inserted, to force the PDF to be refetched. `fileUrl` is otherwise a
   * stable string keyed only on `docId`, and the browser (and pdf.js's own cache) would
   * otherwise keep serving the pre-insertion bytes it already has for that exact URL.
   */
  const [fileVersion, setFileVersion] = useState(0);
  const fileUrl = `${originalDocumentUrl(docId, 'inline')}&v=${fileVersion}`;
  const { saver, zoomTouchedRef } = usePdfDocument({ annotations, docId, fileUrl, isLoaded, pdf, resetAnnotations, saveState, setAnnotations, setFailure, setIsLoaded, setLoadError, setPdf, setSaveState, settings });
  const { createAnnotation, deleteAnnotation, retagAnnotation, saveEditing, startEditing, startEditingId, updateAnnotation } = useMarkMutations({ annotations, draftText, editingId, setAnnotations, setDraftText, setEditingId, setSelectedId, settings });
  const { applyTextMark, createNoteForSelection, createReactionForSelection, handleBracketSideChange, handleNoteStyleChange, handleTextAlignChange, handleTextBoldChange, handleTextFontChange, handleTextItalicChange, handleTextSizeChange, handleToolColorChange, handleToolStrokeStyleChange, handleToolTap, handleToolWeightChange } = useTextMarking({ activeThemeId, activeThemeIds, annotations, pendingSelection, scrollRef, selectedId, setAnnotations, setBracketSide, setNoteStyle, setOpenSubmenuFor, setPendingSelection, setSelectedId, setSelectionAnchor, setTextAlign, setTextBold, setTextFont, setTextItalic, setTextSize, setTool, setToolColor, setToolStrokeStyle, setToolWeight, settings, startEditingId, submenuClosedAt, tool, toolColors, toolWeights });
  const { chooseSelectionTheme, createSelectionTheme } = useWorkspaceKeys({ activeThemeIds, toggleActiveTheme, createNoteForSelection, deleteAnnotation, editingId, handleToolTap, pendingSelection, redo, retagAnnotation, selectedId, selectionAnchor, setActiveThemeId, setSelectedId, setSelectionAnchor, setTool, setToolColor, settings, themeStore, tool, undo });
  const { bookOn, bookRef, bookTurnRef, fitWidth, goToPage, handleViewModeChange, pageRef, reduceMotion, scrollAnimation } = usePdfNavigation({ currentPage, docId, fittedRef, jumpToPage, pageCount, pdf, restoredPageRef, resumeReading, scale, scrollRef, setCurrentPage, setLayoutSettled, setScale, setViewMode, viewMode, zoomTouchedRef });
  const { archive, find, handleExport, markLinksFor, scrollToAnnotation } = useWorkspaceExtras({ annotations, bookTurnRef, currentPage, docId, documentTitle, editingId, fileUrl, goToPage, isDark, onAddThemes, pageRef, pdf, reduceMotion, resetAnnotations, saver, scrollAnimation, scrollRef, setAnnotations, setFailure, setIsExporting, setSelectedId, settings });
  const { handleDeletePage, handleInsertPage, insertHeight, insertPageMenuOpen, insertPlacement, isDeletingPage, isInsertingPage, setInsertHeight, setInsertPageMenuOpen, setInsertPlacement } = usePageEdits({ currentPage, docId, goToPage, pageCount, pageOpBusyRef, resetAnnotations, saver, setFailure, setFileVersion });
  const { byPage, editing, markRect, popoverTopInset, selectedMark } = useMarkGeometry({ annotations, editingId, focusMode, scale, scrollRef, selectedId });

  return (
    <div
      className={`flex flex-col h-screen max-h-screen min-h-0 overflow-hidden ${
        isDark ? 'bg-night' : 'bg-paper'
      }`}
    >
      <header
        hidden={focusMode}
        // `app-drag`: the desktop build has no system title bar, so this header is what the
        // window is moved by. Its own buttons opt out — see `.app-drag` in index.css.
        className={`app-drag flex items-center gap-3 px-4 py-2.5 border-b shrink-0 ${
          isDark ? 'bg-night-2 border-stone-800' : 'bg-white border-stone-200'
        }`}
      >
        <button
          type="button"
          onClick={() => onNavigate('home', 'push_back')}
          title="Back to My Collections"
          aria-label="Back to My Collections"
          className="p-1.5 rounded-lg text-muted hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="title-hand text-[22px] text-stone-900 dark:text-paper truncate flex-1 min-w-0">
          {documentTitle}
        </h1>
        <span className="text-[11px] text-muted flex items-center gap-1 shrink-0 w-20 justify-end">
          {saveState === 'saving' && (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving…
            </>
          )}
          {saveState === 'saved' && (
            <>
              <Check className="w-3 h-3 text-gold" />
              Saved
            </>
          )}
        </span>
      </header>

      <WorkspaceToolbar activeThemeId={activeThemeId} annotations={annotations} archive={archive} bracketSide={bracketSide} canRedo={canRedo} canUndo={canUndo} currentPage={currentPage} find={find} fitWidth={fitWidth} focusMode={focusMode} goToPage={goToPage} handleBracketSideChange={handleBracketSideChange} handleExport={handleExport} handleNoteStyleChange={handleNoteStyleChange} handleTextAlignChange={handleTextAlignChange} handleTextBoldChange={handleTextBoldChange} handleTextFontChange={handleTextFontChange} handleTextItalicChange={handleTextItalicChange} handleTextSizeChange={handleTextSizeChange} handleToolColorChange={handleToolColorChange} handleToolStrokeStyleChange={handleToolStrokeStyleChange} handleToolTap={handleToolTap} handleToolWeightChange={handleToolWeightChange} handleViewModeChange={handleViewModeChange} isDark={isDark} isDeletingPage={isDeletingPage} isExporting={isExporting} isInsertingPage={isInsertingPage} isPanelOpen={isPanelOpen} noteStyle={noteStyle} onToggleFocus={onToggleFocus} openSubmenuFor={openSubmenuFor} pageCount={pageCount} pendingSelection={pendingSelection} redo={redo} scale={scale} selectedId={selectedId} setActiveThemeId={setActiveThemeId} setInsertPageMenuOpen={setInsertPageMenuOpen} setIsPanelOpen={setIsPanelOpen} setOpenSubmenuFor={setOpenSubmenuFor} setScale={setScale} settings={settings} submenuClosedAt={submenuClosedAt} textAlign={textAlign} textBold={textBold} textFont={textFont} textItalic={textItalic} textSize={textSize} tool={tool} toolColors={toolColors} toolStrokeStyles={toolStrokeStyles} toolWeights={toolWeights} undo={undo} viewMode={viewMode} zoomTouchedRef={zoomTouchedRef} />

      <WorkspaceBody activeColor={activeColor} activeThemeIds={activeThemeIds} annotations={annotations} bookOn={bookOn} bookRef={bookRef} bracketSide={bracketSide} byPage={byPage} createAnnotation={createAnnotation} currentPage={currentPage} deleteAnnotation={deleteAnnotation} goToPage={goToPage} handleDeletePage={handleDeletePage} hoveredId={hoveredId} isDark={isDark} isPanelOpen={isPanelOpen} loadError={loadError} noteStyle={noteStyle} pageCount={pageCount} pdf={pdf} retagAnnotation={retagAnnotation} scale={scale} scrollRef={scrollRef} scrollToAnnotation={scrollToAnnotation} selectedId={selectedId} setCurrentPage={setCurrentPage} setHoveredId={setHoveredId} setSelectedId={setSelectedId} settings={settings} startEditing={startEditing} textAlign={textAlign} textBold={textBold} textFont={textFont} textItalic={textItalic} textSize={textSize} tool={tool} toolStrokeStyles={toolStrokeStyles} toolWeights={toolWeights} updateAnnotation={updateAnnotation} viewMode={viewMode} />

      <ErrorDialog open={Boolean(failure)} message={failure ?? ''} onClose={() => setFailure(null)} />
      {archive.ui}

      <WorkspacePopovers activeFocus={activeFocus} activeThemeId={activeThemeId} activeThemeIds={activeThemeIds} annotations={annotations} applyTextMark={applyTextMark} chooseSelectionTheme={chooseSelectionTheme} createNoteForSelection={createNoteForSelection} createReactionForSelection={createReactionForSelection} createSelectionTheme={createSelectionTheme} deleteAnnotation={deleteAnnotation} documentTitle={documentTitle} editing={editing} isDark={isDark} isLoaded={isLoaded} layoutSettled={layoutSettled} markLinksFor={markLinksFor} markRect={markRect} pageCount={pageCount} pendingSelection={pendingSelection} popoverTopInset={popoverTopInset} scrollRef={scrollRef} scrollToAnnotation={scrollToAnnotation} selectedMark={selectedMark} selectionAnchor={selectionAnchor} setActiveFocus={setActiveFocus} setHoveredId={setHoveredId} setSelectedId={setSelectedId} setSelectionAnchor={setSelectionAnchor} setTool={setTool} settings={settings} startEditing={startEditing} themeStore={themeStore} toolColors={toolColors} updateAnnotation={updateAnnotation} />

      <WorkspaceDialogs currentPage={currentPage} deleteAnnotation={deleteAnnotation} draftText={draftText} editing={editing} handleInsertPage={handleInsertPage} insertHeight={insertHeight} insertPageMenuOpen={insertPageMenuOpen} insertPlacement={insertPlacement} isDark={isDark} isInsertingPage={isInsertingPage} saveEditing={saveEditing} setDraftText={setDraftText} setInsertHeight={setInsertHeight} setInsertPageMenuOpen={setInsertPageMenuOpen} setInsertPlacement={setInsertPlacement} />
    </div>
  );
};
