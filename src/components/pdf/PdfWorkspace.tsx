/**
 * The PDF workspace: our own viewer and annotation editor, with the notes panel beside it.
 *
 * Built on pdf.js directly rather than on a viewer library, because owning the annotation model
 * is what makes the rest possible — marks carry their theme, hovering a note can light up exactly
 * the passage it refers to, and the AI's extracted themes can become highlights without asking a
 * third party's permission.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReadingProgress } from '../../hooks/useReadingProgress';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { Loader2, FileWarning, ArrowLeft, PanelRightClose, PanelRightOpen, Check, StickyNote, X, PanelTop, PanelBottom, FileStack, ChevronLeft, ChevronRight } from '../icons';
import { useReducedMotion } from 'motion/react';
import { playTurn, snapshotPage, turnDirection, type PageBox } from '../pageTurn';
import { FocusChrome, FocusExit, FOCUS_HOTKEY } from '../FocusMode';
import type { ThemeStore } from '../themeStore';
import { HoverTooltip } from '../HoverTooltip';
import { Maximize2, Minimize2, Search } from '../icons';
import { FindBar, FIND_SHORTCUT, useDocumentFind } from '../FindBar';
import { AnnotationFocus, Screen, TransitionType, UserSettings } from '../../types';
import {
  Annotation,
  AnnotationKind,
  BracketSide,
  DEFAULT_NOTE_SIZE,
  FractionRect,
  NoteStyle,
  DEFAULT_TEXT_SIZE,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont,
  annotationBounds,
  coveredFraction,
  isReaction,
  isTextAnchored,
  mergeRectsIntoLines,
  newAnnotationId,
  rectToFraction
} from './annotationModel';
import { useAnnotationHistory } from './useAnnotationHistory';
import { createDebouncedSaver, gateWhileBusy, runPageOperation } from '../../hooks/debouncedSaver';
import { registerUnloadFlush } from '../../hooks/unloadFlush';
import { PdfPage } from './PdfPage';
import { PdfToolbar, NEUTRAL_COLORS } from './PdfToolbar';
import { NotesList } from './NotesList';
import { InstanceNavigator } from './InstanceNavigator';
import { ErrorDialog } from '../ErrorDialog';
import { SelectionPopover, SelectionAnchor } from './SelectionPopover';
import { escapeConsumes, isTypingTarget, resolveWorkspaceKey } from './workspaceKeys';
import { LiveSelectionOverlay } from './LiveSelectionOverlay';
import { MarkProperties } from './MarkProperties';
import { ScrollPageIndicator } from './ScrollPageIndicator';
import { exportAnnotatedPdf, downloadBlob } from './exportAnnotatedPdf';
import { archiveRows, copyText, excerpt, useMarksArchive } from '../MarksArchive';
import type { LinkOption, MarkLinks } from './MarkProperties';
import { formatQuoteRef } from '../../utils/quoteRef';
import { linkMarks, linkedIds, unlinkMarks } from '../../utils/markLinks';
import { isAreaHighlight } from '../../utils/areaMark';
import { clippedRange } from '../../utils/selectionText';
import { looksLikeAppChrome, quoteFromTextItems, repairQuote, type PlacedTextItem } from './quoteRepair';
import { useSwipeTurn } from '../swipeTurn';
import {
  deletePage,
  checkpointMarkBackup,
  fetchAnnotations,
  fetchMarkBackups,
  fetchReadingState,
  insertPage,
  originalDocumentUrl,
  saveAnnotations,
  saveReadingState,
  PageInsertHeight,
  PageInsertPlacement,
  ReadingState,
  PDF_VIEW_MODES,
  type PdfViewMode
} from '../../utils/documentStorage';

// pdf.js parses off the main thread. Resolving the worker through `import.meta.url` lets the
// bundler fingerprint and ship it, which is what makes this work offline in the packaged app —
// a CDN worker URL would leave the viewer dead with no network.
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

/**
 * Where PDF.js finds its WebAssembly image decoders.
 *
 * Scanned books are very often JPEG 2000 or JBIG2 — both formats PDF.js decodes in WASM, and
 * both of which fail SILENTLY when the binaries cannot be found: the page renders, the text layer
 * builds, and every page comes out blank white with nothing logged. A 758-page Urdu scan did
 * exactly that. The directory is served unhashed by the `pdfjsWasm` plugin in `vite.config.ts`.
 */
const PDF_WASM_URL = '/pdf-wasm/';

/** How long to wait after the last change before writing to disk. */
const SAVE_DEBOUNCE_MS = 700;

/** Narrower than this, spread view scrolls its pairs instead of showing one open book. */
const MIN_BOOK_WIDTH = 700;

/** The zoom a document opens at when nothing was remembered about it yet. */
const DEFAULT_ZOOM = 1.25;

/**
 * What the instance navigator occupies at the foot of the window, pill plus its margin.
 *
 * Floating panels are told to stay above it. Staying inside the viewport is not the same as
 * staying out of the way: a properties strip clamped to the bottom edge landed on top of the
 * navigator and buried the controls the reader was mid-way through using.
 */
const NAVIGATOR_HEIGHT = 60;

/** Wheel-zoom bounds — the same floor and ceiling `fitWidth` and the toolbar's own zoom steps
 *  already clamp to, so scrolling to zoom never reaches a size the rest of the app disagrees with. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

/** Where each document's last zoom level and page are remembered between sessions. */
const DOC_STATE_PREFIX = 'marginalia_docstate_';

type StoredDocState = ReadingState;

/**
 * The fast, synchronous first read — localStorage resolves before any network round trip could,
 * so it is what the very first render uses. It is not the durable copy: see `fetchReadingState`
 * and the hydration effect below for why the server's copy wins once it loads.
 */
function loadDocState(docId: string): StoredDocState | null {
  try {
    const raw = localStorage.getItem(DOC_STATE_PREFIX + docId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.scale === 'number' && typeof parsed.page === 'number') {
      return { scale: parsed.scale, page: parsed.page, viewMode: PDF_VIEW_MODES.includes(parsed.viewMode) ? parsed.viewMode : 'single' };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveDocState(docId: string, state: StoredDocState) {
  try {
    localStorage.setItem(DOC_STATE_PREFIX + docId, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

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

  const [tool, setTool] = useState<PdfTool>('select');
  const [activeThemeId, setActiveThemeId] = useState<string | null>(settings.activeThemes[0]?.id ?? null);

  /**
   * A colour per tool, rather than one shared colour.
   *
   * Highlighting in yellow while underlining in red is the normal way people mark up a document,
   * and a single active colour forced a trip to the palette on every switch. Each tool remembers
   * its own, seeded from the themes so the defaults are already meaningful.
   */
  const [toolColors, setToolColors] = useState<Record<string, string>>(() => {
    const themes = settings.activeThemes;
    const pick = (index: number) => themes[index % Math.max(themes.length, 1)]?.color ?? NEUTRAL_COLORS[0];
    return {
      highlight: pick(0),
      area: pick(0),
      underline: pick(1),
      strikeout: pick(2),
      question: pick(3),
      star: pick(4),
      exclamation: pick(5),
      ink: pick(0),
      // Redaction reads as black by convention, independent of whatever theme colours are active.
      mask: '#000000',
      note: pick(0),
      rect: pick(1),
      ellipse: pick(1),
      arrow: pick(2),
      line: pick(2),
      text: pick(0)
    };
  });
  /** Stroke weight per tool, so a heavy pen and a fine box can coexist. */
  const [toolWeights, setToolWeights] = useState<Record<string, number>>({
    ink: 0.0028,
    // Much thicker than the pen by default — a mask needs to fully cover a line of text, not
    // trace it.
    mask: 0.02,
    rect: 0.0028,
    ellipse: 0.0028,
    arrow: 0.0028,
    line: 0.0028,
    underline: 0.0028,
    strikeout: 0.0028,
    // Stroked like the shapes, and without an entry its weight picker opened with no step
    // selected until the reader picked one.
    bracket: 0.0028
  });
  const setToolWeight = useCallback(
    (which: string, weight: number) => setToolWeights((prev) => ({ ...prev, [which]: weight })),
    []
  );

  /**
   * Dash pattern per tool, note fill and bracket direction.
   *
   * Per tool for the same reason colour is: a reader who rules solid boxes and dotted brackets
   * should not have to reset the dash pattern every time they switch between them.
   */
  const [toolStrokeStyles, setToolStrokeStyles] = useState<Record<string, StrokeStyle>>({});
  const setToolStrokeStyle = useCallback(
    (which: string, style: StrokeStyle) => setToolStrokeStyles((prev) => ({ ...prev, [which]: style })),
    []
  );
  const [noteStyle, setNoteStyle] = useState<NoteStyle>('outline');
  const [bracketSide, setBracketSide] = useState<BracketSide>('left');
  const [textSize, setTextSize] = useState<number>(DEFAULT_TEXT_SIZE);
  const [textAlign, setTextAlign] = useState<TextAlign>('left');
  const [textFont, setTextFont] = useState<TextFont>('sans');
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);

  const activeColor = toolColors[tool] ?? NEUTRAL_COLORS[0];
  const setToolColor = useCallback(
    (which: string, color: string) => setToolColors((prev) => ({ ...prev, [which]: color })),
    []
  );

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

  // ── Document ──
  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setLoadError(null);
    const task = getDocument({ url: fileUrl, wasmUrl: PDF_WASM_URL });
    task.promise.then(
      (doc) => {
        if (!cancelled) setPdf(doc);
      },
      (err) => {
        if (cancelled) return;
        console.error('Failed to open PDF:', err);
        setLoadError('This PDF could not be opened. Its original file may not have been stored, or it may be damaged.');
      }
    );
    // Destroying the loading task tears down the worker and the document with it, which is the
    // only teardown pdf.js exposes at this level.
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [fileUrl]);

  // ── Stored marks ──
  useEffect(() => {
    let cancelled = false;
    setIsLoaded(false);
    resetAnnotations([]);
    fetchAnnotations(docId).then((stored) => {
      if (cancelled) return;
      if (!stored) {
        // Deliberately NOT setting `isLoaded`: that flag is what unlocks the autosave, and saving
        // an empty set we never actually read would erase this document's marks from disk. The
        // workspace stays read-only until a real read succeeds.
        setFailure(
          'Could not read this document’s marks, so nothing can be saved. Close the workspace and open it again — your existing marks are untouched on disk.'
        );
        return;
      }
      resetAnnotations((stored.annotations as unknown as Annotation[]) || []);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [docId, resetAnnotations]);

  // ── Persistence ──
  /** Set the first time the reader changes zoom or view mode themselves. */
  const zoomTouchedRef = useRef(false);

  /**
   * The autosave. Paused while a page insert/delete renumbers marks on the server (checked when
   * the timer fires, not only when it is scheduled), flushed before such an operation, and
   * registered for the window-close/reload/quit flush — see `hooks/debouncedSaver`.
   */
  const saver = useMemo(
    () =>
      createDebouncedSaver<Annotation[]>({
        save: (marks) => saveAnnotations(docId, marks as never),
        delayMs: SAVE_DEBOUNCE_MS,
        onResult: (ok) => {
          setSaveState(ok ? 'saved' : 'idle');
          // Never stack: the save retries on every subsequent edit by itself, and one dialog per
          // keystroke would bury the document it is warning about.
          if (!ok) {
            setFailure(
              (current) =>
                current ??
                'Your most recent marks could not be saved to disk, so they exist only in this window. Do not close it until the Saved tick returns — every further change tries again.'
            );
          }
        }
      }),
    [docId]
  );

  useEffect(
    () =>
      registerUnloadFlush(saver, (marks) => ({
        url: `/api/documents/${docId}/annotations`,
        body: JSON.stringify({ annotations: marks })
      })),
    [saver, docId]
  );

  useEffect(() => {
    // Nothing is written until the stored set has been read, or an empty initial state would
    // overwrite the reader's existing marks the moment the document opened.
    if (!isLoaded) return;
    if (!saver.paused()) setSaveState('saving');
    saver.schedule(annotations);
  }, [annotations, isLoaded, saver]);

  // Flush anything still pending when the workspace closes, so marks made in the last moment
  // before navigating away are not lost with the timer. Every load schedules a save and so does
  // every edit (erasing the last mark included), so "pending" covers what the old unconditional
  // write did; a paused saver (marks left pre-renumbering) writes nothing.
  // Then keep a mark backup of this visit (the server skips it when nothing changed).
  useEffect(() => () => void saver.flush().then((ok) => ok && checkpointMarkBackup(docId)), [saver, docId]);

  /**
   * Quotes saved before 2.8.0 that picked up the sidebar and toolbar (see quoteRepair.ts), repaired
   * once per opening: rebuilt from the page's own text under each mark, else stripped, else
   * flagged for review. Only after a backup of the marks as they are is confirmed on disk.
   */
  const quoteRepairDone = useRef<string | null>(null);
  useEffect(() => {
    if (!pdf || !isLoaded || quoteRepairDone.current === docId) return;
    quoteRepairDone.current = docId;
    const suspects = annotations.filter((a) => a.rects?.length && looksLikeAppChrome(a.quote ?? ''));
    if (suspects.length === 0) return;
    let cancelled = false;
    void (async () => {
      await saver.flush();
      await checkpointMarkBackup(docId);
      const [newest] = (await fetchMarkBackups(docId)) ?? [];
      // No backup of the current set, no repair: it waits for the next opening.
      if (!newest || newest.markCount !== annotations.length || cancelled) return;
      const themeNames = settings.activeThemes.map((t) => t.name);
      const patches = new Map<string, Partial<Annotation>>();
      for (const page of [...new Set(suspects.map((a) => a.page))]) {
        let items: PlacedTextItem[] = [];
        try {
          const p = await pdf.getPage(page);
          const vp = p.getViewport({ scale: 1 });
          const content = await p.getTextContent();
          items = content.items.flatMap((it) => {
            if (!('str' in it)) return [];
            const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
            const h = Math.hypot(it.transform[2], it.transform[3]) || it.height;
            return [{ str: it.str, eol: it.hasEOL, box: { x: x / vp.width, y: (y - h) / vp.height, w: it.width / vp.width, h: h / vp.height } }];
          });
        } catch {
          // An unreadable page: its marks fall back to stripping.
        }
        for (const a of suspects.filter((s) => s.page === page)) {
          const fix = repairQuote(a.quote, items.length ? quoteFromTextItems(items, a.rects!) : null, themeNames);
          if (fix) patches.set(a.id, fix);
        }
      }
      if (cancelled || patches.size === 0) return;
      console.info(`[Marginalia] repaired ${patches.size} quote(s) that held app menu text in ${docId}`);
      setAnnotations((prev) => prev.map((a) => (patches.has(a.id) ? { ...a, ...patches.get(a.id) } : a)));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, isLoaded, docId]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = window.setTimeout(() => setSaveState('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [saveState]);

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

  const retagAnnotation = useCallback((id: string, themeId: string | null, color: string) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, themeId, color } : a)));
  }, []);

  // ── Text selection → highlight / underline / strikeout ──
  /**
   * Reads the live text selection into per-page groups of rectangles.
   *
   * Every client rect is kept rather than one bounding box: a selection spanning several lines
   * has a ragged outline, and a single box would tint the whitespace either side of it. Rects are
   * grouped by the page element containing them, so a selection dragged across a page break makes
   * one mark on each page rather than one mark whose coordinates make sense on neither.
   */
  const readSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    /*
     * Read page by page, from each page's text layer only. `Selection.toString()` and the range's
     * own rects run between the two ends in document order, so a drag begun just left of a line,
     * over the sidebar or the toolbar, used to put their labels in the quote (and a toolbar
     * scrolled over a page could add rects). Clipping the range to each text layer keeps exactly
     * the page's words and their boxes, one mark per page for a drag across a page break.
     */
    const groups: { page: number; rects: FractionRect[]; quote: string }[] = [];
    for (const pageEl of Array.from(document.querySelectorAll<HTMLElement>('[data-page-number]'))) {
      const layer = pageEl.querySelector('.marginalia-text-layer');
      const clip = layer ? clippedRange(range, layer) : null;
      if (!clip) continue;
      const quote = clip.toString().replace(/\s+/g, ' ').trim();
      // Zero-area rects are emitted for collapsed line ends and would render as invisible slivers
      // that are impossible to click or erase.
      const rects = Array.from(clip.getClientRects()).filter((r) => r.width >= 0.5 && r.height >= 0.5);
      if (!quote || rects.length === 0) continue;
      const pageBox = pageEl.getBoundingClientRect();
      groups.push({ page: Number(pageEl.dataset.pageNumber), rects: mergeRectsIntoLines(rects).map((r) => rectToFraction(r, pageBox)), quote });
    }
    return groups.length ? groups : null;
  }, []);

  /**
   * Identifies the mark a given selection would produce, so tapping the same tool twice removes
   * the one it just made instead of stacking a duplicate on top.
   *
   * Keyed on kind, page and the covered text, plus the position of the first rectangle — the text
   * alone is not enough, because the same phrase can appear twice on a page.
   */
  const matchesSelection = useCallback(
    (a: Annotation, group: { page: number; rects: FractionRect[]; quote: string }, kind: AnnotationKind) =>
      a.kind === kind &&
      a.page === group.page &&
      a.quote === group.quote &&
      Math.abs((a.rects?.[0]?.x ?? -1) - group.rects[0].x) < 0.004 &&
      Math.abs((a.rects?.[0]?.y ?? -1) - group.rects[0].y) < 0.004,
    []
  );

  /**
   * Whether a passage already carries a mark of this kind.
   *
   * Marking the same words twice with the same tool produces two stacked marks that darken each
   * other and have to be deleted separately, which is never what anybody meant — so it is simply
   * refused. The test is per LINE and by coverage rather than by exact match, because a reader
   * re-selecting a sentence almost never reproduces their original selection to the character;
   * what they mean by "this is already highlighted" is that the words are under a highlight, not
   * that the rectangles coincide.
   *
   * Extending a mark to a genuinely longer passage still works: the new lines are uncovered, so
   * the selection as a whole does not count as already marked.
   *
   * `isTerminology` narrows the match further: Highlight and Terminology both produce
   * `kind: 'highlight'` marks, but they are independent tools reader-wise, so highlighting an
   * already-terminology-tagged passage (or vice versa) must not read as "already marked."
   */
  const isAlreadyMarked = useCallback(
    (group: { page: number; rects: FractionRect[] }, kind: AnnotationKind, isTerminology = false, themeId: string | null = null) => {
      // Under another theme the same words can be marked again (one passage, several themes).
      const existing = annotations
        .filter(
          (a) =>
            a.kind === kind &&
            Boolean(a.isTerminology) === isTerminology &&
            (a.themeId ?? null) === themeId &&
            a.page === group.page &&
            a.rects?.length
        )
        .flatMap((a) => a.rects!);
      if (existing.length === 0) return false;
      // Every line has to be substantially covered. A little slack, because a selection's
      // rectangles run a hair wider than the glyphs they contain.
      return group.rects.every((rect) => coveredFraction(rect, existing) >= 0.8);
    },
    [annotations]
  );

  /**
   * Changing a tool's colour recolours what is already marked, rather than only affecting the
   * next mark.
   *
   * Picking a new colour with something selected reads as "make this that colour" — having to
   * choose the colour and then re-apply the tool was an extra step for the obvious intent. It
   * updates the selected mark, and any mark covering the current text selection.
   */
  const handleToolColorChange = useCallback(
    (which: string, color: string) => {
      setToolColor(which, color);
      setAnnotations((prev) => {
        const selected = prev.find((a) => a.id === selectedId);
        return prev.map((a) => {
          // The mark that is picked out — but only when the chip belongs to ITS kind. Changing
          // the pen's colour while a highlight happens to be selected should not repaint the
          // highlight.
          if (a.id === selectedId && a.kind === which) return { ...a, color };
          // Siblings from the same selection: a passage crossing a page break is several marks,
          // and recolouring only one of them would look like a bug.
          if (selected?.quote && a.kind === which && selected.kind === which && a.quote === selected.quote) {
            return { ...a, color };
          }
          if (
            a.kind === which &&
            pendingSelection?.some((g) => matchesSelection(a, g, which as AnnotationKind))
          ) {
            return { ...a, color };
          }
          return a;
        });
      });
    },
    [setToolColor, selectedId, pendingSelection, matchesSelection]
  );

  /** Thickness behaves the same way: it re-strokes the selected mark straight away. */
  const handleToolWeightChange = useCallback(
    (which: string, weight: number) => {
      setToolWeight(which, weight);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === which ? { ...a, weight } : a))
      );
    },
    [setToolWeight, selectedId, setAnnotations]
  );

  /** Dash pattern, likewise: set it for the tool, and re-dash whatever is selected. */
  const handleToolStrokeStyleChange = useCallback(
    (which: string, strokeStyle: StrokeStyle) => {
      setToolStrokeStyle(which, strokeStyle);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === which ? { ...a, strokeStyle } : a))
      );
    },
    [setToolStrokeStyle, selectedId, setAnnotations]
  );

  const handleNoteStyleChange = useCallback(
    (style: NoteStyle) => {
      setNoteStyle(style);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'note' ? { ...a, noteStyle: style } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleBracketSideChange = useCallback(
    (side: BracketSide) => {
      setBracketSide(side);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'bracket' ? { ...a, bracketSide: side } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleTextSizeChange = useCallback(
    (fontSize: number) => {
      setTextSize(fontSize);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, fontSize } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleTextAlignChange = useCallback(
    (align: TextAlign) => {
      setTextAlign(align);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, align } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  /**
   * Typeface, bold and italic all behave the same way: they set what the next text box will use,
   * and restyle the selected one straight away.
   */
  const handleTextFontChange = useCallback(
    (font: TextFont) => {
      setTextFont(font);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, font } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleTextBoldChange = useCallback(
    (bold: boolean) => {
      setTextBold(bold);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, bold } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  const handleTextItalicChange = useCallback(
    (italic: boolean) => {
      setTextItalic(italic);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId && a.kind === 'text' ? { ...a, italic } : a))
      );
    },
    [selectedId, setAnnotations]
  );

  /**
   * Applies a text mark to a selection, skipping any part of it that already carries one.
   *
   * Never toggles. Reaching for the highlighter over an already-highlighted sentence means "this
   * should be highlighted", and having that silently delete the highlight was the most alarming
   * thing the editor did. A mark is removed deliberately, from its own properties strip.
   */
  const applyTextMark = useCallback(
    (
      tool: PdfTool,
      groups: { page: number; rects: FractionRect[]; quote: string }[],
      colorOverride?: string
    ) => {
      // `terminology` is a toolbar tool, not a stored kind (see PdfTool) — it produces an ordinary
      // highlight flagged `isTerminology`, coloured from the live setting rather than a tool
      // colour, so it is exempt from recolouring here even if one were ever passed.
      const isTerminology = tool === 'terminology';
      const kind: AnnotationKind = isTerminology ? 'highlight' : (tool as AnnotationKind);
      const additions = groups
        .filter((g) => !isAlreadyMarked(g, kind, isTerminology, activeThemeId))
        .map<Annotation>((g) => ({
          id: newAnnotationId(),
          page: g.page,
          kind,
          color: isTerminology ? settings.terminologyColor : colorOverride ?? toolColors[kind] ?? NEUTRAL_COLORS[0],
          themeId: activeThemeId,
          isTerminology: isTerminology || undefined,
          rects: g.rects,
          quote: g.quote,
          weight: toolWeights[kind],
          author: settings.name,
          createdAt: new Date().toISOString()
        }));

      // Every page of the selection was already marked this way. Nothing to add, and nothing to
      // undo either — the reader is looking at the mark they were about to make.
      if (additions.length === 0) {
        setPendingSelection(null);
        return;
      }
      setAnnotations((prev) => [...prev, ...additions]);

      /*
        The new mark becomes the selected one.

        This is what makes changing colour afterwards work at all. Applying a mark clears the text
        selection, and the trailing mouseup then clears `pendingSelection` — so without this there
        was nothing left for a colour change to act on, and picking a colour appeared to do
        nothing. Selecting the mark also means a second toolbar tap cannot silently undo it, since
        there is no live selection left to toggle against.
      */
      setSelectedId(additions[0].id);
      setPendingSelection(null);
    },
    [isAlreadyMarked, toolColors, activeThemeId, settings.name, settings.terminologyColor, toolWeights, setAnnotations]
  );

  /**
   * Remembers the selection on mouse release, and marks it straight away when a text tool is
   * already active.
   *
   * Reading on release rather than on every selection change means the mark is made once the
   * reader has finished dragging, instead of on each intermediate selection.
   */
  useEffect(() => {
    /** Reads the live selection into state; `byPointer` is false for a keyboard selection. */
    const sync = (byPointer: boolean) => {
      // Typing a new theme's name in the selection menu moves the browser's selection; the passage stays.
      if ((document.activeElement as HTMLElement | null)?.closest('[data-keep-selection]')) return;
      const groups = readSelection();
      if (!groups) {
        // A click that collapses the selection clears it, so a later tool tap does not apply to
        // something the reader has visibly moved on from.
        if (!window.getSelection()?.toString().trim()) {
          setPendingSelection(null);
          setSelectionAnchor(null);
        }
        return;
      }
      // Marking by selection always adds — never undoes. Only on release of a drag: a keyboard
      // selection grows a character at a time, and an armed tool would mark every pause in it.
      // The new mark is selected, so its properties toolbar is the one that shows; the selection
      // menu stays closed (both at once stacked a second toolbar over the passage).
      if (byPointer && isTextAnchored(tool)) {
        applyTextMark(tool, groups);
        setSelectionAnchor(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
      setPendingSelection(groups);

      // Anchor the menu to the selection's own rectangle.
      const sel = window.getSelection();
      const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if (rect && rect.width + rect.height > 0) {
        setSelectionAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom });
      }
    };

    const handleUp = () => window.setTimeout(() => sync(true), 0);

    /*
      Keyboard selection (Shift+Arrow) never produces a mouseup, so the menu also follows
      `selectionchange` — debounced, so it opens once the reader pauses rather than on every
      character, and only when the last input was a key, so a drag is still read on release only.
    */
    let lastInputWasKey = false;
    let timer: number | undefined;
    const onPointerDown = () => {
      lastInputWasKey = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTypingTarget(e.target)) lastInputWasKey = true;
    };
    const onSelectionChange = () => {
      if (!lastInputWasKey) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const sel = window.getSelection();
        const node = sel?.anchorNode;
        // Only selections in the document itself, not in a field or the side panel.
        if (node && !scrollRef.current?.contains(node)) return;
        sync(false);
      }, 300);
    };

    document.addEventListener('mouseup', handleUp);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [tool, readSelection, applyTextMark]);

  /**
   * Writes a sticky note about the selected passage.
   *
   * The note is placed to the RIGHT of the passage where there is usually margin, dropping below
   * it when the page is too narrow — a note laid on top of the text it discusses would hide the
   * thing it refers to. The passage itself is stored on the note so hovering can light it back up.
   */
  const createNoteForSelection = useCallback(() => {
    const groups = pendingSelection;
    if (!groups?.length) return;
    const group = groups[0];
    const bounds = {
      x: Math.min(...group.rects.map((r) => r.x)),
      y: Math.min(...group.rects.map((r) => r.y)),
      right: Math.max(...group.rects.map((r) => r.x + r.w)),
      bottom: Math.max(...group.rects.map((r) => r.y + r.h))
    };

    const { w, h } = DEFAULT_NOTE_SIZE;
    const fitsBeside = bounds.right + 0.02 + w <= 1;
    const box = {
      x: fitsBeside ? bounds.right + 0.02 : Math.min(bounds.x, 1 - w),
      y: Math.min(fitsBeside ? bounds.y : bounds.bottom + 0.015, 1 - h),
      w,
      h
    };

    const note: Annotation = {
      id: newAnnotationId(),
      page: group.page,
      kind: 'note',
      color: toolColors.note ?? NEUTRAL_COLORS[0],
      themeId: activeThemeId,
      box,
      anchorRects: group.rects,
      quote: group.quote,
      text: '',
      author: settings.name,
      createdAt: new Date().toISOString()
    };
    setAnnotations((prev) => [...prev, note]);
    setSelectionAnchor(null);
    window.getSelection()?.removeAllRanges();
    startEditingId(note.id, '');
  }, [pendingSelection, toolColors, activeThemeId, settings.name]);

  /**
   * Stamps a question mark, asterisk or exclamation mark next to the start of the selected
   * passage.
   *
   * Placed like a note is — its own `box`, sized from `fontSize` — rather than tinted across every
   * line the way highlight/underline/strikeout are, since the point is a reaction to a moment in
   * the text, not a claim about which words it covers. That's also what makes it draggable,
   * resizable and recolourable afterward through the same controls a note or text box uses.
   */
  const createReactionForSelection = useCallback(
    (kind: AnnotationKind) => {
      const groups = pendingSelection;
      if (!groups?.length) return;
      const group = groups[0];
      const first = group.rects[0];
      const fontSize = DEFAULT_TEXT_SIZE;
      // A little larger than the glyph itself, for a comfortable click/drag target, and — since
      // `w` reads against PAGE WIDTH while `h` reads against the taller PAGE HEIGHT — `w` needs
      // the bigger multiplier or a "round" badge on a portrait page comes out visibly an oval.
      const h = fontSize * 1.35;
      const w = h * 1.3;
      const box = {
        x: Math.max(0, first.x - w - 0.008),
        y: Math.min(Math.max(0, first.y + first.h / 2 - h / 2), 1 - h),
        w,
        h
      };

      const reaction: Annotation = {
        id: newAnnotationId(),
        page: group.page,
        kind,
        color: toolColors[kind] ?? NEUTRAL_COLORS[0],
        themeId: activeThemeId,
        box,
        fontSize,
        anchorRects: group.rects,
        quote: group.quote,
        author: settings.name,
        createdAt: new Date().toISOString()
      };
      setAnnotations((prev) => [...prev, reaction]);
      setSelectedId(reaction.id);
      setSelectionAnchor(null);
      window.getSelection()?.removeAllRanges();
    },
    [pendingSelection, toolColors, activeThemeId, settings.name]
  );

  /**
   * A tool button was tapped.
   *
   * When text is already selected and the tool is a text one, the tap acts on that selection
   * immediately — which is the "select first, then choose what to do with it" order. The tool also
   * becomes active, so the next selection is marked without a second tap.
   */
  const handleToolTap = useCallback(
    (next: PdfTool) => {
      /*
        Two orders of operation, and they mean different things.

        Selecting a passage FIRST and then reaching for a tool is a one-off action on that
        passage: mark this, and be done. So the mark is made and the workspace drops straight
        back to Select, ready for the next passage — leaving the highlighter armed would mean
        the reader's next drag silently highlighted something they only meant to read.

        Choosing the tool FIRST and then selecting is the opposite intent: the reader is settling
        in to highlight several passages in a row, and the tool stays armed until they change it.
      */
      const actsOnSelection = isTextAnchored(next) && Boolean(pendingSelection?.length);
      if (actsOnSelection) {
        applyTextMark(next, pendingSelection!);
        setTool('select');
        setSelectionAnchor(null);
        setOpenSubmenuFor(null);
        return;
      }

      /*
        Tapping the tool you are already holding shows and hides its options. It does NOT put the
        tool down: picking a tool both arms it and opens its colour and thickness controls, and
        the reader's next thought is usually "chosen — now get this panel out of my way".
        Disarming there would mean the gesture for dismissing a panel silently disarmed the
        highlighter mid-passage. Escape is what puts a tool down.

        The panel closes itself the moment this button is pressed, since a press outside it
        dismisses it. So closing is simply declining to ask for it back.
      */
      if (next === tool && next !== 'select') {
        const justClosed =
          submenuClosedAt.current?.tool === next &&
          performance.now() - submenuClosedAt.current.at < 350;
        // Cleared either way, so a panel dismissed by pressing the PAGE cannot swallow the next
        // tap on the tool itself.
        submenuClosedAt.current = null;
        if (justClosed) return;
        setOpenSubmenuFor(next);
        return;
      }

      setTool(next);
      // Picking up a tool opens its options with it. Colour and thickness are chosen far more
      // often at the moment of switching tools than at any other time, and requiring a second
      // click on a chip the size of a grain of rice to reach them was a tax on the common case.
      // Select, Erase and Terminology have nothing to configure — a terminology mark's colour is
      // the single setting in Settings → Terminology, not a per-tool choice.
      setOpenSubmenuFor(next === 'select' || next === 'erase' || next === 'terminology' ? null : next);
    },
    [pendingSelection, applyTextMark, tool]
  );

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

  // ── Navigation & zoom ──
  /**
   * The spread as a book: only the open pair is drawn, and moving to another pair turns a leaf
   * (`pageTurn.ts`). Narrower than two readable pages, spread view keeps its old scrolling pairs.
   */
  const reduceMotion = useReducedMotion();
  const [areaWidth, setAreaWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setAreaWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [pdf]);
  const bookOn = viewMode === 'spread' && areaWidth >= MIN_BOOK_WIDTH;
  const bookRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<{ finish: () => void } | null>(null);
  useEffect(() => () => turnRef.current?.finish(), []);
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;
  const turnToPage = (page: number, animate: boolean) => {
    const from = Math.floor((pageRef.current - 1) / 2);
    const to = Math.floor((page - 1) / 2);
    const dir = turnDirection(from, to);
    pageRef.current = page;
    setCurrentPage(page);
    const book = bookRef.current;
    if (!dir || !book || !animate) return;
    turnRef.current?.finish();
    const origin = book.getBoundingClientRect();
    const pageEl = (n: number) => book.querySelector<HTMLElement>(`[data-page-number="${n}"]`);
    const boxOf = (el: HTMLElement): PageBox => {
      const r = el.getBoundingClientRect();
      return { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
    };
    const L = pageEl(2 * from + 1);
    const R = pageEl(2 * from + 2);
    if (!L) return;
    const left = boxOf(L);
    const right = R ? boxOf(R) : { ...left, left: left.left + left.width };
    const t = playTurn({
      layer: book,
      left,
      right,
      dir,
      front: (dir === 1 ? R : L) ? snapshotPage((dir === 1 ? R : L)!) : null,
      cover: (dir === 1 ? L : R) ? snapshotPage((dir === 1 ? L : R)!) : null,
      back: () => {
        const el = pageEl(dir === 1 ? 2 * to + 1 : 2 * to + 2);
        if (!el) return null;
        const copy = snapshotPage(el);
        // Drawn offstage until now: the copy takes the face's place, not the offstage spot.
        for (const p of ['position', 'left', 'top', 'visibility', 'pointer-events']) copy.style.removeProperty(p);
        return copy;
      },
      reduced: Boolean(reduceMotion)
    });
    turnRef.current = t;
  };
  const bookTurnRef = useRef<((page: number, animate: boolean) => void) | null>(null);
  bookTurnRef.current = bookOn ? turnToPage : null;

  // Arrow keys and Page Up / Down turn the book; never while typing or in a dialog.
  useEffect(() => {
    if (!bookOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const step = e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const pair = Math.floor((pageRef.current - 1) / 2) + step;
      const page = Math.min(pageCount, Math.max(1, pair * 2 + 1));
      if (page !== pageRef.current) bookTurnRef.current?.(page, true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bookOn, pageCount]);

  // A sideways swipe (finger, pen, trackpad) turns the book too.
  const swipeTurn = useCallback(
    (step: 1 | -1) => {
      const pair = Math.floor((pageRef.current - 1) / 2) + step;
      const page = Math.min(pageCount, Math.max(1, pair * 2 + 1));
      if (page !== pageRef.current) bookTurnRef.current?.(page, true);
    },
    [pageCount]
  );
  useSwipeTurn(scrollRef, swipeTurn, bookOn);

  const goToPage = useCallback((page: number, animate = true) => {
    if (bookTurnRef.current) return bookTurnRef.current(page, animate);
    scrollRef.current
      ?.querySelector(`[data-page-number="${page}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrentPage(page);
  }, []);

  /**
   * Opens a document at 125% zoom — the size most letter/A4-ish pages read comfortably at —
   * unless a zoom was already remembered for this document, in which case that wins.
   *
   * The 125% default is clamped by a fit-to-width fallback for pages whose own geometry makes it
   * a bad fit: an Urdu collection scanned at 122x173 points once came out as postage stamps three
   * fingers wide at a fixed zoom, unreadable and impossible to annotate, and an oversized page box
   * would just as wrongly spill far past the viewer. Fitting the width in either of those cases
   * makes the page as large as there is room for, given its own dimensions. Done once per
   * document, so a zoom the reader sets afterwards is never overridden.
   */
  useEffect(() => {
    if (!pdf || fittedRef.current === docId) return;
    const container = scrollRef.current;
    if (!container || container.clientWidth === 0) return;

    const stored = loadDocState(docId);
    if (stored) {
      fittedRef.current = docId;
      setScale(stored.scale);
      setViewMode(stored.viewMode);
      setLayoutSettled(true);
      return;
    }

    let cancelled = false;
    void pdf.getPage(1).then((page) => {
      if (cancelled) return;
      const unscaled = page.getViewport({ scale: 1 });
      const fit = (container.clientWidth - 48) / unscaled.width;
      const renderedAtDefault = unscaled.width * DEFAULT_ZOOM;
      const badFit = renderedAtDefault < container.clientWidth * 0.5 || renderedAtDefault > container.clientWidth * 2.5;
      fittedRef.current = docId;
      setScale(badFit ? Math.max(0.5, Math.min(3, fit)) : DEFAULT_ZOOM);
      setLayoutSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, docId]);

  /** Restores the page the reader was last on, once per document, after that zoom is settled. */
  useEffect(() => {
    if (!pdf || pageCount === 0 || restoredPageRef.current === docId) return;
    restoredPageRef.current = docId;
    if (jumpToPage && jumpToPage >= 1 && jumpToPage <= pageCount) {
      requestAnimationFrame(() => goToPage(jumpToPage, false));
      return;
    }
    if (!resumeReading) return;
    const stored = loadDocState(docId);
    if (stored && stored.page > 1 && stored.page <= pageCount) {
      // The page elements render synchronously off `pageCount`, but a frame gives layout a
      // moment to settle before `scrollIntoView` measures it.
      requestAnimationFrame(() => goToPage(stored.page, false));
    }
  }, [pdf, pageCount, docId, goToPage, resumeReading, jumpToPage]);

  /**
   * Fetches the server's saved reading position once per document — the durable copy, since it
   * lives outside the browser's localStorage (see `ReadingState`'s doc comment). Applied by the
   * effect below once the page count is known, so an out-of-range page can be validated exactly
   * as the local restore effect above already does.
   */
  const [remoteReadingState, setRemoteReadingState] = useState<ReadingState | null>(null);
  const fetchedReadingStateFor = useRef<string | null>(null);
  useEffect(() => {
    if (!docId || fetchedReadingStateFor.current === docId) return;
    fetchedReadingStateFor.current = docId;
    setRemoteReadingState(null);
    void fetchReadingState(docId).then(setRemoteReadingState);
  }, [docId]);

  const appliedReadingStateFor = useRef<string | null>(null);
  useEffect(() => {
    if (!remoteReadingState || !docId || pageCount === 0 || appliedReadingStateFor.current === docId) return;
    appliedReadingStateFor.current = docId;
    fittedRef.current = docId;
    restoredPageRef.current = docId;
    // Not applied over a zoom the reader set while the fetch was in flight — pressing Zoom In
    // twice on open used to snap back to the stored value when the response landed.
    if (!zoomTouchedRef.current) {
      setScale(remoteReadingState.scale);
      setViewMode(remoteReadingState.viewMode);
    }
    setLayoutSettled(true);
    if (resumeReading && remoteReadingState.page > 1 && remoteReadingState.page <= pageCount) {
      requestAnimationFrame(() => goToPage(remoteReadingState.page, false));
    }
    // The stored position is left as it is on a fresh open — the reader has not moved yet, and
    // overwriting page 1 over it here would destroy the very position Continue annotating needs.
    if (resumeReading) saveDocState(docId, remoteReadingState);
  }, [remoteReadingState, pageCount, docId, goToPage, resumeReading]);

  /**
   * Remembers this document's zoom, page and view mode so reopening it resumes where the reader
   * left off — to localStorage immediately (fast, same-session cache) and to the server,
   * debounced, so scrolling through a book doesn't fire a write on every frame.
   */
  /** Set the moment a fresh open actually leaves page one. See the save effect below. */
  const movedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current !== docId) return;
    if (currentPage > 1) movedRef.current = true;

    // A fresh open sits on page one having read nothing, so writing that as the position would
    // erase wherever the reader actually stopped last time — the position Continue annotating
    // exists to return to. Zoom and view mode are still recorded, since changing those IS an
    // action the reader just took.
    const keepStoredPage = !resumeReading && !movedRef.current;
    const state: StoredDocState = {
      scale,
      page: keepStoredPage ? (loadDocState(docId)?.page ?? currentPage) : currentPage,
      viewMode
    };
    saveDocState(docId, state);
    const timer = setTimeout(() => { void saveReadingState(docId, state); }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [scale, currentPage, viewMode, docId, resumeReading]);

  const fitWidth = useCallback(async () => {
    if (!pdf || !scrollRef.current) return;
    const page = await pdf.getPage(currentPage);
    const unscaled = page.getViewport({ scale: 1 });
    setScale(Math.max(0.25, Math.min(5, (scrollRef.current.clientWidth - 48) / unscaled.width)));
  }, [pdf, currentPage]);

  /** The row gap between two pages in a spread — matches the `gap-5` (1.25rem) the layout below uses. */
  const SPREAD_GAP_PX = 20;


  /**
   * Switching to spread view without also shrinking the zoom left two full-width pages competing
   * for the window's width — they simply wrapped onto separate lines via `flex-wrap`, so the
   * layout looked unchanged and the toggle read as broken. Real two-page views solve this the
   * same way "Fit to width" already solves the one-page case: compute a scale two pages plus the
   * gap between them actually fit at, and apply it the moment the mode is switched on.
   */
  const handleViewModeChange = useCallback(
    (mode: PdfViewMode) => {
      zoomTouchedRef.current = true;
      setViewMode(mode);
      if (!pdf || !scrollRef.current) return;
      const container = scrollRef.current;
      void pdf.getPage(currentPage).then((page) => {
        const unscaled = page.getViewport({ scale: 1 });
        // Spread halves the width each page gets, so it refits to two-up. Going back refits to
        // one — without that the document stayed at the shrunken spread zoom, half the size of
        // the window, and the reader had to zoom back by hand.
        const usable = container.clientWidth - 48;
        // The book shows one pair at a time, so the pair fits the height too (40: the area's padding).
        // A grid fits its columns across and its two rows down, so the whole set is in view.
        const cols = mode === 'grid6' ? 3 : mode === 'grid4' || mode === 'spread' ? 2 : 1;
        const rows = mode === 'grid4' || mode === 'grid6' ? 2 : 1;
        const fit =
          mode === 'single'
            ? usable / unscaled.width
            : Math.min(
                (usable - (cols - 1) * SPREAD_GAP_PX) / (cols * unscaled.width),
                (container.clientHeight - 40 - (rows - 1) * SPREAD_GAP_PX) / (rows * unscaled.height)
              );
        setScale(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit)));
      });
    },
    [pdf, currentPage]
  );

  /**
   * Where the pointer was, in content coordinates, at the moment a wheel-zoom last changed
   * `scale` — read once by the layout effect below and cleared, so a zoom the toolbar's buttons
   * trigger (which never sets this) doesn't move the scroll position at all.
   */
  const wheelZoomAnchorRef = useRef<{ contentX: number; contentY: number; viewportX: number; viewportY: number; prevScale: number } | null>(null);

  /**
   * Ctrl+wheel and trackpad pinch both zoom the page under the cursor — Chromium reports a
   * trackpad pinch as a wheel event with `ctrlKey` set, indistinguishable from a physical
   * Ctrl+scroll, so one handler covers both. The browser's own page-zoom gesture is suppressed
   * with `preventDefault` so it doesn't fight this one; `{ passive: false }` is required for that
   * to have any effect.
   *
   * The exponential response (`Math.exp` rather than a fixed step) keeps the feel proportionate
   * whether `deltaY` arrives as the small fractional values a trackpad sends many times a second
   * or the larger, coarser notches a physical mouse wheel sends — unlike the toolbar's zoom
   * buttons, which deliberately snap to fixed steps instead.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const viewportX = e.clientX - rect.left;
      const viewportY = e.clientY - rect.top;

      setScale((prev) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * Math.exp(-e.deltaY * 0.01)));
        if (next === prev) return prev;
        wheelZoomAnchorRef.current = {
          contentX: el.scrollLeft + viewportX,
          contentY: el.scrollTop + viewportY,
          viewportX,
          viewportY,
          prevScale: prev
        };
        return next;
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /**
   * Restores the point under the cursor to the same screen position after a wheel-zoom resizes
   * the pages — must run after layout so it measures the container at the new scale, not the one
   * mid-transition.
   */
  useLayoutEffect(() => {
    const anchor = wheelZoomAnchorRef.current;
    const el = scrollRef.current;
    wheelZoomAnchorRef.current = null;
    if (!anchor || !el) return;
    const ratio = scale / anchor.prevScale;
    el.scrollLeft = anchor.contentX * ratio - anchor.viewportX;
    el.scrollTop = anchor.contentY * ratio - anchor.viewportY;
  }, [scale]);

  /** The scroll animation in flight, so a new jump replaces it rather than fighting it. */
  const scrollAnimation = useRef<number | null>(null);

  /**
   * Brings a mark into view, reporting whether it could.
   *
   * Animated by hand rather than with `scrollTo({ behavior: 'smooth' })`, because the target
   * moves while the scroll runs: pages above are still settling to their real heights, which at
   * high zoom in a long book is centimetres of drift. The browser's smooth scroll commits to the
   * distance it was given and lands short, so this used to fire two corrective jumps after it —
   * a glide, then a stutter, then another. Recomputing the destination every frame absorbs that
   * drift continuously instead, and the mark simply arrives.
   *
   * Cubic ease-out over 380ms: fast at the start, where the eye is watching, settling at the end.
   * A jump already on screen is left alone — re-centring something the reader can already see is
   * movement for its own sake — and `prefers-reduced-motion` gets the destination with no travel.
   *
   * The boolean matters for the instance navigator, which jumps to the first match the moment the
   * document loads, when the page elements may not exist yet. Returning false rather than failing
   * silently is what lets the caller try again on the next frame.
   */
  const scrollToAnnotation = useCallback((a: Annotation): boolean => {
    // In the book, a mark on another pair turns there first; the caller retries once it is drawn.
    if (bookTurnRef.current && Math.floor((a.page - 1) / 2) !== Math.floor((pageRef.current - 1) / 2)) {
      bookTurnRef.current(a.page, true);
      return false;
    }
    const container = scrollRef.current;
    const pageEl = container?.querySelector<HTMLElement>(`[data-page-number="${a.page}"]`);
    // A page that has not been measured yet still has a height — `PdfPage` gives it a 60vh
    // placeholder — so "it rendered" is not the same as "it is the right size". Jumping against a
    // placeholder lands near the mark rather than on it, and the caller's retry never fired
    // because this reported success.
    if (!container || !pageEl || pageEl.dataset.pageSized !== 'true') return false;

    const bounds = annotationBounds(a);
    /**
     * The page's top within the SCROLL CONTAINER's coordinates.
     *
     * `offsetTop` is measured from the nearest positioned ancestor, and nothing between the page
     * and `<body>` is positioned — so it also counted the header and the toolbar above the
     * viewer, about 135px that is not part of the scrollable content. Every jump over-scrolled by
     * that much, which on a short window put the mark above the visible area entirely. Both
     * elements share the same offsetParent, so subtracting the container's own offset cancels it.
     */
    const pageTop = () => pageEl.offsetTop - container.offsetTop;
    const destination = () => {
      const raw = bounds
        ? pageTop() + bounds.y * pageEl.offsetHeight - container.clientHeight / 3
        : pageTop();
      return Math.max(0, Math.min(raw, container.scrollHeight - container.clientHeight));
    };

    // A jump replaces whatever is in flight — including on the paths that return early below,
    // or a half-finished glide would carry on to the previous mark after arriving at this one.
    if (scrollAnimation.current !== null) {
      cancelAnimationFrame(scrollAnimation.current);
      scrollAnimation.current = null;
    }

    // Already comfortably in view: leave it where it is.
    if (bounds) {
      const markTop = pageTop() + bounds.y * pageEl.offsetHeight - container.scrollTop;
      const markBottom = markTop + bounds.h * pageEl.offsetHeight;
      const margin = container.clientHeight * 0.12;
      if (markTop > margin && markBottom < container.clientHeight - margin) return true;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container.scrollTop = destination();
      return true;
    }

    const from = container.scrollTop;
    const startedAt = performance.now();
    const DURATION_MS = 380;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / DURATION_MS);
      container.scrollTop = from + (destination() - from) * easeOut(t);
      scrollAnimation.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    scrollAnimation.current = requestAnimationFrame(step);
    return true;
  }, []);

  // A workspace torn down mid-jump must not leave a frame callback writing to a dead node.
  useEffect(
    () => () => {
      if (scrollAnimation.current !== null) cancelAnimationFrame(scrollAnimation.current);
    },
    []
  );

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const safe = (documentTitle || 'document').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
      const blob = await exportAnnotatedPdf(fileUrl, annotations, `${safe}_annotated.pdf`, settings.terminologyColor);
      downloadBlob(blob, `${safe}_annotated.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
      setFailure(
        'Could not build the annotated PDF. The source file may have changed on disk since this document was opened. Press Export PDF again to retry.'
      );
    } finally {
      setIsExporting(false);
    }
  }, [fileUrl, annotations, documentTitle, settings.terminologyColor]);

  // ── Find in document (Cmd+F) ──
  /** Each page's text-layer string, read from pdf.js the first time find opens on this file. */
  const [pageTexts, setPageTexts] = useState<string[] | null>(null);
  useEffect(() => setPageTexts(null), [pdf]);
  const pageTextLayer = (i: number) =>
    scrollRef.current?.querySelector(`[data-page-number="${i + 1}"] .marginalia-text-layer`) ?? null;
  const find = useDocumentFind({
    enabled: Boolean(pdf) && !editingId,
    units: pageTexts,
    unitElement: pageTextLayer,
    root: () => scrollRef.current,
    startUnit: () => currentPage - 1,
    reveal: (i, range) => {
      const box = scrollRef.current?.getBoundingClientRect();
      if (!range || !box) return goToPage(i + 1);
      const r = range.getBoundingClientRect();
      if (r.top >= box.top + 24 && r.bottom <= box.bottom - 72 && r.left >= box.left && r.right <= box.right) return;
      scrollRef.current!.scrollBy({
        top: r.top - (box.top + box.bottom) / 2,
        left: r.right > box.right || r.left < box.left ? r.left - (box.left + box.right) / 2 : 0,
        behavior: reduceMotion ? 'auto' : 'smooth'
      });
    }
  });
  useEffect(() => {
    if (!find.open || pageTexts || !pdf) return;
    let cancelled = false;
    void Promise.all(
      Array.from({ length: pdf.numPages }, (_, i) =>
        pdf
          .getPage(i + 1)
          .then((page) => page.getTextContent())
          // A line end is a space, as the text layer's <br> is read back (findHighlight.ts).
          .then((tc) => tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? ' ' : '') : '')).join(''))
          .catch(() => '')
      )
    ).then((texts) => !cancelled && setPageTexts(texts));
    return () => {
      cancelled = true;
    };
  }, [find.open, pageTexts, pdf]);

  // ── Linked marks ──
  const linkOption = (a: Annotation): LinkOption => ({
    id: a.id,
    label: excerpt(a.quote || a.text || (isAreaHighlight(a) ? 'Area highlight' : a.kind)),
    where: `p. ${a.page}`
  });
  const markLinksFor = (id: string): MarkLinks => {
    const linked = new Set(linkedIds(annotations, id));
    const ordered = [...annotations].sort((x, y) => x.page - y.page);
    return {
      linked: ordered.filter((a) => linked.has(a.id)).map(linkOption),
      candidates: ordered.filter((a) => a.id !== id).map(linkOption),
      onLink: (other) => setAnnotations((prev) => linkMarks(prev, id, other)),
      onUnlink: (other) => setAnnotations((prev) => unlinkMarks(prev, id, other)),
      onJump: (other) => {
        const target = annotations.find((a) => a.id === other);
        if (!target) return;
        setSelectedId(other);
        scrollToAnnotation(target);
      }
    };
  };

  // ── Marks archive (Markdown/JSON, commonplace book, import, restore) ──
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const archive = useMarksArchive({
    docId,
    doc: { id: docId, title: documentTitle || 'document', format: 'PDF' },
    entries: () => annotationsRef.current as never,
    themes: settings.activeThemes,
    saver,
    reset: (entries) => resetAnnotations(entries as unknown as Annotation[]),
    onAddThemes: (t) => onAddThemes?.(t),
    isDark,
    teacher: settings.name
  });

  // ── Insert page ──
  const [insertPageMenuOpen, setInsertPageMenuOpen] = useState(false);
  const [insertPlacement, setInsertPlacement] = useState<PageInsertPlacement>('after');
  const [insertHeight, setInsertHeight] = useState<PageInsertHeight>('full');
  const [isInsertingPage, setIsInsertingPage] = useState(false);
  /** Set once an insert succeeds; applied by the effect below once the reloaded PDF actually
   *  reports enough pages to scroll to — reloading is asynchronous, so this can't happen inline. */
  const [pendingPageJump, setPendingPageJump] = useState<number | null>(null);

  useEffect(() => {
    if (pendingPageJump === null || pageCount < pendingPageJump) return;
    const target = pendingPageJump;
    setPendingPageJump(null);
    requestAnimationFrame(() => goToPage(target));
  }, [pendingPageJump, pageCount, goToPage]);

  /** Re-reads the marks the server just renumbered. */
  const reloadMarks = useCallback(async () => {
    const stored = await fetchAnnotations(docId);
    return stored ? ((stored.annotations as unknown as Annotation[]) || []) : null;
  }, [docId]);

  const handleInsertPage = useCallback(async () => {
    if (pageOpBusyRef.current) return;
    pageOpBusyRef.current = true;
    setIsInsertingPage(true);
    try {
      // Saves pending marks first, pauses the autosave while the server renumbers, then `reset`s
      // (not commits) the re-read marks: Undo must not put old page numbers onto the changed PDF.
      const outcome = await runPageOperation({
        saver,
        operate: () => insertPage(docId, insertPlacement, insertHeight, currentPage),
        reload: reloadMarks,
        reset: resetAnnotations
      });
      if (outcome.status === 'unsaved') {
        setFailure('Your latest marks could not be saved, so the page was not added. Try again once the Saved tick returns.');
        return;
      }
      if (outcome.status === 'failed') {
        setFailure('Could not add the page. The document was left unchanged.');
        return;
      }
      setFileVersion((v) => v + 1);
      if (!outcome.reloaded) setFailure('The page was added, but this document\'s marks could not be re-read. Reopen it before marking anything else — nothing more is saved until you do.');
      setInsertPageMenuOpen(false);
      if (outcome.result.insertedPages.length) setPendingPageJump(outcome.result.insertedPages[0]);
    } finally {
      pageOpBusyRef.current = false;
      setIsInsertingPage(false);
    }
  }, [docId, insertPlacement, insertHeight, currentPage, resetAnnotations, saver, reloadMarks]);

  /** Guards against a double-fire while a delete is in flight — the corner button's own inline
   *  confirm (see PdfPage.tsx) is the only confirmation now; there is no modal step above it. */
  const [isDeletingPage, setIsDeletingPage] = useState(false);

  const handleDeletePage = useCallback(
    async (pageNumber: number) => {
      if (isDeletingPage || pageOpBusyRef.current) return;
      pageOpBusyRef.current = true;
      setIsDeletingPage(true);
      try {
        // See `handleInsertPage`.
        const outcome = await runPageOperation({
          saver,
          operate: () => deletePage(docId, pageNumber),
          reload: reloadMarks,
          reset: resetAnnotations
        });
        if (outcome.status === 'unsaved') {
          setFailure(`Your latest marks could not be saved, so page ${pageNumber} was not deleted. Try again once the Saved tick returns.`);
          return;
        }
        if (outcome.status === 'failed') {
          setFailure(`Could not delete page ${pageNumber}. The document was left unchanged.`);
          return;
        }
        setFileVersion((v) => v + 1);
        if (!outcome.reloaded) setFailure('The page was deleted, but this document\'s marks could not be re-read. Reopen it before marking anything else — nothing more is saved until you do.');
        // The page that took the deleted one's place, or the new last page if it was the last one.
        setPendingPageJump(Math.min(pageNumber, outcome.result.pageCount));
      } finally {
        pageOpBusyRef.current = false;
        setIsDeletingPage(false);
      }
    },
    [docId, isDeletingPage, resetAnnotations, saver, reloadMarks]
  );

  const byPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of annotations) {
      const list = map.get(a.page);
      if (list) list.push(a);
      else map.set(a.page, [a]);
    }
    return map;
  }, [annotations]);

  /**
   * The selected mark's rectangle in viewport coordinates, for placing its properties menu.
   *
   * Re-measured on scroll and zoom rather than captured once, so the menu tracks the mark instead
   * of being left behind on the page. Capture phase is needed to see the viewer's own scroll
   * container, whose scroll events do not bubble.
   */
  const selectedMark = selectedId ? annotations.find((a) => a.id === selectedId) : undefined;
  const [markRect, setMarkRect] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!selectedMark) {
      setMarkRect(null);
      return;
    }
    const measure = () => {
      const pageEl = scrollRef.current?.querySelector<HTMLElement>(`[data-page-number="${selectedMark.page}"]`);
      const bounds = annotationBounds(selectedMark);
      if (!pageEl || !bounds) {
        setMarkRect(null);
        return;
      }
      const box = pageEl.getBoundingClientRect();
      setMarkRect({
        left: box.left + bounds.x * box.width,
        top: box.top + bounds.y * box.height,
        right: box.left + (bounds.x + bounds.w) * box.width,
        bottom: box.top + (bounds.y + bounds.h) * box.height
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [selectedMark, scale]);

  const editing = editingId ? annotations.find((a) => a.id === editingId) : undefined;
  // The viewer's top edge: popovers above a passage must not climb over the toolbar. Read at
  // render, which every popover move already causes (anchor and mark rect are state).
  // In focus mode the toolbar slides over the page when called, so menus keep clear of where it lands.
  const popoverTopInset = focusMode
    ? (document.querySelector<HTMLElement>('.focus-chrome')?.offsetHeight ?? 0)
    : (scrollRef.current?.getBoundingClientRect().top ?? 0);

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

      <div className="flex-1 flex min-h-0 min-w-0">
        <div
          ref={scrollRef}
          data-annotation-surface
          className="flex-1 min-w-0 min-h-0 overflow-auto px-4 py-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          {loadError ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <FileWarning className="w-8 h-8 text-amber-500" />
              <p className="text-[13px] text-stone-600 dark:text-stone-400 max-w-sm">{loadError}</p>
            </div>
          ) : !pdf ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
              <p className="text-[12px] text-muted">Opening document…</p>
            </div>
          ) : (() => {
            const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);
            const renderPage = (pageNumber: number, offstage = false) => (
              <PdfPage
                key={pageNumber}
                offstage={offstage}
                pdf={pdf}
                pageNumber={pageNumber}
                scale={scale}
                annotations={byPage.get(pageNumber) || []}
                tool={tool}
                activeColor={activeColor}
                activeThemeId={activeThemeId}
                terminologyColor={settings.terminologyColor}
                toolWeight={toolWeights[tool]}
                toolStrokeStyle={toolStrokeStyles[tool]}
                toolNoteStyle={noteStyle}
                toolBracketSide={bracketSide}
                toolTextSize={textSize}
                toolTextAlign={textAlign}
                toolTextFont={textFont}
                toolTextBold={textBold}
                toolTextItalic={textItalic}
                isDark={isDark}
                selectedId={selectedId}
                hoveredId={hoveredId}
                onSelect={setSelectedId}
                onCreate={createAnnotation}
                onDelete={deleteAnnotation}
                onEdit={startEditing}
                onUpdate={updateAnnotation}
                onHover={setHoveredId}
                onVisible={setCurrentPage}
                onDeletePage={pageCount > 1 ? () => void handleDeletePage(pageNumber) : undefined}
              />
            );

            // Spread groups pages two to a row, like an open book — everything else about a page
            // (its own AnnotationLayer, its own coordinate space) is unaffected by how it's laid
            // out among its neighbours, so this is purely a container change.
            if (bookOn) {
              const first = Math.floor((currentPage - 1) / 2) * 2 + 1;
              const pair = [first, first + 1].filter((n) => n <= pageCount);
              // The pairs either side, drawn ahead and kept offstage in the same parent, so a turn
              // shows finished pages and React keeps each page (and its canvas) as it moves into view.
              const near = [first - 2, first - 1, first + 2, first + 3].filter((n) => n >= 1 && n <= pageCount);
              return (
                <div className="flex items-center justify-center gap-1 min-h-full">
                  <button
                    type="button"
                    data-inline
                    className="spread-edge"
                    onClick={() => goToPage(first - 2)}
                    disabled={first <= 1}
                    aria-label="Previous pages (Left arrow)"
                    title="Previous pages (←)"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div ref={bookRef} className="spread-book relative flex items-start" style={{ marginInline: 0 }}>
                    {[...near.filter((n) => n < first), ...pair, ...near.filter((n) => n > first)].map((n) => renderPage(n, !pair.includes(n)))}
                    {pair.length === 2 && <div className="spread-gutter" aria-hidden />}
                  </div>
                  <button
                    type="button"
                    data-inline
                    className="spread-edge"
                    onClick={() => goToPage(first + 2)}
                    disabled={first + 2 > pageCount}
                    aria-label="Next pages (Right arrow)"
                    title="Next pages (→)"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              );
            }

            // Four or six pages in view: a grid of two or three columns, every page still its own
            // annotation surface; scrolling moves on through the document.
            if (viewMode === 'grid4' || viewMode === 'grid6') {
              return (
                <div className={`grid gap-5 justify-center items-start ${viewMode === 'grid6' ? 'grid-cols-[repeat(3,max-content)]' : 'grid-cols-[repeat(2,max-content)]'}`}>
                  {pageNumbers.map((n) => renderPage(n))}
                </div>
              );
            }

            if (viewMode === 'spread') {
              const pairs: number[][] = [];
              for (let i = 0; i < pageNumbers.length; i += 2) pairs.push(pageNumbers.slice(i, i + 2));
              return (
                <div className="space-y-5">
                  {pairs.map((pair) => (
                    <div key={pair[0]} className="flex flex-wrap items-start justify-center gap-5">
                      {pair.map((n) => renderPage(n))}
                    </div>
                  ))}
                </div>
              );
            }

            return <div className="space-y-5">{pageNumbers.map((n) => renderPage(n))}</div>;
          })()}
        </div>

        {/* The marks panel stays mounted while hidden, so closing and reopening it is cheap. */}
        <div
          // Docked beside the pages on a wide window; an overlay once the window is too narrow
          // to give it a column. It used to be `hidden md:flex`, which left both toggles in the
          // header doing visibly nothing on a small window.
          className={`flex-col min-h-0 border-l z-30 max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:w-full max-md:max-w-sm max-md:shadow-2xl md:w-80 md:shrink-0 ${
            isPanelOpen ? 'flex' : 'hidden'
          } ${isDark ? 'bg-night-1 border-stone-800' : 'bg-white border-stone-200'}`}
        >
          <div
            className="min-h-0 flex-1 flex flex-col motion-safe:animate-[panel-in_200ms_var(--ease-out)]"
          >
            <NotesList
              annotations={annotations}
              settings={settings}
              isDark={isDark}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onSelect={(a) => {
                setSelectedId(a.id);
                scrollToAnnotation(a);
              }}
              onRetag={retagAnnotation}
              onDelete={deleteAnnotation}
              onEdit={startEditing}
            />
          </div>
        </div>
      </div>

      <ErrorDialog open={Boolean(failure)} message={failure ?? ''} onClose={() => setFailure(null)} />
      {archive.ui}

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

      {/* Comment editor. A small modal rather than an inline field: marks sit at arbitrary points,
          often near a page edge, where an inline editor would be clipped. */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={saveEditing}>
          <div
            className={`ink-card w-full max-w-sm rounded-2xl p-4 space-y-3 shadow-2xl ${
              isDark ? 'bg-night-3 border border-stone-800' : 'bg-white border border-stone-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editing.color }} />
              <h3 className="title-hand text-[23px] text-stone-900 dark:text-paper">
                {editing.kind === 'note' ? 'Note' : editing.kind === 'text' ? 'Text box' : 'Comment'} · page {editing.page}
              </h3>
            </div>
            {editing.quote && (
              <p
                className="text-[12px] italic text-stone-600 dark:text-stone-400 border-l-2 pl-2.5 line-clamp-3"
                style={{ borderLeftColor: editing.color }}
              >
                &ldquo;{editing.quote}&rdquo;
              </p>
            )}
            <textarea
              autoFocus
              rows={4}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  saveEditing();
                }
                // Enter saves; Shift+Enter starts a new line. Notes are usually one line long,
                // so the key people reach for first should be the one that finishes the job —
                // and the paragraph break is still there for the occasions it is wanted.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEditing();
                }
              }}
              placeholder="Write your note… (Enter to save, Shift+Enter for a new line)"
              className={`w-full p-3 rounded-xl border text-[13px] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-gold ${
                isDark
                  ? 'bg-night-2 border-stone-800 text-stone-100 placeholder-stone-600'
                  : 'bg-white border-stone-300 text-stone-900 placeholder-stone-400'
              }`}
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => deleteAnnotation(editing.id)}
                className="text-[12px] font-semibold text-red-600 hover:underline cursor-pointer"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={saveEditing}
                className="px-4 py-2 rounded-full bg-accent caps hover:bg-accent-hover text-on-accent text-[12px] font-semibold cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insert page. Placement is relative to whichever page the reader was on when they opened
          this — "before"/"after" read naturally against that, and "start and end" ignores it
          entirely since it always means the very edges of the document. */}
      {insertPageMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (isInsertingPage) return;
            setInsertPageMenuOpen(false);
          }}
        >
          <div
            className={`ink-card w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl ${
              isDark ? 'bg-night-3 border border-stone-800' : 'bg-white border border-stone-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="title-hand text-[23px] text-stone-900 dark:text-paper">
                Page {currentPage}
              </h3>
              <button
                type="button"
                onClick={() => setInsertPageMenuOpen(false)}
                className="p-1 rounded-lg text-muted hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <span className="caps text-muted">
                Where
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'before' as const, label: 'Before this page', icon: PanelTop },
                    { id: 'after' as const, label: 'After this page', icon: PanelBottom },
                    { id: 'both-ends' as const, label: 'Start & end of document', icon: FileStack }
                  ]
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setInsertPlacement(id)}
                    className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-[11px] font-medium text-center leading-tight cursor-pointer transition-all ${
                      insertPlacement === id
                        ? 'border-gold bg-gold/10 text-gold dark:text-gold'
                        : isDark
                          ? 'border-stone-700 text-stone-400 hover:bg-stone-800'
                          : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="caps text-muted">
                Size
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'full' as const, label: 'Full page' },
                    { id: 'header' as const, label: 'Header strip' },
                    { id: 'notes' as const, label: 'Notes page' }
                  ]
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setInsertHeight(id)}
                    className={`p-2.5 rounded-xl border text-[11px] font-medium text-center leading-tight cursor-pointer transition-all ${
                      insertHeight === id
                        ? 'border-gold bg-gold/10 text-gold dark:text-gold'
                        : isDark
                          ? 'border-stone-700 text-stone-400 hover:bg-stone-800'
                          : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setInsertPageMenuOpen(false)}
                disabled={isInsertingPage}
                className="px-3.5 py-2 text-[12.5px] font-medium text-muted hover:text-stone-800 dark:hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleInsertPage()}
                disabled={isInsertingPage}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent caps hover:bg-accent-hover text-on-accent text-[12.5px] font-semibold cursor-pointer disabled:opacity-60"
              >
                {isInsertingPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Insert
              </button>
            </div>

            <p className="text-[11.5px] text-muted text-center pt-1">
              To delete a page instead, hover its bottom-right corner.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
