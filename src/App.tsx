/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AnnotationFocus, ReaderJump, Screen, TransitionType, UserSettings, StickyNote } from './types';
import { initialSettings } from './data/mockData';
import { fetchDocumentText, fetchRemoteSettings, saveRemoteSettings, StoredDocumentMeta, desktopBridge, getTutorialSeen, setTutorialSeen } from './utils/documentStorage';
import { CustomFormat } from './utils/documentExporter';
import { usePlainTextAnnotations } from './hooks/usePlainTextAnnotations';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { DesktopNav } from './components/DesktopNav';
import { HomeScreen } from './components/HomeScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { UploadDocumentScreen } from './components/UploadDocumentScreen';
import { ReaderScreen } from './components/ReaderScreen';
import { PdfWorkspace } from './components/pdf/PdfWorkspace';
import { isAnnotatableFormat } from './utils/annotatableFormats';
import { DocumentLibraryPanel } from './components/DocumentLibraryPanel';
import { SearchModal } from './components/SearchModal';
import { SidebarDrawer } from './components/SidebarDrawer';
import { ChangelogModal } from './components/ChangelogModal';
import { UpdatePrompt } from './components/UpdatePrompt';
import { CURRENT_APP_VERSION } from './data/changelog';
import { ErrorDialog } from './components/ErrorDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FOCUS_HOTKEY } from './components/FocusMode';
import { Tutorial } from './components/Tutorial';
import { showGuide } from './components/GuideSection';
import { FeedbackPrompt } from './components/Feedback';
import { MotifTracer } from './components/MotifTracer';
import type { OpenedClassPack } from './utils/documentStorage';
import { localThemeStore } from './components/themeStore';
import { themesToAdd } from './utils/marksExport';
import { isTypingTarget } from './components/pdf/workspaceKeys';
import { withoutSecrets } from './hooks/settingsCache';
import { mergeHydratedSettings } from './hooks/settingsHydration';
import { flushAllPending, handleBeforeUnload } from './hooks/unloadFlush';

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
/** Merges a partial, possibly-stale settings object over the current defaults — shared by the
 *  localStorage read below and the server-backed one fetched after mount. */
function mergeSettings(stored: Partial<UserSettings>): UserSettings {
  return {
    ...initialSettings,
    ...stored,
    // Arrays need an explicit guard: a stored `null`, or an empty list saved by mistake,
    // would otherwise leave the app with no themes at all.
    activeThemes: stored.activeThemes?.length ? stored.activeThemes : initialSettings.activeThemes
  };
}

function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    // Stripped on read too, so a key cached by an older version never reaches the app from here.
    if (raw) return mergeSettings(withoutSecrets(JSON.parse(raw) as Partial<UserSettings>));
  } catch (e) { /* ignore */ }
  return initialSettings;
}

function saveSettings(s: UserSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(withoutSecrets(s))); } catch (e) { /* ignore */ }
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

export default function App() {
  // ── Hydrate state ──
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  /** The settings the session started on, so edits made before the disk copy arrives survive it. */
  const launchSettings = useRef(settings);
  // shortcut: themes live in settings for now; the dedicated theme storage API replaces this adapter.
  const themeStore = useMemo(() => localThemeStore(settings.activeThemes, setSettings), [settings.activeThemes]);
  /** Themes a marks import brought along, kept with their ids so the imported marks find them. */
  const addImportedThemes = useCallback(
    (themes: UserSettings['activeThemes']) =>
      setSettings((prev) => ({ ...prev, activeThemes: [...prev.activeThemes, ...themesToAdd(prev.activeThemes, themes)] })),
    []
  );

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
  /**
   * The first-run picture tour, shown on Home until it is finished or skipped, and again from
   * Settings. "Seen" is on disk (desktop config.json); it starts true so a returning reader never
   * sees it flash while the flag is read.
   */
  const [tutorialSeen, setTutorialSeenState] = useState(true);
  const [tutorialRequested, setTutorialRequested] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getTutorialSeen().then((seen) => {
      if (!cancelled) setTutorialSeenState(seen);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  /** Where a motif trace sent the reader inside the document it opened. */
  const [readerJump, setReaderJump] = useState<ReaderJump | null>(null);
  const [motifOpen, setMotifOpen] = useState(false);
  /** Focus mode: the page alone (reader and PDF workspace only). See `FocusMode.tsx`. */
  const [focusMode, setFocusMode] = useState(false);
  const readingScreen = currentScreen === 'reader' || currentScreen === 'workspace';
  const focusOn = focusMode && readingScreen;
  useEffect(() => {
    if (!readingScreen) setFocusMode(false);
  }, [readingScreen]);
  // F toggles focus mode and Escape leaves it; never while typing, in a dialog, or with a modifier.
  useEffect(() => {
    if (!readingScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === 'Escape') setFocusMode(false);
      else if (!e.shiftKey && e.key.toLowerCase() === FOCUS_HOTKEY.toLowerCase()) setFocusMode((on) => !on);
    };
    // On window, so it runs after every document-level handler (popovers, the workspace) has had
    // its say and marked a used Escape with preventDefault, whatever order they registered in.
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readingScreen]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /**
   * Whether the workspace should pick up where the reader left off, or open at page one.
   *
   * Opening a book from the library is "start this book"; pressing Continue annotating is
   * "carry on with it". Restoring the last page for both meant a book someone opened to read
   * from the beginning dropped them two hundred pages in, with no obvious way back.
   */
  const [resumeAnnotating, setResumeAnnotating] = useState(false);
  /**
   * What the reader asked to be shown inside the document they just opened, when they opened it
   * by tapping a book on the dashboard rather than opening it outright. Cleared on every other
   * way in, so a later plain open does not resurrect an old request.
   */
  const [annotationFocus, setAnnotationFocus] = useState<AnnotationFocus | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [analysisDoc, setAnalysisDoc] = useState<AnalysisDoc>(
    savedSession?.analysisDoc || { title: '', text: '' }
  );
  const [uploadedLibrary, setUploadedLibrary] = useState<LibraryDocument[]>(
    savedSession?.uploadedLibrary || []
  );
  const [documentLoadError, setDocumentLoadError] = useState<string | null>(null);

  const hasHydratedRemoteSettings = useRef(false);
  /** Re-render once the durable settings have been read, so the changelog check can run. */
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  /** Whether anything was already saved — i.e. whether this reader predates this version. */
  const hadStoredSettings = useRef(false);
  /** The current settings, for effects that must read them without depending on them. */
  const settingsRef = useRef(settings);
  // Current on every render, before any effect runs: the changelog check below reads it right after
  // hydration, before the persist effect further down would have updated it.
  settingsRef.current = settings;

  /**
   * The "what changed" dialog, shown once after an update.
   *
   * Which version the reader has already seen lives in the durable settings, not in
   * localStorage. The desktop build's embedded server binds a fresh port every launch, and a
   * different port is a different origin — so a flag written to localStorage is gone by the next
   * start, and the dialog reappears every single launch with no way to stop it.
   *
   * It also waits for those settings to be read. Deciding before they arrive means deciding
   * against defaults, which is the same mistake as writing before reading.
   */
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [changelogVersion, setChangelogVersion] = useState<string>(CURRENT_APP_VERSION);
  const changelogChecked = useRef(false);

  // Last input mode on <html>, for the focus ring in index.css: a mouse click followed by a lone
  // modifier (Cmd for a screenshot) must not light the ring; only Tab brings it back. Arrows, Space
  // and Enter keep the current mode, so paging the reader after a click shows no stray ring.
  useEffect(() => {
    const root = document.documentElement;
    const onPointer = () => { root.dataset.input = 'pointer'; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Tab') root.dataset.input = 'keyboard'; };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  useEffect(() => {
    if (!settingsHydrated || changelogChecked.current) return;
    changelogChecked.current = true;
    let cancelled = false;

    void (async () => {
      // The packaged app knows its real version; the bundled constant is the fallback for a
      // browser run, where there is no desktop bridge to ask.
      let active = CURRENT_APP_VERSION;
      const bridge = desktopBridge();
      if (bridge) {
        try {
          const info = await bridge.getAppInfo();
          if (info?.version) active = info.version;
        } catch {
          /* fall back to the bundled version */
        }
      }
      if (cancelled) return;

      setChangelogVersion(active);
      const seen = settingsRef.current.lastSeenVersion;
      if (seen === active) return;

      // A first-ever launch gets no changelog — there is nothing to have changed since. That is
      // what `hadStoredSettings` distinguishes: settings on disk mean this reader existed before
      // this version did.
      if (!seen && !hadStoredSettings.current) {
        setSettings((prev) => ({ ...prev, lastSeenVersion: active }));
        return;
      }
      setIsChangelogOpen(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [settingsHydrated]);

  const handleCloseChangelog = useCallback(() => {
    setIsChangelogOpen(false);
    // Written through the settings, so it survives the next launch.
    setSettings((prev) => ({ ...prev, lastSeenVersion: changelogVersion }));
  }, [changelogVersion]);

  const handleOpenChangelog = useCallback(() => {
    setIsChangelogOpen(true);
  }, []);

  // Per-document notes and inline formats, lifted here so they survive navigating away and back.
  const [documentNotes] = useState<Record<string, StickyNote[]>>(
    savedSession?.documentNotes || {}
  );
  const [documentFormats] = useState<Record<string, CustomFormat[]>>(
    savedSession?.documentFormats || {}
  );

  /**
   * Server-backed notes/formats for the plain-text/EPUB reader, once a document has a `docId` to
   * key them on — the title-keyed `documentNotes`/`documentFormats` session maps above remain
   * only as the fallback for text that was never saved (see the ReaderScreen render below).
   */
  /**
   * The text reader's own notes and formats — and ONLY for documents the text reader owns.
   *
   * This hook writes a document's entire annotation list, and so does the PDF workspace. Running
   * both against the same document meant two writers with two ideas of what it contains: on every
   * open the store took two identical writes, and the hook's copy of the workspace's marks was a
   * snapshot taken once, never refreshed as the reader kept marking. Any later write from this
   * side would put that stale snapshot back and take the newer marks with it.
   *
   * A document opens in exactly one of the two surfaces, so exactly one of them should be able to
   * write it. PDFs and imported HTML belong to the workspace; everything else to the reader.
   */
  const plainTextAnnotations = usePlainTextAnnotations(
    analysisDoc.docId && !isAnnotatableFormat(analysisDoc.format) ? analysisDoc.docId : undefined,
    // A document with no docId was never saved: its marks live in memory for this run, starting
    // from the older notes and formats this session still holds for its title (converted on read).
    analysisDoc.docId
      ? undefined
      : {
          key: analysisDoc.title,
          seed: () => [
            ...(documentNotes[analysisDoc.title] || []).map((n) => ({ ...n, kind: 'note' })),
            ...(documentFormats[analysisDoc.title] || []).map((f) => ({ ...f, kind: 'format' }))
          ]
        }
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
          `"${analysisDoc.title}" is no longer in My Collections. Add it again to keep reading.`
        );
      }
    });
    return () => { cancelled = true; };
  }, [analysisDoc.docId, analysisDoc.text, analysisDoc.title]);


  /**
   * Adopt the server-saved settings once, on mount, if they differ from what localStorage handed
   * back as the initial state.
   *
   * The desktop build's embedded server binds to a fresh random port every launch (see
   * server.ts's PORT=0 comment), and a different port is a different origin to the browser — so
   * localStorage alone resets on every restart and every auto-update even though nothing was
   * actually lost. The settings file on disk (see documentStore's getSettings) lives outside the
   * browser's per-origin storage and survives both, so it is treated as the source of truth once
   * it has loaded; a `null` response just means this is the very first launch, and the
   * localStorage/default value already in state stands.
   */
  useEffect(() => {
    let cancelled = false;
    /**
     * Keeps asking until the durable copy answers.
     *
     * Nothing may be written back until it does. A failed read is not an empty settings file, and
     * treating it as one is how a reader's themes get replaced by the defaults: the embedded
     * server can still be starting when this first runs, and on a fresh machine localStorage is
     * empty too (the desktop build binds a new port each launch, and a different port is a
     * different origin), so there is nothing left holding the real values.
     */
    const hydrate = async (attempt = 0) => {
      const result = await fetchRemoteSettings();
      if (cancelled) return;
      if (result.ok) {
        if (result.settings) {
          hadStoredSettings.current = true;
          // Edits made since launch (a theme made while this was loading) are kept, not replaced.
          const remote = mergeSettings(result.settings as Partial<UserSettings>);
          setSettings((prev) => mergeHydratedSettings(remote as never, launchSettings.current as never, prev as never) as UserSettings);
        }
        hasHydratedRemoteSettings.current = true;
        setSettingsHydrated(true);
        return;
      }
      // Roughly 15 seconds of retries. Past that the store is genuinely unreachable, and the
      // session runs on whatever is in memory WITHOUT ever writing it back, so nothing on disk is
      // overwritten by a guess.
      if (attempt < 20) {
        window.setTimeout(() => void hydrate(attempt + 1), 750);
        return;
      }
      console.error('[Marginalia] Could not read saved settings; not writing over them.');
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Persist settings to localStorage immediately (fast, same-session cache) and to the durable
   * on-disk copy, debounced — the "Your name" field fires this on every keystroke, and writing
   * straight through would mean a disk write and a request per character.
   *
   * Skipped until the remote hydration above has run once: otherwise the very first render (still
   * holding localStorage's or the default's value) would overwrite the durable copy before it has
   * even been read.
   */
  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
    if (!hasHydratedRemoteSettings.current) return;
    const timer = window.setTimeout(() => { void saveRemoteSettings(settings as unknown as Record<string, unknown>); }, 400);
    return () => window.clearTimeout(timer);
  }, [settings]);

  /**
   * Saves pending annotation autosaves (PDF workspace and text reader) when the window closes,
   * reloads or the app quits — see `hooks/unloadFlush`. In the desktop app the main process can
   * also ask for an awaited flush before it quits or closes the window; that hook is used only
   * when the preload offers it.
   */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      handleBeforeUnload(event);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    const desktop = (window as unknown as {
      marginaliaDesktop?: { onFlushPendingSaves?: (handler: () => Promise<boolean>) => () => void };
    }).marginaliaDesktop;
    const unsubscribe = desktop?.onFlushPendingSaves?.(flushAllPending);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      unsubscribe?.();
    };
  }, []);

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
    // The library panel is docked beside the CONTENT, not floating above it, so leaving it open
    // across a navigation takes 320px from every screen that follows. At the 900px minimum window
    // that leaves the library itself about 360px — three dashboard cards at 110px each.
    setIsLibraryOpen(false);
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
          `"${doc.title}" is no longer in My Collections. Add it again to keep reading.`
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
    async (meta: StoredDocumentMeta, focus?: AnnotationFocus, jump?: ReaderJump) => {
      const text = (await fetchDocumentText(meta.id)) || '';
      setDocumentLoadError(null);
      setResumeAnnotating(false);
      setAnnotationFocus(focus ?? null);
      setReaderJump(jump ?? null);
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
      // Only a document stored as a paginated PDF has pages to annotate — an uploaded PDF, or
      // an HTML book that was printed to one on import. Anything else is text-only and opens in
      // the plain-text reader instead.
      navigate(
        isAnnotatableFormat(meta.format) && meta.originalBytes > 0 ? 'workspace' : 'reader',
        'push'
      );
    },
    [navigate]
  );

  /** Drops a deleted document from this session's in-memory library too. */
  const handleStoredDocumentDeleted = useCallback(
    (id: string) => {
      setUploadedLibrary((prev) => prev.filter((d) => d.docId !== id));
      setAnalysisDoc((prev) => {
        if (prev.docId !== id) return prev;
        // The open document was just erased from disk; there is nothing left to show. The reader
        // and the workspace both render nothing without a document, so leaving the screen where
        // it was showed an empty content area with no way out but the sidebar.
        if (currentScreen === 'workspace' || currentScreen === 'reader') {
          navigate('home', 'push_back');
        }
        return { title: '', text: '' };
      });
    },
    [currentScreen, navigate]
  );

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
        isDark ? 'bg-night text-paper dark' : 'bg-paper text-ink'
      }`}
    >
      {/* Desktop Sidebar Navigation (hidden on mobile, and in focus mode) */}
      {!focusOn && <DesktopNav
        currentScreen={currentScreen}
        onNavigate={navigate}
        isDark={isDark}
        hasActiveDocument={hasActiveDocument}
        collapsed={Boolean(settings.sidebarCollapsed)}
        onToggleCollapsed={() => setSettings((prev) => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }))}
        onOpenSearch={() => setIsSearchOpen(true)}
      />}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Search Dialog */}
        <SearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          onNavigate={navigate}
          isDark={isDark}
          onOpenStoredDocument={handleOpenStoredDocument}
        />

        {/* Sidebar Drawer (mobile menu) */}
        <SidebarDrawer
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onNavigate={navigate}
          isDark={isDark}
          currentScreen={currentScreen}
        />

        {/* What's New changelog dialog, opened on first launch after update or from Settings */}
        <ChangelogModal
          isOpen={isChangelogOpen}
          onClose={handleCloseChangelog}
          isDark={isDark}
          initialVersion={changelogVersion}
        />

        <UpdatePrompt isDark={isDark} onOpenChangelog={handleOpenChangelog} changelogOpen={isChangelogOpen} />

        <MotifTracer
          open={motifOpen}
          onClose={() => setMotifOpen(false)}
          isDark={isDark}
          settings={settings}
          onUpdateSettings={setSettings}
          onOpen={(meta, jump) => void handleOpenStoredDocument(meta, undefined, jump)}
        />

        <FeedbackPrompt
          isDark={isDark}
          blocked={isChangelogOpen || tutorialRequested || (!tutorialSeen && currentScreen === 'home') || isSearchOpen || motifOpen}
        />

        <Tutorial
          open={!isChangelogOpen && (tutorialRequested || (!tutorialSeen && currentScreen === 'home'))}
          onClose={() => {
            if (!tutorialSeen) void setTutorialSeen(true);
            setTutorialSeenState(true);
            setTutorialRequested(false);
          }}
          isDark={isDark}
          onShowGuide={() => {
            navigate('home', 'push_back');
            // Once Home has mounted, and the dialog has gone, so focus and scrolling land on the page.
            window.setTimeout(showGuide, 450);
          }}
        />

        {/* Screen Rendering */}
        {currentScreen === 'workspace' && analysisDoc.docId ? (
          <ErrorBoundary onGoHome={() => navigate('home', 'push_back')}>
            <PdfWorkspace
              // Forces a full remount per document rather than reusing one instance across a
              // docId prop change. Without this, switching straight from one book to another
              // (e.g. via search, without passing back through Home) let a save already in
              // flight for the OLD book's stale, not-yet-reset state fire against the NEW book's
              // docId in the brief window before its own load effect had caught up — the exact
              // shape of "a book's tags vanish after opening another one and tagging it."
              key={analysisDoc.docId}
              docId={analysisDoc.docId}
              documentTitle={analysisDoc.title}
              resumeReading={resumeAnnotating}
              focus={annotationFocus ?? undefined}
              settings={settings}
              isDark={isDark}
              onNavigate={navigate}
              focusMode={focusOn}
              onToggleFocus={() => setFocusMode((on) => !on)}
              themeStore={themeStore}
              onAddThemes={addImportedThemes}
              jumpToPage={readerJump ? readerJump.paragraphIndex + 1 : undefined}
            />
          </ErrorBoundary>
        ) : currentScreen === 'reader' ? (
          <ReaderScreen
            // Same reasoning as `PdfWorkspace` above — one fresh instance per document, not one
            // instance whose docId prop silently changes underneath it.
            key={analysisDoc.docId ?? analysisDoc.title}
            settings={settings}
            onNavigate={navigate}
            isDark={isDark}
            documentText={analysisDoc.text}
            documentTitle={analysisDoc.title}
            docId={analysisDoc.docId}
            annotations={plainTextAnnotations}
            focus={annotationFocus ?? undefined}
            focusMode={focusOn}
            onToggleFocus={() => setFocusMode((on) => !on)}
            themeStore={themeStore}
            onSpreadChange={(on) => setSettings((prev) => ({ ...prev, readerSpread: on }))}
            onAddThemes={addImportedThemes}
            jump={readerJump ?? undefined}
            onUpdateSettings={setSettings}
          />
        ) : (
          <div className="relative flex-1 flex flex-col min-h-screen">
            {/*
              The strip of window above the library masthead.
              
              Every screen with a header of its own already drags by it, but Library, Settings and
              Add Document begin with `main`'s top padding — bare background that belonged to
              nothing, so the only draggable part of the window was the sidebar. This claims it.
              Excluded on the workspace, whose header sits at y=0 and would have its back button
              covered; that header is a drag region in its own right.
            */}
            {currentScreen !== 'workspace' && (
              <div aria-hidden className="app-drag absolute top-0 left-0 right-0 h-8 z-30" />
            )}

            {/* Shared Header for Non-Reader Screens — mobile only since desktop has sidebar */}
            <div className="md:hidden">
              <Header
                onNavigate={navigate}
                onOpenMenu={() => setIsSidebarOpen(true)}
                onOpenSearch={() => setIsSearchOpen(true)}
                isDark={isDark}
              />
            </div>

            {/* A document that would not open is worth stopping for: the reader clicked it
                expecting to read, and a banner above a scrolled library is easy to miss. */}
            <ErrorDialog
              open={Boolean(documentLoadError)}
              title="Could not open that document"
              message={documentLoadError ?? ''}
              onClose={() => setDocumentLoadError(null)}
            />

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
                        settings={settings}
                        onUpdateSettings={setSettings}
                        activeDocument={analysisDoc.text ? analysisDoc : null}
                        uploadedLibrary={uploadedLibrary}
                        onSelectDocumentForAnalysis={handleSelectDocumentForAnalysis}
                        onOpenLibraryDocument={handleOpenLibraryDocument}
                        onOpenStoredDocument={handleOpenStoredDocument}
                        onContinueAnnotating={() => {
                          setResumeAnnotating(true);
                          setAnnotationFocus(null);
                          // Text documents (TXT, EPUB, DOCX, pasted custom text) resume in the
                          // reader, which carries the same annotation tools; PDFs in the workspace.
                          navigate(isAnnotatableFormat(analysisDoc.format) ? 'workspace' : 'reader', 'push');
                        }}
                        canAnnotateActive={Boolean(analysisDoc.docId || analysisDoc.text?.trim())}
                        onDocumentDeleted={handleStoredDocumentDeleted}
                        onDocumentRenamed={handleStoredDocumentRenamed}
                        refreshToken={libraryRefreshToken}
                        onOpenMotifTracer={() => setMotifOpen(true)}
                      />
                    )}

                    {currentScreen === 'settings' && (
                      <SettingsScreen
                        settings={settings}
                        onUpdateSettings={setSettings}
                        onNavigate={navigate}
                        isDark={isDark}
                        onStorageChanged={() => setLibraryRefreshToken((n) => n + 1)}
                        onOpenChangelog={handleOpenChangelog}
                        onShowTutorial={() => setTutorialRequested(true)}
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
                        onClassPackOpened={(opened: OpenedClassPack) => {
                          if (opened.themes.length) addImportedThemes(opened.themes);
                          setLibraryRefreshToken((n) => n + 1);
                          void handleOpenStoredDocument(opened.meta);
                        }}
                      />
                    )}
                  </ErrorBoundary>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Persistent Bottom Navigation (mobile only via md:hidden in component) */}
        {!focusOn && (
          <BottomNav
            currentScreen={currentScreen}
            onNavigate={navigate}
            isDark={isDark}
            hasActiveDocument={hasActiveDocument}
          />
        )}
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
