/**
 * The PDF workspace: our own viewer and annotation editor, with the notes panel beside it.
 *
 * Built on pdf.js directly rather than on a viewer library, because owning the annotation model
 * is what makes the rest possible — marks carry their theme, hovering a note can light up exactly
 * the passage it refers to, and the AI's extracted themes can become highlights without asking a
 * third party's permission.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { Loader2, FileWarning, ArrowLeft, PanelRightClose, PanelRightOpen, Check, StickyNote } from 'lucide-react';
import { Screen, TransitionType, UserSettings } from '../../types';
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
  isTextAnchored,
  newAnnotationId,
  rectToFraction
} from './annotationModel';
import { useAnnotationHistory } from './useAnnotationHistory';
import { PdfPage } from './PdfPage';
import { PdfToolbar, NEUTRAL_COLORS } from './PdfToolbar';
import { NotesList } from './NotesList';
import { SelectionPopover, SelectionAnchor } from './SelectionPopover';
import { MarkProperties } from './MarkProperties';
import { ScrollPageIndicator } from './ScrollPageIndicator';
import { exportAnnotatedPdf, downloadBlob } from './exportAnnotatedPdf';
import { fetchAnnotations, originalDocumentUrl, saveAnnotations } from '../../utils/documentStorage';

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

/** The zoom a document opens at when nothing was remembered about it yet. */
const DEFAULT_ZOOM = 1.25;

/** Where each document's last zoom level and page are remembered between sessions. */
const DOC_STATE_PREFIX = 'marginalia_docstate_';

interface StoredDocState {
  scale: number;
  page: number;
}

function loadDocState(docId: string): StoredDocState | null {
  try {
    const raw = localStorage.getItem(DOC_STATE_PREFIX + docId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.scale === 'number' && typeof parsed.page === 'number') return parsed;
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
  documentTitle: string;
  settings: UserSettings;
  isDark?: boolean;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
}

export const PdfWorkspace: React.FC<PdfWorkspaceProps> = ({
  docId,
  documentTitle,
  settings,
  isDark = false,
  onNavigate
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const pageCount = pdf?.numPages ?? 0;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scale, setScale] = useState(DEFAULT_ZOOM);
  /** Guards the one-time fit, so re-rendering never overrides a zoom the reader chose. */
  const fittedRef = useRef<string | null>(null);
  /** Guards the one-time restore of the last page read, the same way `fittedRef` guards zoom. */
  const restoredPageRef = useRef<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

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
      underline: pick(1),
      strikeout: pick(2),
      ink: pick(0),
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
    rect: 0.0028,
    ellipse: 0.0028,
    arrow: 0.0028,
    line: 0.0028,
    underline: 0.0028,
    strikeout: 0.0028
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
    commit: setAnnotations,
    reset: resetAnnotations,
    undo,
    redo,
    canUndo,
    canRedo
  } = useAnnotationHistory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
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

  const fileUrl = originalDocumentUrl(docId, 'inline');

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
      resetAnnotations((stored.annotations as unknown as Annotation[]) || []);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [docId, resetAnnotations]);

  // ── Persistence ──
  const annotationsRef = useRef<Annotation[]>([]);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    // Nothing is written until the stored set has been read, or an empty initial state would
    // overwrite the reader's existing marks the moment the document opened.
    if (!isLoaded) return;
    setSaveState('saving');
    const timer = window.setTimeout(async () => {
      const ok = await saveAnnotations(docId, annotations as never);
      setSaveState(ok ? 'saved' : 'idle');
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [annotations, docId, isLoaded]);

  // Flush anything still pending when the workspace closes, so marks made in the last moment
  // before navigating away are not lost with the timer.
  useEffect(
    () => () => {
      if (annotationsRef.current.length) void saveAnnotations(docId, annotationsRef.current as never);
    },
    [docId]
  );

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = window.setTimeout(() => setSaveState('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  // ── Mutations ──
  const createAnnotation = useCallback(
    (annotation: Annotation) => {
      setAnnotations((prev) => [
        ...prev,
        { ...annotation, author: settings.name, weight: toolWeights[annotation.kind] ?? annotation.weight }
      ]);
      // Whatever was just drawn stays selected, so its properties menu appears beside it and its
      // colour and thickness can be changed straight away — the way every drawing app behaves.
      setSelectedId(annotation.id);
    },
    [settings.name, toolWeights]
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
    const quote = selection.toString().trim();
    if (!quote) return null;

    // Each page's box, measured once. Selection rectangles are then matched to a page
    // GEOMETRICALLY rather than with `elementFromPoint`, which only sees what is currently on
    // screen — so a selection running past the bottom of the window, or made while the document
    // is part-scrolled, silently lost the rectangles that fell outside the viewport.
    const pageBoxes = Array.from(document.querySelectorAll<HTMLElement>('[data-page-number]')).map((el) => ({
      page: Number(el.dataset.pageNumber),
      box: el.getBoundingClientRect()
    }));

    /**
     * Merges the per-word rectangles a selection produces into one rectangle per LINE.
     *
     * pdf.js lays out a separate span for each text item — often each word — so
     * `getClientRects()` returns a rectangle per word, with gaps at every space. Marking those
     * directly is what produced highlights that striped each word separately instead of covering
     * the phrase. Rectangles are grouped by vertical overlap (robust to the small baseline
     * differences between words in a line) and each group becomes a single rectangle spanning
     * from the leftmost to the rightmost edge, so the spaces between words are covered too.
     */
    const mergeIntoLines = (rects: DOMRect[]): DOMRect[] => {
      const lines: DOMRect[][] = [];
      for (const rect of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
        const line = lines.find((group) => {
          const ref = group[0];
          const overlap = Math.min(ref.bottom, rect.bottom) - Math.max(ref.top, rect.top);
          // More than half the shorter rectangle's height in common means the same line.
          return overlap > Math.min(ref.height, rect.height) * 0.5;
        });
        if (line) line.push(rect);
        else lines.push([rect]);
      }
      return lines.map((group) => {
        const left = Math.min(...group.map((r) => r.left));
        const top = Math.min(...group.map((r) => r.top));
        const right = Math.max(...group.map((r) => r.right));
        const bottom = Math.max(...group.map((r) => r.bottom));
        return new DOMRect(left, top, right - left, bottom - top);
      });
    };

    const byPageMap = new Map<number, { pageBox: DOMRect; rects: DOMRect[] }>();
    for (const rect of Array.from(range.getClientRects())) {
      // Zero-area rects are emitted for collapsed line ends and would render as invisible slivers
      // that are impossible to click or erase.
      if (rect.width < 0.5 || rect.height < 0.5) continue;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const owner = pageBoxes.find(
        ({ box }) => cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom
      );
      if (!owner?.page) continue;
      const entry = byPageMap.get(owner.page);
      if (entry) entry.rects.push(rect);
      else byPageMap.set(owner.page, { pageBox: owner.box, rects: [rect] });
    }

    if (byPageMap.size === 0) return null;

    const groups: { page: number; rects: FractionRect[]; quote: string }[] = [];
    byPageMap.forEach(({ pageBox, rects }, page) => {
      groups.push({ page, rects: mergeIntoLines(rects).map((r) => rectToFraction(r, pageBox)), quote });
    });
    return groups;
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
   */
  const isAlreadyMarked = useCallback(
    (group: { page: number; rects: FractionRect[] }, kind: AnnotationKind) => {
      const existing = annotations
        .filter((a) => a.kind === kind && a.page === group.page && a.rects?.length)
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
      kind: AnnotationKind,
      groups: { page: number; rects: FractionRect[]; quote: string }[],
      colorOverride?: string
    ) => {
      const additions = groups
        .filter((g) => !isAlreadyMarked(g, kind))
        .map<Annotation>((g) => ({
          id: newAnnotationId(),
          page: g.page,
          kind,
          color: colorOverride ?? toolColors[kind] ?? NEUTRAL_COLORS[0],
          themeId: activeThemeId,
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
    [isAlreadyMarked, toolColors, activeThemeId, settings.name, toolWeights, setAnnotations]
  );

  /**
   * Remembers the selection on mouse release, and marks it straight away when a text tool is
   * already active.
   *
   * Reading on release rather than on every selection change means the mark is made once the
   * reader has finished dragging, instead of on each intermediate selection.
   */
  useEffect(() => {
    const handleUp = () =>
      window.setTimeout(() => {
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
        setPendingSelection(groups);

        // Anchor the menu to the selection's own rectangle.
        const sel = window.getSelection();
        const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
        if (rect && rect.width + rect.height > 0) {
          setSelectionAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom });
        }
        // Marking by selection always adds — never undoes.
        if (isTextAnchored(tool as never)) applyTextMark(tool as AnnotationKind, groups);
      }, 0);

    document.addEventListener('mouseup', handleUp);
    return () => document.removeEventListener('mouseup', handleUp);
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
      const actsOnSelection = isTextAnchored(next as never) && Boolean(pendingSelection?.length);
      if (actsOnSelection) {
        applyTextMark(next as AnnotationKind, pendingSelection!);
        setTool('select');
        setSelectionAnchor(null);
        setOpenSubmenuFor(null);
        return;
      }

      setTool(next);
      // Picking up a tool opens its options with it. Colour and thickness are chosen far more
      // often at the moment of switching tools than at any other time, and requiring a second
      // click on a chip the size of a grain of rice to reach them was a tax on the common case.
      // Select and Erase have nothing to configure.
      setOpenSubmenuFor(next === 'select' || next === 'erase' ? null : next);
    },
    [pendingSelection, applyTextMark]
  );

  /**
   * Keyboard: Escape leaves whatever tool is active, and the usual undo shortcuts work anywhere
   * in the workspace.
   *
   * Both are suppressed while a comment is being written. The editor is a text field, where
   * Escape means "close this" and Cmd+Z means "undo my typing" — letting either reach the
   * document would rewind the reader's marks while they were mid-sentence.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      if (e.key === 'Escape') {
        setTool('select');
        setSelectedId(null);
        setSelectionAnchor(null);
        return;
      }

      const accel = e.metaKey || e.ctrlKey;
      if (!accel) return;
      const key = e.key.toLowerCase();
      // Shift+Cmd+Z is redo on macOS; Ctrl+Y is the Windows spelling of the same thing.
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingId, undo, redo]);

  // ── Navigation & zoom ──
  const goToPage = useCallback((page: number) => {
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
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, docId]);

  /** Restores the page the reader was last on, once per document, after that zoom is settled. */
  useEffect(() => {
    if (!pdf || pageCount === 0 || restoredPageRef.current === docId) return;
    restoredPageRef.current = docId;
    const stored = loadDocState(docId);
    if (stored && stored.page > 1 && stored.page <= pageCount) {
      // The page elements render synchronously off `pageCount`, but a frame gives layout a
      // moment to settle before `scrollIntoView` measures it.
      requestAnimationFrame(() => goToPage(stored.page));
    }
  }, [pdf, pageCount, docId, goToPage]);

  /** Remembers this document's zoom and page so reopening it resumes where the reader left off. */
  useEffect(() => {
    if (fittedRef.current !== docId) return;
    const timer = setTimeout(() => saveDocState(docId, { scale, page: currentPage }), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [scale, currentPage, docId]);

  const fitWidth = useCallback(async () => {
    if (!pdf || !scrollRef.current) return;
    const page = await pdf.getPage(currentPage);
    const unscaled = page.getViewport({ scale: 1 });
    setScale(Math.max(0.25, Math.min(5, (scrollRef.current.clientWidth - 48) / unscaled.width)));
  }, [pdf, currentPage]);

  const scrollToAnnotation = useCallback(
    (a: Annotation) => {
      const pageEl = scrollRef.current?.querySelector<HTMLElement>(`[data-page-number="${a.page}"]`);
      const bounds = annotationBounds(a);
      if (!pageEl) return;
      if (!bounds) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // Scroll so the mark itself lands near the middle of the viewport, not just its page.
      const container = scrollRef.current!;
      const top = pageEl.offsetTop + bounds.y * pageEl.offsetHeight - container.clientHeight / 3;
      container.scrollTo({ top, behavior: 'smooth' });
    },
    []
  );

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const safe = (documentTitle || 'document').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
      const blob = await exportAnnotatedPdf(fileUrl, annotations, `${safe}_annotated.pdf`);
      downloadBlob(blob, `${safe}_annotated.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, [fileUrl, annotations, documentTitle]);

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

  return (
    <div
      className={`flex flex-col h-screen max-h-screen min-h-0 overflow-hidden ${
        isDark ? 'bg-[#121514]' : 'bg-[#f9f9f7]'
      }`}
    >
      <header
        className={`flex items-center gap-3 px-4 py-2.5 border-b shrink-0 ${
          isDark ? 'bg-[#181c19] border-stone-800' : 'bg-white border-stone-200'
        }`}
      >
        <button
          type="button"
          onClick={() => onNavigate('home', 'push_back')}
          title="Back to the library"
          className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-serif text-[15px] font-semibold text-stone-900 dark:text-white truncate flex-1 min-w-0">
          {documentTitle}
        </h1>
        <span className="text-[11px] text-stone-500 flex items-center gap-1 shrink-0 w-20 justify-end">
          {saveState === 'saving' && (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving…
            </>
          )}
          {saveState === 'saved' && (
            <>
              <Check className="w-3 h-3 text-emerald-600" />
              Saved
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => setIsPanelOpen((open) => !open)}
          title={isPanelOpen ? 'Hide notes' : 'Show notes'}
          className="flex items-center gap-1.5 p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
        >
          <StickyNote className="w-4 h-4" />
          {isPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
      </header>

      <PdfToolbar
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
        canUndo={canUndo}
        canRedo={canRedo}
        openSubmenuFor={openSubmenuFor}
        onSubmenuOpened={() => setOpenSubmenuFor(null)}
        scale={scale}
        onScaleChange={setScale}
        onFitWidth={() => void fitWidth()}
        currentPage={currentPage}
        pageCount={pageCount}
        onGoToPage={goToPage}
        markCount={annotations.length}
        onExport={() => void handleExport()}
        isExporting={isExporting}
        isDark={isDark}
      />

      <div className="flex-1 flex min-h-0 min-w-0">
        <div
          ref={scrollRef}
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
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <p className="text-[12px] text-stone-500">Opening document…</p>
            </div>
          ) : (
            <div className="space-y-5">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
                <PdfPage
                  key={pageNumber}
                  pdf={pdf}
                  pageNumber={pageNumber}
                  scale={scale}
                  annotations={byPage.get(pageNumber) || []}
                  tool={tool}
                  activeColor={activeColor}
                  activeThemeId={activeThemeId}
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
                />
              ))}
            </div>
          )}
        </div>

        {isPanelOpen && (
          <div className={`w-80 shrink-0 border-l min-h-0 hidden md:flex ${isDark ? 'border-stone-800' : 'border-stone-200'}`}>
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
        )}
      </div>

      {/* The page number, beside the scrollbar, while the reader is scrolling. */}
      <ScrollPageIndicator containerRef={scrollRef} pageCount={pageCount} isDark={isDark} />

      {/* Properties for whatever is selected: colour, thickness, comment, delete. */}
      {selectedMark && markRect && !editing && (
        <MarkProperties
          mark={selectedMark}
          rect={markRect}
          settings={settings}
          isDark={isDark}
          onColorChange={(color) => updateAnnotation(selectedMark.id, { color })}
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
        />
      )}

      {/* The selection menu — mark the passage, or write a note about it. */}
      {!editing && (
        <SelectionPopover
          anchor={selectionAnchor}
          isDark={isDark}
          toolColors={toolColors}
          onMark={(kind) => {
            if (pendingSelection?.length) applyTextMark(kind, pendingSelection);
            setSelectionAnchor(null);
            window.getSelection()?.removeAllRanges();
            // The menu acts on THIS passage and hands the workspace back in its resting state.
            // Arming the tool here would leave the next drag marking something by accident, and
            // the reader who wants to keep highlighting can say so from the toolbar.
            setTool('select');
          }}
          onCreateNote={() => {
            createNoteForSelection();
            setTool('select');
          }}
          // Dismissing takes the MENU away and leaves the passage selected. It fires on any
          // press outside — including a press on a toolbar tool — and clearing the selection
          // there would pull the passage out from under the very action being reached for.
          onDismiss={() => setSelectionAnchor(null)}
        />
      )}

      {/* Comment editor. A small modal rather than an inline field: marks sit at arbitrary points,
          often near a page edge, where an inline editor would be clipped. */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={saveEditing}>
          <div
            className={`w-full max-w-sm rounded-2xl p-4 space-y-3 shadow-2xl ${
              isDark ? 'bg-[#1b201d] border border-stone-800' : 'bg-white border border-stone-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editing.color }} />
              <h3 className="font-serif text-[15px] font-semibold text-stone-900 dark:text-white">
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
              className={`w-full p-3 rounded-xl border text-[13px] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
                isDark
                  ? 'bg-[#181c19] border-stone-800 text-stone-100 placeholder-stone-600'
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
                className="px-4 py-2 rounded-xl bg-[#435c52] hover:bg-[#374c43] text-white text-[12px] font-semibold cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
