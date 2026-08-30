/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Screen, TransitionType, UserSettings, StickyNote } from './types';
import { initialSettings } from './data/mockData';
import { analysisCacheKey } from './utils/cacheKeys';
import { fetchDocumentText, StoredDocumentMeta } from './utils/documentStorage';
import { CustomFormat } from './utils/documentExporter';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { DesktopNav } from './components/DesktopNav';
import { HomeScreen } from './components/HomeScreen';
import { ThematicAnalysisScreen } from './components/ThematicAnalysisScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { UploadDocumentScreen } from './components/UploadDocumentScreen';
import { ReaderScreen } from './components/ReaderScreen';
import { PdfWorkspace } from './components/pdf/PdfWorkspace';
import { DocumentLibraryPanel } from './components/DocumentLibraryPanel';
import { SearchModal } from './components/SearchModal';
import { SidebarDrawer } from './components/SidebarDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';

// ── Storage Keys ──
const SETTINGS_KEY = 'marginalia_settings';       // localStorage — persists across sessions
const SESSION_KEY = 'marginalia_session';          // sessionStorage — per-tab, clears on close

// ── Helpers ──
/**
 * Loads saved preferences, merged over the current defaults.
 *
 * The merge is the important part. Settings written by an older version of the app do not carry
 * fields added since — the annotation palettes, for instance — and returning the stored object
 * as-is handed the interface `undefined` where it expected an array. Spreading over
 * `initialSettings` means a missing field falls back to its default instead of crashing, and any
 * setting added in future is covered automatically.
 */
function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<UserSettings>;
      return {
        ...initialSettings,
        ...stored,
        // Arrays need an explicit guard: a stored `null`, or an empty list saved by mistake,
        // would otherwise leave the app with no themes at all.
        activeThemes: stored.activeThemes?.length ? stored.activeThemes : initialSettings.activeThemes
      };
    }
  } catch (e) { /* ignore */ }
  return initialSettings;
}

function saveSettings(s: UserSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

/** One document in the library. `text` is present only in memory — see `saveSession`. */
export interface LibraryDocument {
  id: string;
  title: string;
  text?: string;
  date: string;
  wordCount: number;
  format?: string;
  /** Id in the server's on-disk document store, used to re-fetch `text` on demand. */
  docId?: string;
}

export interface AnalysisDoc {
  title: string;
  text: string;
  format?: string;
  docId?: string;
}

interface SessionState {
  currentScreen: Screen;
  analysisDoc: AnalysisDoc;
  uploadedLibrary: LibraryDocument[];
  /** Sticky notes, keyed by document title, shared by the Reader and the Inspection Panel. */
  documentNotes: Record<string, StickyNote[]>;
  /** Inline bold/highlight/underline marks, keyed by document title. */
  documentFormats: Record<string, CustomFormat[]>;
}

function loadSession(): SessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Persists the session WITHOUT any document text. Document bodies live on the server's disk
 * (see `utils/documentStorage.ts`) and are re-fetched by `docId`, so only the id and metadata
 * are written here — a full book's text would blow straight past the ~5MB sessionStorage
 * quota and make the whole write fail, silently losing notes and formats along with it.
 */
function saveSession(s: SessionState) {
  try {
    const lean: SessionState = {
      ...s,
      analysisDoc: { ...s.analysisDoc, text: s.analysisDoc.docId ? '' : s.analysisDoc.text },
      uploadedLibrary: s.uploadedLibrary.map(({ text, ...rest }) => (rest.docId ? rest : { ...rest, text }))
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(lean));
  } catch (e) { /* ignore */ }
}

/** Load cached AI analysis for a document (from sessionStorage) */
function loadCachedAnalysis(docTitle: string): any | null {
  try {
    const raw = sessionStorage.getItem(analysisCacheKey(docTitle));
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

export default function App() {
  // ── Hydrate state ──
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());

  /**
   * The saved session, read ONCE.
   *
   * This used to be a bare `loadSession()` call in the component body, which meant a
   * sessionStorage read and a full JSON.parse of the session on every single render — including
   * every keystroke while typing a note. `useRef` with a lazy initialiser keeps the hydration
   * value available to the state initialisers below without repeating the work.
   */
  const savedSessionRef = useRef<SessionState | null>(null);
  if (savedSessionRef.current === null) savedSessionRef.current = loadSession();
  const savedSession = savedSessionRef.current;

  const [currentScreen, setCurrentScreen] = useState<Screen>(
    savedSession?.currentScreen || 'home'
  );
  const [transitionType, setTransitionType] = useState<TransitionType>('push');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [analysisDoc, setAnalysisDoc] = useState<AnalysisDoc>(
    savedSession?.analysisDoc || { title: '', text: '' }
  );
  const [uploadedLibrary, setUploadedLibrary] = useState<LibraryDocument[]>(
    savedSession?.uploadedLibrary || []
  );
  const [documentLoadError, setDocumentLoadError] = useState<string | null>(null);

  // Per-document notes and inline formats, lifted here so they survive navigating away and back.
  const [documentNotes, setDocumentNotes] = useState<Record<string, StickyNote[]>>(
    savedSession?.documentNotes || {}
  );
  const [documentFormats, setDocumentFormats] = useState<Record<string, CustomFormat[]>>(
    savedSession?.documentFormats || {}
  );

  const updateDocumentNotes = useCallback(
    (docTitle: string, updater: (prev: StickyNote[]) => StickyNote[]) => {
      setDocumentNotes((prev) => ({ ...prev, [docTitle]: updater(prev[docTitle] || []) }));
    },
    []
  );

  const updateDocumentFormats = useCallback(
    (docTitle: string, updater: (prev: CustomFormat[]) => CustomFormat[]) => {
      setDocumentFormats((prev) => ({ ...prev, [docTitle]: updater(prev[docTitle] || []) }));
    },
    []
  );

  // The library panel reads from disk rather than from `uploadedLibrary`, so it can show
  // documents stored in earlier sessions that this one has never opened. `libraryRefreshToken`
  // is bumped after an upload to pull the newly stored document into that list.
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [libraryRefreshToken, setLibraryRefreshToken] = useState(0);

  // Rehydrate the active document's text from the server after a reload. The session only kept
  // its `docId` (see `saveSession`), so without this the app would come back up with a title and
  // no body. A null result means the server's sweeper already retired the document past its
  // retention window — a real state the reader needs told about, not a silent empty screen.
  useEffect(() => {
    if (!analysisDoc.docId || analysisDoc.text) return;
    let cancelled = false;
    fetchDocumentText(analysisDoc.docId).then((text) => {
      if (cancelled) return;
      if (text) {
        setAnalysisDoc((prev) => (prev.docId === analysisDoc.docId ? { ...prev, text } : prev));
      } else {
        setDocumentLoadError(
          `"${analysisDoc.title}" is no longer in your library. Add it again to keep reading.`
        );
      }
    });
    return () => { cancelled = true; };
  }, [analysisDoc.docId, analysisDoc.text, analysisDoc.title]);

  // Cached analysis for home screen (read from sessionStorage)
  const [cachedAnalysis, setCachedAnalysis] = useState<any>(null);

  // Load cached analysis whenever analysisDoc changes
  useEffect(() => {
    if (analysisDoc.title && analysisDoc.text) {
      const cached = loadCachedAnalysis(analysisDoc.title);
      setCachedAnalysis(cached);
    } else {
      setCachedAnalysis(null);
    }
  }, [analysisDoc.title, analysisDoc.text]);

  // ── Persist settings to localStorage ──
  useEffect(() => { saveSettings(settings); }, [settings]);

  /**
   * Persist the session, debounced.
   *
   * Writing straight through fired a full serialise-and-store on every state change — once per
   * keystroke while writing a note, with the whole library and every note re-encoded each time.
   * A short delay collapses a burst of edits into one write; the cleanup runs the pending write
   * on unmount so nothing is lost on the way out.
   */
  useEffect(() => {
    const snapshot = { currentScreen, analysisDoc, uploadedLibrary, documentNotes, documentFormats };
    const timer = window.setTimeout(() => saveSession(snapshot), 400);
    return () => window.clearTimeout(timer);
  }, [currentScreen, analysisDoc, uploadedLibrary, documentNotes, documentFormats]);

  const isDark = settings.darkMode;
  const hasActiveDocument = Boolean(analysisDoc.text?.trim());

  const navigate = useCallback((screen: Screen, transition: TransitionType = 'push') => {
    setTransitionType(transition);
    setCurrentScreen(screen);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const handleSelectDocumentForAnalysis = useCallback(
    (title: string, text: string, format?: string, docId?: string) => {
      const newDoc: LibraryDocument = {
        id: `doc-${Date.now()}`,
        title: title || 'Untitled Document',
        text,
        date: new Date().toLocaleDateString(),
        wordCount: text.split(/\s+/).filter(Boolean).length,
        format,
        docId
      };
      setDocumentLoadError(null);
      setUploadedLibrary((prev) => [newDoc, ...prev.filter((d) => d.title !== title)]);
      setAnalysisDoc({ title, text, format, docId });
    },
    []
  );

  /** Pulls a library document's text back from the server before opening it for analysis. */
  const handleOpenLibraryDocument = useCallback(
    async (doc: LibraryDocument) => {
      if (doc.text) {
        handleSelectDocumentForAnalysis(doc.title, doc.text, doc.format, doc.docId);
        return;
      }
      if (!doc.docId) return;
      const text = await fetchDocumentText(doc.docId);
      if (text) {
        handleSelectDocumentForAnalysis(doc.title, text, doc.format, doc.docId);
      } else {
        setDocumentLoadError(
          `"${doc.title}" is no longer in your library. Add it again to keep reading.`
        );
        setUploadedLibrary((prev) => prev.filter((d) => d.id !== doc.id));
      }
    },
    [handleSelectDocumentForAnalysis]
  );

  /**
   * Opens a document straight from the on-disk library. Its text is fetched first because the
   * library list carries only metadata, and the AI panel needs the text to have anything to
   * analyze even though the viewer renders the original file.
   */
  const handleOpenStoredDocument = useCallback(
    async (meta: StoredDocumentMeta) => {
      const text = (await fetchDocumentText(meta.id)) || '';
      setDocumentLoadError(null);
      setAnalysisDoc({ title: meta.title, text, format: meta.format, docId: meta.id });
      setUploadedLibrary((prev) => [
        {
          id: `doc-${meta.id}`,
          title: meta.title,
          text,
          date: new Date(meta.createdAt).toLocaleDateString(),
          wordCount: meta.wordCount,
          format: meta.format,
          docId: meta.id
        },
        ...prev.filter((d) => d.docId !== meta.id)
      ]);
      setIsLibraryOpen(false);
      // Only a PDF with its original file stored has pages to annotate; anything else is
      // text-only and belongs on the analysis screen.
      navigate(meta.format === 'PDF' && meta.originalBytes > 0 ? 'workspace' : 'analysis', 'push');
    },
    [navigate]
  );

  /** Drops a deleted document from this session's in-memory library too. */
  const handleStoredDocumentDeleted = useCallback((id: string) => {
    setUploadedLibrary((prev) => prev.filter((d) => d.docId !== id));
    setAnalysisDoc((prev) => {
      if (prev.docId !== id) return prev;
      // The open document was just erased from disk; there is nothing left to show.
      return { title: '', text: '' };
    });
  }, []);

  const handleStoredDocumentRenamed = useCallback((id: string, title: string) => {
    setUploadedLibrary((prev) => prev.map((d) => (d.docId === id ? { ...d, title } : d)));
    setAnalysisDoc((prev) => (prev.docId === id ? { ...prev, title } : prev));
  }, []);

  const getTransitionVariants = () => {
    switch (transitionType) {
      case 'push':
        return {
          initial: { opacity: 0, x: 20 },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -20 },
          transition: { duration: 0.22, ease: 'easeOut' as const }
        };
      case 'push_back':
        return {
          initial: { opacity: 0, x: -20 },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: 20 },
          transition: { duration: 0.22, ease: 'easeOut' as const }
        };
      case 'slide_up':
        return {
          initial: { opacity: 0, y: 30 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -30 },
          transition: { duration: 0.25, ease: 'easeOut' as const }
        };
      case 'none':
      default:
        return {
          initial: { opacity: 1 },
          animate: { opacity: 1 },
          exit: { opacity: 1 },
          transition: { duration: 0 }
        };
    }
  };

  const variants = getTransitionVariants();

  return (
    <div
      id="app-container"
      className={`min-h-screen flex flex-row font-sans transition-colors duration-200 overflow-x-clip w-full max-w-full ${
        isDark ? 'bg-[#121514] text-white dark' : 'bg-[#f9f9f7] text-[#1c2321]'
      }`}
    >
      {/* Desktop Sidebar Navigation (hidden on mobile) */}
      <DesktopNav
        currentScreen={currentScreen}
        onNavigate={navigate}
        isDark={isDark}
        hasActiveDocument={hasActiveDocument}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Search Dialog */}
        <SearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          onNavigate={navigate}
          isDark={isDark}
          uploadedLibrary={uploadedLibrary}
          documentNotes={documentNotes}
          onSelectDocumentForAnalysis={handleSelectDocumentForAnalysis}
          onOpenLibraryDocument={handleOpenLibraryDocument}
        />

        {/* Sidebar Drawer (mobile menu) */}
        <SidebarDrawer
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onNavigate={navigate}
          isDark={isDark}
        />

        {/* Screen Rendering */}
        {currentScreen === 'workspace' && analysisDoc.docId ? (
          <ErrorBoundary onGoHome={() => navigate('home', 'push_back')}>
            <PdfWorkspace
              docId={analysisDoc.docId}
              documentTitle={analysisDoc.title}
              settings={settings}
              isDark={isDark}
              onNavigate={navigate}
            />
          </ErrorBoundary>
        ) : currentScreen === 'reader' ? (
          <ReaderScreen
            settings={settings}
            onNavigate={navigate}
            isDark={isDark}
            documentText={analysisDoc.text}
            documentTitle={analysisDoc.title}
            notes={documentNotes[analysisDoc.title] || []}
            onNotesChange={(updater) => updateDocumentNotes(analysisDoc.title, updater)}
          />
        ) : (
          <div className="flex-1 flex flex-col min-h-screen">
            {/* Shared Header for Non-Reader Screens — mobile only since desktop has sidebar */}
            <div className="md:hidden">
              <Header
                currentScreen={currentScreen}
                onNavigate={navigate}
                onOpenMenu={() => setIsSidebarOpen(true)}
                onOpenSearch={() => setIsSearchOpen(true)}
                isDark={isDark}
              />
            </div>

            {documentLoadError && (
              <div className="mx-4 mt-3 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start justify-between gap-3 text-amber-900 dark:text-amber-200 text-[12px]">
                <span>{documentLoadError}</span>
                <button
                  type="button"
                  onClick={() => setDocumentLoadError(null)}
                  className="shrink-0 font-bold opacity-60 hover:opacity-100 cursor-pointer"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Active Screen Content with Animated Transition */}
            <div className="flex-1 flex flex-col">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentScreen}
                  initial={variants.initial}
                  animate={variants.animate}
                  exit={variants.exit}
                  transition={variants.transition}
                  className="flex-1 flex flex-col"
                >
                  <ErrorBoundary onGoHome={() => navigate('home', 'push_back')}>
                    {currentScreen === 'home' && (
                      <HomeScreen
                        onNavigate={navigate}
                        isDark={isDark}
                        activeDocument={analysisDoc.text ? analysisDoc : null}
                        uploadedLibrary={uploadedLibrary}
                        cachedAnalysis={cachedAnalysis}
                        onSelectDocumentForAnalysis={handleSelectDocumentForAnalysis}
                        onOpenLibraryDocument={handleOpenLibraryDocument}
                        onOpenStoredDocument={handleOpenStoredDocument}
                        onContinueAnnotating={() => navigate('workspace', 'push')}
                        canAnnotateActive={Boolean(analysisDoc.docId && analysisDoc.format === 'PDF')}
                        onDocumentDeleted={handleStoredDocumentDeleted}
                        onDocumentRenamed={handleStoredDocumentRenamed}
                        refreshToken={libraryRefreshToken}
                      />
                    )}

                    {currentScreen === 'analysis' && (
                      <ThematicAnalysisScreen
                        onNavigate={navigate}
                        isDark={isDark}
                        documentTitle={analysisDoc.title}
                        documentText={analysisDoc.text}
                        isPdfSource={analysisDoc.format === 'PDF'}
                        notes={documentNotes[analysisDoc.title] || []}
                        onNotesChange={(updater) => updateDocumentNotes(analysisDoc.title, updater)}
                        formats={documentFormats[analysisDoc.title] || []}
                        onFormatsChange={(updater) => updateDocumentFormats(analysisDoc.title, updater)}
                        authorName={settings.name}
                      />
                    )}

                    {currentScreen === 'settings' && (
                      <SettingsScreen
                        settings={settings}
                        onUpdateSettings={setSettings}
                        onNavigate={navigate}
                        isDark={isDark}
                        onStorageChanged={() => setLibraryRefreshToken((n) => n + 1)}
                      />
                    )}

                    {currentScreen === 'upload' && (
                      <UploadDocumentScreen
                        onNavigate={navigate}
                        isDark={isDark}
                        uploadedLibrary={uploadedLibrary}
                        onSelectDocumentForAnalysis={handleSelectDocumentForAnalysis}
                        onOpenLibraryDocument={handleOpenLibraryDocument}
                        onDocumentStored={() => setLibraryRefreshToken((n) => n + 1)}
                        onOpenLibrary={() => setIsLibraryOpen(true)}
                      />
                    )}
                  </ErrorBoundary>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Persistent Bottom Navigation (mobile only via md:hidden in component) */}
        <BottomNav
          currentScreen={currentScreen}
          onNavigate={navigate}
          isDark={isDark}
          hasActiveDocument={hasActiveDocument}
        />
      </div>

      {/* Library tab — everything stored on this device, with rename and permanent delete. */}
      <DocumentLibraryPanel
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        isDark={isDark}
        onOpenDocument={handleOpenStoredDocument}
        activeDocumentId={analysisDoc.docId}
        onDocumentDeleted={handleStoredDocumentDeleted}
        onDocumentRenamed={handleStoredDocumentRenamed}
        refreshToken={libraryRefreshToken}
      />
    </div>
  );
}
