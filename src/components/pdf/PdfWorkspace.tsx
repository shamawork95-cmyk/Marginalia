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
import { Annotation, AnnotationKind, DEFAULT_NOTE_SIZE, FractionRect, PdfTool, annotationBounds, isTextAnchored, newAnnotationId, rectToFraction } from './annotationModel';
import { PdfPage } from './PdfPage';
import { PdfToolbar, NEUTRAL_COLORS } from './PdfToolbar';
import { NotesList } from './NotesList';
import { SelectionPopover, SelectionAnchor } from './SelectionPopover';
import { MarkProperties } from './MarkProperties';
import { exportAnnotatedPdf, downloadBlob } from './exportAnnotatedPdf';
import { fetchAnnotations, originalDocumentUrl, saveAnnotations } from '../../utils/documentStorage';

// pdf.js parses off the main thread. Resolving the worker through `import.meta.url` lets the
// bundler fingerprint and ship it, which is what makes this work offline in the packaged app —
// a CDN worker URL would leave the viewer dead with no network.
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

/** How long to wait after the last change before writing to disk. */
const SAVE_DEBOUNCE_MS = 700;

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.2);
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

  const activeColor = toolColors[tool] ?? NEUTRAL_COLORS[0];
  const setToolColor = useCallback(
    (which: string, color: string) => setToolColors((prev) => ({ ...prev, [which]: color })),
    []
  );

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
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
    const task = getDocument({ url: fileUrl });
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
    setAnnotations([]);
    fetchAnnotations(docId).then((stored) => {
      if (cancelled) return;
      setAnnotations((stored.annotations as unknown as Annotation[]) || []);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [docId]);

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

  /** Applies a partial change to one mark — moving a note, resizing it, locking it. */
  const updateAnnotation = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

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
    [setToolWeight, selectedId]
  );

  /**
   * Applies a text mark to a selection, or removes it if it is already there.
   *
   * Toggling is reserved for the TOOLBAR BUTTON. Marking by selecting text always adds, because
   * dragging over a passage a second time reads as "mark this", not "unmark it" — having that
   * quietly delete the mark just made was the surprising behaviour worth removing.
   */
  const applyTextMark = useCallback(
    (
      kind: AnnotationKind,
      groups: { page: number; rects: FractionRect[]; quote: string }[],
      allowToggle: boolean,
      colorOverride?: string
    ) => {
      const existing = groups
        .map((g) => annotations.find((a) => matchesSelection(a, g, kind)))
        .filter(Boolean) as Annotation[];

      // Only a toolbar tap may undo, and only while the selection it marked is still live.
      if (allowToggle && existing.length === groups.length && existing.length > 0) {
        const ids = new Set(existing.map((a) => a.id));
        setAnnotations((prev) => prev.filter((a) => !ids.has(a.id)));
        setSelectedId(null);
        setPendingSelection(null);
        return;
      }

      const additions = groups
        .filter((g) => !annotations.some((a) => matchesSelection(a, g, kind)))
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

      if (additions.length === 0) return;
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
    [annotations, toolColors, activeThemeId, settings.name, matchesSelection]
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
        if (isTextAnchored(tool as never)) applyTextMark(tool as AnnotationKind, groups, false);
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
      setTool(next);
      // The button is the one place that toggles: tap to mark, tap again to unmark.
      if (isTextAnchored(next as never) && pendingSelection?.length) {
        applyTextMark(next as AnnotationKind, pendingSelection, true);
      }
    },
    [pendingSelection, applyTextMark]
  );

  // Escape leaves whatever tool is active — the reliable way out of a drawing mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || editingId) return;
      setTool('select');
      setSelectedId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingId]);

  // ── Navigation & zoom ──
  const goToPage = useCallback((page: number) => {
    scrollRef.current
      ?.querySelector(`[data-page-number="${page}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrentPage(page);
  }, []);

  const fitWidth = useCallback(async () => {
    if (!pdf || !scrollRef.current) return;
    const page = await pdf.getPage(currentPage);
    const unscaled = page.getViewport({ scale: 1 });
    setScale(Math.max(0.25, Math.min(4, (scrollRef.current.clientWidth - 48) / unscaled.width)));
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
  const pageCount = pdf?.numPages ?? 0;

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

      {/* Properties for whatever is selected: colour, thickness, comment, delete. */}
      {selectedMark && markRect && !editing && (
        <MarkProperties
          mark={selectedMark}
          rect={markRect}
          settings={settings}
          isDark={isDark}
          onColorChange={(color) => updateAnnotation(selectedMark.id, { color })}
          onWeightChange={(weight) => updateAnnotation(selectedMark.id, { weight })}
          onEdit={() => startEditing(selectedMark.id)}
          onDelete={() => deleteAnnotation(selectedMark.id)}
        />
      )}

      {/* The selection menu — mark the passage, or write a note about it. */}
      {!editing && (
        <SelectionPopover
          anchor={selectionAnchor}
          isDark={isDark}
          toolColors={toolColors}
          onMark={(kind) => {
            if (pendingSelection?.length) applyTextMark(kind, pendingSelection, false);
            setSelectionAnchor(null);
            window.getSelection()?.removeAllRanges();
            // Reaching for a tool here means choosing it, so the toolbar follows — and its
            // colour/thickness submenu opens, since adjusting what was just applied is the
            // usual next step.
            setTool(kind);
            setOpenSubmenuFor(kind);
          }}
          onCreateNote={() => {
            createNoteForSelection();
            setTool('note');
            setOpenSubmenuFor('note');
          }}
          onDismiss={() => {
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
                // Cmd/Ctrl+Enter saves, leaving plain Enter free for paragraph breaks.
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEditing();
              }}
              placeholder="Write your note…"
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
