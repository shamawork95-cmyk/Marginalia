/**
 * Marginalia — Curated Library & Knowledge Atelier
 *
 * A complete redesign embodying editorial minimalism, tactile physical interactions,
 * and high-density knowledge synthesis:
 * - "On the Desk" spotlight: physical-feeling active reading volume.
 * - "My Margins Tracker": interactive bento hub replacing repetitive stacked accordions
 *   with a unified Thematic Atlas and Terminologies.
 * - "My Readings" bookshelf: dual view modes (Bookshelf & Compact Bibliography),
 *   format filters, search with keyboard shortcut (/), and refined typography.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  ArrowRight,
  FileText,
  Search,
  BookOpen,
  Pencil,
  Trash2,
  Loader2,
  Lightbulb,
  Tag,
  ChevronDown,
  ChevronRight,
  Books,
  List,
  Compass,
  ArrowUpDown,
  BookMarked,
  MotifPath
} from './icons';
import { GuideSection } from './GuideSection';
import { motion, AnimatePresence } from 'motion/react';
import { AnnotationFocus, Screen, TransitionType, UserSettings } from '../types';
import { initialSettings } from '../data/mockData';
import { Bookshelf, progressLabel } from './Bookshelf';
import {
  StoredDocumentMeta,
  deleteStoredDocument,
  fetchAnnotations,
  listStoredDocuments,
  renameStoredDocument,
  type Annotation
} from '../utils/documentStorage';
import { ErrorDialog } from './ErrorDialog';
import { groupHeads, migrateTextEntries, sortTextMarks, type TextMark } from '../utils/textMarks';
import { plural } from '../utils/plural';

interface HomeScreenProps {
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  settings: UserSettings;
  onUpdateSettings?: (updater: (prev: UserSettings) => UserSettings) => void;
  activeDocument?: { title: string; text: string } | null;
  uploadedLibrary?: Array<{
    id: string;
    title: string;
    text?: string;
    date: string;
    wordCount: number;
    format?: string;
    docId?: string;
  }>;
  onSelectDocumentForAnalysis?: (title: string, text: string, format?: string, docId?: string) => void;
  onOpenLibraryDocument?: (doc: {
    id: string;
    title: string;
    text?: string;
    date: string;
    wordCount: number;
    format?: string;
    docId?: string;
  }) => void;
  onOpenStoredDocument?: (meta: StoredDocumentMeta, focus?: AnnotationFocus) => void;
  onContinueAnnotating?: () => void;
  canAnnotateActive?: boolean;
  onDocumentDeleted?: (id: string) => void;
  onDocumentRenamed?: (id: string, title: string) => void;
  refreshToken?: number;
  /** Opens the motif tracer (across every document). */
  onOpenMotifTracer?: () => void;
}

/**
 * The two tab entrances, written out in full.
 *
 * Tailwind generates classes by scanning the source, so a class name assembled at runtime never
 * reaches the stylesheet. Both directions have to appear literally for either to exist.
 */
const TAB_IN_FORWARD = 'motion-safe:animate-[tab-in-forward_220ms_var(--ease-out)]';
const TAB_IN_BACK = 'motion-safe:animate-[tab-in-back_220ms_var(--ease-out)]';

/**
 * A book listed under a theme, with a caret that peeks at what is actually filed under it.
 *
 * The count answers "how much"; it does not answer "which passages", which is what a reader
 * scanning a theme wants before opening a 400-page book. The marks are fetched only when the
 * caret is pressed — the library list carries metadata, not annotations, and reading every
 * document's marks up front to fill a row nobody expanded would be waste.
 */
/** A text-document mark as a drilldown row: located by paragraph, since it has no page. */
const textRows = (marks: TextMark[]): Annotation[] => {
  const sorted = sortTextMarks(marks);
  return groupHeads(sorted).map((head) => ({
    ...head,
    paragraph: head.anchor.paragraphIndex + 1,
    // A mark across paragraphs reads as one passage: every range's words, in order.
    quote: (head.groupId ? sorted.filter((m) => m.groupId === head.groupId) : [head])
      .map((m) => m.quote)
      .filter(Boolean)
      .join(' '),
    page: undefined
  }));
};

const MarkPeekRow: React.FC<{
  docId: string;
  title: string;
  count: number;
  /** Null for terminology, which is a flag on a mark rather than a theme. */
  themeId: string | null;
  onOpen: () => void;
}> = ({ docId, title, count, themeId, onOpen }) => {
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<Annotation[] | null>(null);

  useEffect(() => {
    if (!open || marks) return;
    let cancelled = false;
    void fetchAnnotations(docId).then((stored) => {
      if (cancelled || !stored) return;
      const keep = (a: { isTerminology?: unknown; themeId?: unknown; id: string }) =>
        themeId === null ? a.isTerminology === true : a.themeId === themeId;
      // Text documents store a mark across several paragraphs as one range per paragraph; the
      // header count is per mark, so the rows are too (one per group, in reading order).
      const { marks: text, others } = migrateTextEntries(stored.annotations);
      setMarks([...others.filter(keep), ...textRows(text.filter(keep))]);
    });
    return () => {
      cancelled = true;
    };
  }, [open, marks, docId, themeId]);

  /** The words a mark stands for: the passage it covers, what was written on it, or what it is. */
  const words = (a: Annotation) => {
    const quote = typeof a.quote === 'string' ? a.quote.trim() : '';
    const text = typeof a.text === 'string' ? a.text.trim() : '';
    const where = a.paragraph ? `in paragraph ${String(a.paragraph)}` : `on page ${String(a.page ?? '?')}`;
    return quote || text || `${String(a.kind ?? 'Mark')} ${where}`;
  };

  return (
    <li>
      <div className="flex items-center gap-1 py-1.5 text-[12px]">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 text-left truncate pr-2 font-serif text-stone-700 dark:text-stone-300 hover:text-gold transition-colors cursor-pointer"
        >
          {title}
        </button>
        <span className="font-spine text-[11px] tabular-nums text-muted shrink-0">
          {plural(count, 'mark')}
        </span>
        <button
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
          aria-label={open ? `Hide marks in ${title}` : `Show marks in ${title}`}
          title={open ? 'Hide these marks' : 'Show these marks'}
          className="p-1 rounded-md text-muted hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer transition-colors shrink-0"
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {open && (
        <ul className="pb-1.5 ml-1 pl-2 space-y-0.5 border-l border-stone-200 dark:border-stone-800">
          {marks === null ? (
            <li className="text-[11.5px] text-muted pl-2 py-1">Reading…</li>
          ) : marks.length === 0 ? (
            <li className="text-[11.5px] text-muted pl-2 py-1">Nothing filed here any more.</li>
          ) : (
            <>
              {marks.slice(0, 4).map((a) => (
                <li key={String(a.id)}>
                  <button
                    type="button"
                    onClick={onOpen}
                    className="w-full text-left pl-2 pr-1 py-1 rounded-md text-[11.5px] text-stone-600 dark:text-stone-400 hover:bg-stone-500/[0.07] hover:text-stone-900 dark:hover:text-stone-100 cursor-pointer transition-colors line-clamp-2"
                  >
                    <span className="text-muted tabular-nums mr-1.5">{a.paragraph ? `¶${String(a.paragraph)}` : `p${String(a.page ?? '?')}`}</span>
                    {words(a)}
                  </button>
                </li>
              ))}
              {marks.length > 4 && (
                <li className="pl-2 py-1">
                  <button
                    type="button"
                    onClick={onOpen}
                    className="text-[11px] font-semibold text-gold hover:underline cursor-pointer"
                  >
                    {marks.length - 4} more — open the book
                  </button>
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </li>
  );
};

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onNavigate,
  isDark = false,
  settings,
  onUpdateSettings,
  activeDocument = null,
  onOpenStoredDocument,
  onContinueAnnotating,
  canAnnotateActive = false,
  onDocumentDeleted,
  onDocumentRenamed,
  refreshToken = 0,
  onOpenMotifTracer
}) => {
  const hasActiveDoc = Boolean(activeDocument?.text?.trim());

  const [stored, setStored] = useState<StoredDocumentMeta[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Search & Filtering
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<'all' | 'pdf' | 'epub' | 'docx' | 'txt'>('all');
  const [sortOrder, setSortOrder] = useState<'recent' | 'title' | 'marks' | 'words'>('recent');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // My Margins Tracker tabs: overview (bento), themes, terminology
  const [studioTab, setStudioTab] = useState<'overview' | 'themes' | 'terminology'>('overview');
  /**
   * Which way the last tab change moved along the strip, so the incoming panel enters from the
   * side it came from. Direction is the only thing that makes a tab transition mean anything: a
   * panel that always slides in from the same edge is decoration.
   */
  const [studioDirection, setStudioDirection] = useState<1 | -1>(1);
  const STUDIO_TABS = ['overview', 'themes', 'terminology'] as const;
  const goToStudioTab = useCallback(
    (next: (typeof STUDIO_TABS)[number]) => {
      setStudioDirection(
        STUDIO_TABS.indexOf(next) >= STUDIO_TABS.indexOf(studioTab) ? 1 : -1
      );
      setStudioTab(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studioTab]
  );

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Studio collapse state
  const isStudioCollapsed = Boolean(settings.collapsedHomeSections?.studio);
  const toggleStudioCollapsed = useCallback(() => {
    onUpdateSettings?.((prev) => ({
      ...prev,
      collapsedHomeSections: {
        ...prev.collapsedHomeSections,
        studio: !prev.collapsedHomeSections?.studio
      }
    }));
  }, [onUpdateSettings]);

  // Global keyboard shortcut '/' to focus search, and 'Escape' to clear
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (e.key === '/' && activeTag !== 'input' && activeTag !== 'textarea') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setQuery('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const refreshLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    setStored(await listStoredDocuments());
    setIsLoadingLibrary(false);
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary, refreshToken]);

  const commitRename = async (id: string, title: string) => {
    setBusyId(id);
    const updated = await renameStoredDocument(id, title);
    if (updated) {
      setStored((prev) => prev.map((d) => (d.id === id ? updated : d)));
      onDocumentRenamed?.(id, updated.title);
    } else {
      setFailure('Could not rename that document. Its name on disk is unchanged.');
    }
    setBusyId(null);
  };

  const commitDelete = async (id: string) => {
    setBusyId(id);
    const deleted = await deleteStoredDocument(id);
    if (deleted) {
      setStored((prev) => prev.filter((d) => d.id !== id));
      onDocumentDeleted?.(id);
    } else {
      setFailure('Could not delete that document. It is still in My Collections.');
    }
    setBusyId(null);
    setConfirmingDeleteId(null);
    return deleted;
  };

  // Metrics
  /**
   * Every mark in the library. Also what the My Margins Tracker badge counts.
   *
   * That badge used to add Key Concepts marks, terminology marks and AI themes together, which
   * counted marks under Questions and Metaphors not at all, counted a mark that is also a term
   * twice, and treated a machine's themes as though they were the reader's own marks. It read 9
   * for a library holding 5 marks.
   */
  const totalMarks = useMemo(() => stored.reduce((sum, d) => sum + (d.annotationCount || 0), 0), [stored]);

  // Themes
  /**
   * The theme the Atlas card is about.
   *
   * Matched by name so the split survives a reader who reorders their themes — but Settings lets
   * that name be edited, and this card links straight to Settings to do it. Renaming it used to
   * empty the card: the marks were all still there, they simply stopped being counted. Falling
   * back to the first theme keeps the card about something real whatever it is called.
   */
  const keyConceptsTheme = useMemo(
    () =>
      settings.activeThemes.find((t) => t.name.trim().toLowerCase() === 'key concepts') ??
      settings.activeThemes[0],
    [settings.activeThemes]
  );
  const otherThemes = useMemo(
    () => settings.activeThemes.filter((t) => t.id !== keyConceptsTheme?.id),
    [settings.activeThemes, keyConceptsTheme]
  );

  const booksByTheme = useMemo(() => {
    const map = new Map<string, StoredDocumentMeta[]>();
    for (const theme of settings.activeThemes) {
      map.set(theme.id, stored.filter((d) => d.themeIds?.includes(theme.id)));
    }
    return map;
  }, [settings.activeThemes, stored]);

  // Terminologies
  const documentsWithTerminology = useMemo(
    () => stored.filter((d) => (d.terminologyCount ?? 0) > 0),
    [stored]
  );
  const terminologyMarks = useMemo(
    () => documentsWithTerminology.reduce((total, d) => total + d.terminologyCount, 0),
    [documentsWithTerminology]
  );

  // Filter and sort visible documents
  const visible = useMemo(() => {
    let list = stored;
    const needle = query.trim().toLowerCase();

    if (needle) {
      list = list.filter(
        (d) => d.title.toLowerCase().includes(needle) || d.format.toLowerCase().includes(needle)
      );
    }

    if (formatFilter !== 'all') {
      list = list.filter((d) => d.format.toLowerCase() === formatFilter);
    }

    return [...list].sort((a, b) => {
      if (sortOrder === 'recent') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      if (sortOrder === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortOrder === 'marks') {
        return (b.annotationCount || 0) - (a.annotationCount || 0);
      }
      if (sortOrder === 'words') {
        return (b.wordCount || 0) - (a.wordCount || 0);
      }
      return 0;
    });
  }, [stored, query, formatFilter, sortOrder]);

  const themesAreUntouched = useMemo(() => {
    const defaults = initialSettings.activeThemes;
    if (settings.activeThemes.length !== defaults.length) return false;
    return settings.activeThemes.every((t, i) => {
      const d = defaults[i];
      return d && t.id === d.id && t.name === d.name && t.color === d.color;
    });
  }, [settings.activeThemes]);

  const goToThemeSettings = () => {
    onNavigate('settings', 'push');
    window.setTimeout(() => {
      document.getElementById('settings-active-themes-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);
  };

  const keyConceptsBooks = keyConceptsTheme ? booksByTheme.get(keyConceptsTheme.id) ?? [] : [];
  const keyConceptMarks = keyConceptsBooks.reduce(
    (total, doc) => total + (doc.themeCounts?.[keyConceptsTheme!.id] ?? 0),
    0
  );



  return (
    <main className="flex-1 w-full max-w-360 mx-auto px-5 md:px-8 lg:px-10 py-6 md:py-8 pb-28 md:pb-12">
      <ErrorDialog open={Boolean(failure)} message={failure ?? ''} onClose={() => setFailure(null)} />

      {/* ── MASTHEAD & TELEMETRY STRIP ──────────────────────────────────── */}
      <header className="app-drag flex flex-col gap-5 mb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-widest font-spine font-medium text-gold">
                Personal Atelier for Margins
              </span>
              <span className="text-stone-300 dark:text-stone-700">/</span>
              <span className="text-[11px] font-spine text-muted">
                Offline & Local
              </span>
            </div>
            <h1 className="title-hand title-hand-rule text-[44px] md:text-[52px] text-stone-900 dark:text-stone-100 mt-1">
              My Collections
            </h1>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('upload', 'push')}
              className="group flex items-center gap-2 px-4 py-2 rounded-full caps bg-accent hover:bg-accent-hover active:scale-[0.98] text-on-accent text-[13px] font-medium shadow-xs transition-all duration-150 cursor-pointer"
            >
              <Upload className="w-4 h-4 transition-transform group-hover:-translate-y-0.5" />
              <span>Add Document</span>
            </button>
          </div>
        </div>

      </header>

      {/* ── "ON THE DESK" (CURRENTLY READING SPOTLIGHT) ────────────────── */}
      {hasActiveDoc && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          className={`relative mb-8 rounded-2xl border p-5 md:p-6 overflow-hidden ${
            isDark
              ? 'bg-linear-to-br from-[#1c221e] to-[#151917] border-stone-800'
              : 'bg-linear-to-br from-[#f6f5f0] to-[#eceae2] border-stone-300/70'
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex items-start md:items-center gap-4 min-w-0">
              {/* Miniature desk volume */}
              <div className="relative w-12 h-16 md:w-14 md:h-18 rounded-md shrink-0 shadow-sm border border-black/10 overflow-hidden bg-accent flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-on-accent" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-spine font-semibold tracking-wider uppercase bg-gold/10 dark:bg-gold/15 text-gold">
                    <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
                    On The Desk
                  </span>
                </div>
                <h2 className="title-hand text-[26px] md:text-[31px] text-stone-900 dark:text-stone-50 truncate mt-1">
                  {activeDocument!.title || 'Uploaded Document'}
                </h2>
                <p className="text-[12px] text-muted mt-0.5">
                  Pick up right where you left off in your reading workspace.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => onContinueAnnotating?.()}
                disabled={!canAnnotateActive}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full caps bg-accent hover:bg-accent-hover active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-on-accent text-[13px] font-medium shadow-xs transition-all cursor-pointer"
              >
                <Pencil className="w-4 h-4" />
                <span>Resume Reading</span>
              </button>
            </div>
          </div>
        </motion.section>
      )}

      {/* ── THE BOOKSHELF ("MY READINGS") ────────────────────────────────── */}
      <section id="shelf-section" className="mb-10 space-y-5">
        {/* Shelf Control Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="title-hand text-[32px] text-stone-900 dark:text-stone-100">
              My Readings
            </h2>
            <span className="font-spine text-[12px] text-muted tabular-nums">
              ({visible.length})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Bar with '/' shortcut indicator */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search my readings…"
                aria-label="Filter documents"
                className={`w-44 md:w-56 pl-8.5 pr-8 py-1.5 rounded-xl border text-[12.5px] transition-all focus:outline-none focus:ring-1 focus:ring-gold ${
                  isDark
                    ? 'bg-night-4 border-stone-800 text-stone-100 placeholder-stone-600'
                    : 'bg-white border-stone-200 text-stone-900 placeholder-stone-400'
                }`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none font-spine text-[10px] text-muted border border-stone-300 dark:border-stone-700 px-1 rounded">
                /
              </span>
            </div>

            {/* Format Filter Chips */}
            <div
              className={`hidden sm:flex items-center p-0.5 rounded-full border text-[11px] font-medium ${
                isDark ? 'bg-night-4 border-stone-800' : 'bg-white border-stone-200'
              }`}
            >
              {(['all', 'pdf', 'epub', 'docx', 'txt'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormatFilter(fmt)}
                  className={`px-2.5 py-1 rounded-full caps caps-sm transition-all cursor-pointer ${
                    formatFilter === fmt
                      ? 'bg-accent text-on-accent font-semibold'
                      : 'text-muted hover:text-stone-900 dark:hover:text-stone-200'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            {/* Sort Selector */}
            <div
              className={`flex items-center rounded-xl border px-2 py-1 gap-1 text-[12px] ${
                isDark ? 'bg-night-4 border-stone-800 text-stone-300' : 'bg-white border-stone-200 text-stone-700'
              }`}
            >
              <ArrowUpDown className="w-3 h-3 text-stone-400" />
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as any)}
                aria-label="Sort documents"
                className="bg-transparent border-none text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-gold rounded-sm cursor-pointer"
              >
                <option value="recent">Recent</option>
                <option value="title">Title</option>
                <option value="marks">Marks</option>
                <option value="words">Word Count</option>
              </select>
            </div>

            {/* View Mode Toggle (Grid / List) */}
            <div
              className={`flex items-center p-0.5 rounded-full border ${
                isDark ? 'bg-night-4 border-stone-800' : 'bg-white border-stone-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Shelf view"
                aria-label="Shelf view"
                aria-pressed={viewMode === 'grid'}
                className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-accent text-on-accent'
                    : 'text-muted hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                <Books className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                title="Bibliography list view"
                aria-label="Bibliography list view"
                aria-pressed={viewMode === 'list'}
                className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-accent text-on-accent'
                    : 'text-muted hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Shelf Content */}
        {isLoadingLibrary && stored.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
            <p className="font-spine text-[12px] text-muted">Reading your local shelf…</p>
          </div>
        ) : stored.length === 0 ? (
          <button
            type="button"
            onClick={() => onNavigate('upload', 'push')}
            className={`w-full rounded-2xl border-2 border-dashed py-20 px-6 flex flex-col items-center gap-4 text-center transition-all cursor-pointer ${
              isDark
                ? 'border-stone-800 hover:border-stone-700 bg-night-4/30'
                : 'border-stone-300 hover:border-stone-400 bg-stone-50/50'
            }`}
          >
            <div className="w-14 h-14 rounded-2xl bg-accent text-on-accent flex items-center justify-center shadow-sm">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <h3 className="title-hand text-[31px] text-stone-900 dark:text-stone-100">
                Your shelf is empty
              </h3>
              <p className="text-[13px] text-muted mt-1.5 max-w-md">
                Add a PDF, EPUB, DOCX, or text file. Everything stays local on your device.
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-gold">
              Add your first document <ArrowRight className="w-4 h-4" />
            </span>
          </button>
        ) : visible.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-center">
            <FileText className="w-6 h-6 text-stone-400" />
            <p className="font-serif text-[15px] text-stone-700 dark:text-stone-300">
              No documents match your filter
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setFormatFilter('all');
              }}
              className="font-spine text-[12px] font-semibold text-gold hover:underline cursor-pointer"
            >
              Reset filters
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          /* ── THE BOOKSHELF ── */
          <div id="stored-library">
            <Bookshelf
              docs={visible}
              groupByMonth={sortOrder === 'recent'}
              themes={settings.activeThemes}
              busyId={busyId}
              onOpen={(doc) => onOpenStoredDocument?.(doc)}
              onRename={commitRename}
              onDelete={commitDelete}
            />
          </div>
        ) : (
          /* ── COMPACT BIBLIOGRAPHY LIST VIEW ── */
          <div
            id="stored-library"
            className={`rounded-2xl border overflow-hidden ${
              isDark ? 'bg-night-4 border-stone-800' : 'bg-white border-stone-200/90'
            }`}
          >
            <div
              className={`grid grid-cols-12 gap-2 px-4 py-2.5 text-[11px] font-spine uppercase tracking-wider text-muted border-b ${
                isDark ? 'border-stone-800 bg-night-2' : 'border-stone-200/70 bg-stone-50'
              }`}
            >
              <div className="col-span-6">Title</div>
              <div className="col-span-2">Format</div>
              <div className="col-span-2 text-right">Words & Marks</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <div className="divide-y divide-stone-100 dark:divide-stone-800/80">
              {visible.map((doc) => (
                <div
                  key={doc.id}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-[13px] transition-colors ${
                    isDark ? 'hover:bg-white/2' : 'hover:bg-stone-50'
                  }`}
                >
                  <div className="col-span-6 flex items-center gap-3 min-w-0">
                    <BookMarked className="w-4 h-4 text-gold shrink-0" />
                    <button
                      type="button"
                      onClick={() => onOpenStoredDocument?.(doc)}
                      className="font-serif font-semibold text-stone-900 dark:text-stone-100 truncate hover:text-gold text-left cursor-pointer"
                    >
                      {doc.title}
                    </button>
                  </div>

                  <div className="col-span-2 font-spine text-[11px] text-muted uppercase">
                    {doc.format}
                    {typeof doc.progressPercent === 'number' && (
                      <span className="normal-case" title={progressLabel(doc)}> · {Math.round(doc.progressPercent)}%</span>
                    )}
                  </div>

                  <div className="col-span-2 text-right font-spine text-[11.5px] tabular-nums text-muted">
                    <span>{doc.wordCount.toLocaleString()}w</span>
                    {doc.annotationCount > 0 && (
                      <span className="ml-2 text-gold font-semibold">
                        · {doc.annotationCount}m
                      </span>
                    )}
                  </div>

                  <div className="col-span-2 flex items-center justify-end gap-1 text-[11px]">
                    {/* The confirm step lives here too. It used to exist only in the grid, so the
                        list's trash button set a pending-delete nobody could see or act on — and
                        switching to grid afterwards showed a card asking to be deleted that the
                        reader had never chosen. */}
                    {confirmingDeleteId === doc.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void commitDelete(doc.id)}
                          disabled={busyId === doc.id}
                          className="px-2 py-1 rounded text-red-600 dark:text-red-400 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer disabled:opacity-50"
                        >
                          {busyId === doc.id ? 'Deleting…' : 'Delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          className="px-2 py-1 rounded text-muted hover:bg-stone-200/60 dark:hover:bg-stone-800 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onOpenStoredDocument?.(doc)}
                          className="px-2 py-1 rounded hover:bg-stone-200/60 dark:hover:bg-stone-800 text-gold font-medium cursor-pointer"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(doc.id)}
                          aria-label={`Delete ${doc.title}`}
                          title={`Delete ${doc.title}`}
                          className="p-1 rounded text-muted hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── MY MARGINS TRACKER ────────────── */}
      <section
        className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
          isDark ? 'bg-night-3 border-stone-800/90' : 'bg-[#fcfbf9] border-stone-200/90'
        }`}
      >
        {/* Studio Top Control Strip */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b ${
            isDark ? 'border-stone-800/80 bg-night-4' : 'border-stone-200/70 bg-[#f7f5f0]'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gold/10 dark:bg-gold/15 flex items-center justify-center text-gold">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="title-hand text-[26px] text-stone-900 dark:text-stone-100 leading-none">
                  My Margins Tracker
                </h2>
                <span className="font-spine text-[10.5px] px-1.5 py-0.2 rounded bg-stone-500/10 text-stone-600 dark:text-stone-400">
                  {plural(totalMarks, 'mark')}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {onOpenMotifTracer && (
              <button
                type="button"
                onClick={onOpenMotifTracer}
                title="Follow an image or idea across every document"
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full border caps caps-sm text-[11.5px] cursor-pointer transition-colors ${
                  isDark ? 'border-stone-800 bg-night-2 text-stone-300 hover:border-gold' : 'border-stone-200 bg-white text-stone-700 hover:border-gold'
                }`}
              >
                <MotifPath className="w-3.5 h-3.5 text-gold" />
                Trace a motif
              </button>
            )}
            {!isStudioCollapsed && (
              <div
                role="tablist"
                aria-label="My Margins Tracker views"
                // Arrow keys move between tabs, which is what `role="tablist"` promises a screen
                // reader and a keyboard user. Without it the role was a claim the widget did not
                // honour, which is worse than no role at all.
                onKeyDown={(e) => {
                  const order = ['overview', 'themes', 'terminology'] as const;
                  const at = order.indexOf(studioTab);
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const next = (at + (e.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length;
                    goToStudioTab(order[next]);
                    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
                  }
                }}
                className={`flex items-center p-0.5 rounded-full border text-[11.5px] font-medium ${
                  isDark ? 'bg-night-2 border-stone-800' : 'bg-white border-stone-200'
                }`}
              >
                {(
                  [
                    { id: 'overview', label: 'Overview' },
                    { id: 'themes', label: 'Themes' },
                    { id: 'terminology', label: 'Terminologies' }
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    id={`studio-tab-${tab.id}`}
                    aria-selected={studioTab === tab.id}
                    aria-controls="knowledge-studio-body"
                    // Roving tabindex: the strip is one stop, and the arrow keys move within it.
                    tabIndex={studioTab === tab.id ? 0 : -1}
                    onClick={() => goToStudioTab(tab.id)}
                    className={`px-2.5 py-1 rounded-full caps caps-sm transition-all cursor-pointer ${
                      studioTab === tab.id
                        ? 'bg-accent text-on-accent shadow-2xs font-semibold'
                        : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={toggleStudioCollapsed}
              title={isStudioCollapsed ? 'Expand My Margins Tracker' : 'Collapse My Margins Tracker'}
              aria-label={isStudioCollapsed ? 'Expand My Margins Tracker' : 'Collapse My Margins Tracker'}
              aria-expanded={!isStudioCollapsed}
              aria-controls="knowledge-studio-body"
              className={`p-1.5 rounded-full border transition-colors cursor-pointer ${
                isDark
                  ? 'border-stone-800 text-stone-400 hover:bg-stone-800'
                  : 'border-stone-200 text-muted hover:bg-stone-100'
              }`}
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  isStudioCollapsed ? '-rotate-90' : 'rotate-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Studio Content Body */}
        <AnimatePresence initial={false}>
          {!isStudioCollapsed && (
            <motion.div
              id="knowledge-studio-body"
              role="tabpanel"
              aria-labelledby={`studio-tab-${studioTab}`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className="p-5">
                {/* ── BENTO OVERVIEW MODE ── */}
                {studioTab === 'overview' && (
                  <div
                    key={studioTab}
                    className={`${studioDirection === 1 ? TAB_IN_FORWARD : TAB_IN_BACK} grid md:grid-cols-2 grid-cols-1 gap-4`}
                  >
                    {/* Bento Card 1: Thematic Atlas */}
                    <div
                      className={`flex flex-col rounded-xl border p-4.5 ${
                        isDark ? 'bg-night-4/70 border-stone-800' : 'bg-white border-stone-200/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: keyConceptsTheme?.color || '#3b82f6' }}
                          />
                          <h3 className="title-hand text-[21px] text-stone-900 dark:text-stone-100">
                            Thematic Atlas
                          </h3>
                        </div>
                        <span className="font-spine text-[11px] text-muted tabular-nums">
                          {plural(keyConceptMarks, 'mark')}
                        </span>
                      </div>

                      <p className="text-[12px] text-muted leading-relaxed mb-3">
                        Key Concepts and color-coded topics tagged across My Collections.
                      </p>

                      {/* Theme List / Chips */}
                      <div className="flex-1 flex flex-col gap-1.5 min-h-27.5">
                        {keyConceptsBooks.length > 0 ? (
                          <div className="space-y-1">
                            <span className="text-[10.5px] uppercase tracking-wider font-spine font-medium text-muted">
                              Top Concept Volumes
                            </span>
                            {keyConceptsBooks.slice(0, 3).map((doc) => {
                              const conceptMarks = doc.themeCounts?.[keyConceptsTheme!.id] ?? 0;
                              return (
                                <button
                                  key={doc.id}
                                  type="button"
                                  onClick={() =>
                                    onOpenStoredDocument?.(doc, {
                                      kind: 'theme',
                                      themeId: keyConceptsTheme!.id,
                                      label: keyConceptsTheme!.name,
                                      color: keyConceptsTheme!.color
                                    })
                                  }
                                  className={`w-full flex items-center justify-between py-1.5 px-2 rounded-md text-left transition-colors cursor-pointer group ${
                                    isDark ? 'hover:bg-white/5' : 'hover:bg-stone-100'
                                  }`}
                                >
                                  <span className="font-serif text-[13px] text-stone-700 dark:text-stone-200 truncate group-hover:text-gold">
                                    {doc.title}
                                  </span>
                                  {/* This book's Key Concepts marks — the number this card is
                                      about. It used to also show how many DIFFERENT themes the
                                      book carried, which says nothing about key concepts and
                                      read as a wrong count sitting next to a right one. */}
                                  <span className="font-spine text-[11px] tabular-nums shrink-0 ml-2 text-muted">
                                    {plural(conceptMarks, 'mark')}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col justify-center items-center text-center p-3 rounded-lg bg-stone-500/5">
                            <Lightbulb className="w-5 h-5 text-stone-400 mb-1" />
                            <span className="text-[11.5px] text-muted">No key concepts tagged yet</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 pt-3 border-t border-stone-200/60 dark:border-stone-800/80 flex items-center justify-between text-[11.5px]">
                        <button
                          type="button"
                          onClick={() => goToStudioTab('themes')}
                          className="font-semibold text-gold hover:underline cursor-pointer"
                        >
                          View all {plural(settings.activeThemes.length, 'theme')} →
                        </button>
                        {themesAreUntouched && (
                          <button
                            type="button"
                            onClick={goToThemeSettings}
                            className="text-muted hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                          >
                            Customise
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bento Card 2: Terminologies */}
                    <div
                      className={`flex flex-col rounded-xl border p-4.5 ${
                        isDark ? 'bg-night-4/70 border-stone-800' : 'bg-white border-stone-200/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: settings.terminologyColor || '#ec4899' }}
                          />
                          <h3 className="title-hand text-[21px] text-stone-900 dark:text-stone-100">
                            Terminologies
                          </h3>
                        </div>
                        <span className="font-spine text-[11px] text-muted tabular-nums">
                          {plural(terminologyMarks, 'mark')}
                        </span>
                      </div>

                      <p className="text-[12px] text-muted leading-relaxed mb-3">
                        Specialized vocabularies and terminology defined while annotating passages.
                      </p>

                      <div className="flex-1 flex flex-col gap-1.5 min-h-27.5">
                        {documentsWithTerminology.length > 0 ? (
                          <div className="space-y-1">
                            <span className="text-[10.5px] uppercase tracking-wider font-spine font-medium text-muted">
                              Books with terms
                            </span>
                            {documentsWithTerminology.slice(0, 3).map((doc) => (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() =>
                                  onOpenStoredDocument?.(doc, {
                                    kind: 'terminology',
                                    label: 'Terminology',
                                    color: settings.terminologyColor
                                  })
                                }
                                className={`w-full flex items-center justify-between py-1 px-2 rounded-md text-left transition-colors cursor-pointer group ${
                                  isDark ? 'hover:bg-white/5' : 'hover:bg-stone-100'
                                }`}
                              >
                                <span className="font-serif text-[13px] text-stone-700 dark:text-stone-200 truncate group-hover:text-gold">
                                  {doc.title}
                                </span>
                                <span className="font-spine text-[11px] text-muted tabular-nums shrink-0 ml-2">
                                  {plural(doc.terminologyCount, 'mark')}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col justify-center items-center text-center p-3 rounded-lg bg-stone-500/5">
                            <Tag className="w-5 h-5 text-stone-400 mb-1" />
                            <span className="text-[11.5px] text-muted">No terms defined yet</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 pt-3 border-t border-stone-200/60 dark:border-stone-800/80 flex items-center justify-between text-[11.5px]">
                        <button
                          type="button"
                          onClick={() => goToStudioTab('terminology')}
                          className="font-semibold text-gold hover:underline cursor-pointer"
                        >
                          All terminology marks ({terminologyMarks}) →
                        </button>
                      </div>
                    </div>

                  </div>
                )}

                {/* ── THEMES EXPANDED VIEW ── */}
                {studioTab === 'themes' && (
                  <div
                    key={studioTab}
                    className={`${studioDirection === 1 ? TAB_IN_FORWARD : TAB_IN_BACK} space-y-4`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="title-hand text-[22px] text-stone-900 dark:text-stone-100">
                        All Active Themes & Key Concepts
                      </h3>
                      <button
                        type="button"
                        onClick={goToThemeSettings}
                        className="text-[12px] font-semibold text-gold hover:underline cursor-pointer"
                      >
                        Manage Theme Colors
                      </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                      {settings.activeThemes.map((theme) => {
                        const books = booksByTheme.get(theme.id) ?? [];
                        const totalMarksForTheme = books.reduce(
                          (sum, b) => sum + (b.themeCounts?.[theme.id] ?? 0),
                          0
                        );
                        return (
                          <div
                            key={theme.id}
                            className={`p-3.5 rounded-xl border ${
                              isDark ? 'bg-night-4/60 border-stone-800' : 'bg-white border-stone-200/80'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className="w-3 h-3 rounded-full shrink-0"
                                  style={{ backgroundColor: theme.color }}
                                />
                                <strong className="font-serif text-[13.5px] font-semibold text-stone-900 dark:text-stone-100">
                                  {theme.name}
                                </strong>
                              </span>
                              <span className="font-spine text-[11px] text-muted tabular-nums">
                                {plural(totalMarksForTheme, 'mark')}
                              </span>
                            </div>

                            {books.length > 0 ? (
                              <ul className="divide-y divide-stone-100 dark:divide-stone-800/60 mt-2">
                                {books.map((doc) => (
                                  <MarkPeekRow
                                    key={doc.id}
                                    docId={doc.id}
                                    title={doc.title}
                                    // Marks under THIS theme. A book's total theme count belongs
                                    // to the book, not to the theme card it is listed inside.
                                    count={doc.themeCounts?.[theme.id] ?? 0}
                                    themeId={theme.id}
                                    onOpen={() =>
                                      onOpenStoredDocument?.(doc, {
                                        kind: 'theme',
                                        themeId: theme.id,
                                        label: theme.name,
                                        color: theme.color
                                      })
                                    }
                                  />
                                ))}
                              </ul>
                            ) : (
                              <p className="text-[11.5px] text-muted italic mt-1">
                                No books marked with this theme yet.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── LEXICON EXPANDED VIEW ── */}
                {studioTab === 'terminology' && (
                  <div
                    key={studioTab}
                    className={`${studioDirection === 1 ? TAB_IN_FORWARD : TAB_IN_BACK} space-y-4`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="title-hand text-[22px] text-stone-900 dark:text-stone-100">
                        Terminologies Across My Collections
                      </h3>
                      <span className="font-spine text-[12px] text-muted tabular-nums">
                        {plural(terminologyMarks, 'mark')} in {plural(documentsWithTerminology.length, 'book')}
                      </span>
                    </div>

                    {documentsWithTerminology.length === 0 ? (
                      <div className="py-8 text-center text-muted text-[13px]">
                        No terminology marks captured yet. Select a word in any book and tag it as Terminology.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {documentsWithTerminology.map((doc) => (
                          <div
                            key={doc.id}
                            className={`p-3.5 rounded-xl border ${
                              isDark ? 'bg-night-4/60 border-stone-800' : 'bg-white border-stone-200/80'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Tag className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                              <span className="text-[11px] font-semibold tracking-wider uppercase text-muted">
                                Terminology
                              </span>
                            </div>
                            {/* The same expanding row as the theme cards: the caret shows the
                                terms themselves rather than only how many there are. */}
                            <ul>
                              <MarkPeekRow
                                docId={doc.id}
                                title={doc.title}
                                count={doc.terminologyCount}
                                themeId={null}
                                onOpen={() =>
                                  onOpenStoredDocument?.(doc, {
                                    kind: 'terminology',
                                    label: 'Terminology',
                                    color: settings.terminologyColor
                                  })
                                }
                              />
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* How each feature works, from real screenshots; the first-launch tour links here. */}
      <GuideSection isDark={isDark} />
    </main>
  );
};
