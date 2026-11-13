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
import { Upload, BookOpen, Pencil } from './icons';
import { GuideSection } from './GuideSection';
import { motion } from 'motion/react';
import { AnnotationFocus, Screen, TransitionType, UserSettings } from '../types';
import { initialSettings } from '../data/mockData';
import {
  StoredDocumentMeta,
  deleteStoredDocument,
  listStoredDocuments,
  renameStoredDocument
} from '../utils/documentStorage';
import { ErrorDialog } from './ErrorDialog';
import { MarginsTracker } from './home/MarginsTracker';
import { ReadingsShelf } from './home/ReadingsShelf';

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

      <ReadingsShelf busyId={busyId} commitDelete={commitDelete} commitRename={commitRename} confirmingDeleteId={confirmingDeleteId} formatFilter={formatFilter} isDark={isDark} isLoadingLibrary={isLoadingLibrary} onNavigate={onNavigate} onOpenStoredDocument={onOpenStoredDocument} query={query} searchInputRef={searchInputRef} setConfirmingDeleteId={setConfirmingDeleteId} setFormatFilter={setFormatFilter} setQuery={setQuery} setSortOrder={setSortOrder} setViewMode={setViewMode} settings={settings} sortOrder={sortOrder} stored={stored} viewMode={viewMode} visible={visible} />

      <MarginsTracker booksByTheme={booksByTheme} documentsWithTerminology={documentsWithTerminology} goToStudioTab={goToStudioTab} goToThemeSettings={goToThemeSettings} isDark={isDark} isStudioCollapsed={isStudioCollapsed} keyConceptMarks={keyConceptMarks} keyConceptsBooks={keyConceptsBooks} keyConceptsTheme={keyConceptsTheme} onOpenMotifTracer={onOpenMotifTracer} onOpenStoredDocument={onOpenStoredDocument} settings={settings} studioDirection={studioDirection} studioTab={studioTab} terminologyMarks={terminologyMarks} themesAreUntouched={themesAreUntouched} toggleStudioCollapsed={toggleStudioCollapsed} totalMarks={totalMarks} />

      {/* How each feature works, from real screenshots; the first-launch tour links here. */}
      <GuideSection isDark={isDark} />
    </main>
  );
};
