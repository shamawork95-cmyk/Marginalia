import React, { useCallback, useEffect, useState } from 'react';
import { Upload, Sparkles, ArrowRight, FileText, Clock, BookOpen, Clipboard, Pencil, Trash2, Check, X, Loader2, Type } from 'lucide-react';
import { motion } from 'motion/react';
import { Screen, TransitionType } from '../types';
import {
  StoredDocumentMeta,
  deleteStoredDocument,
  listStoredDocuments,
  renameStoredDocument
} from '../utils/documentStorage';

interface CachedAnalysis {
  documentTitle?: string;
  executiveSummary?: string;
  extractedThemes?: Array<{
    id: string;
    title: string;
    description: string;
    confidence: number;
    confidenceLabel: string;
    mentions: number;
    color: string;
  }>;
  synthesisQuote?: string;
}

interface HomeScreenProps {
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  activeDocument?: { title: string; text: string } | null;
  /**
   * `text` is optional and `docId` new: document bodies live on disk now and are fetched by id
   * when one is opened, so the library holds only metadata until then.
   */
  uploadedLibrary?: Array<{
    id: string;
    title: string;
    text?: string;
    date: string;
    wordCount: number;
    format?: string;
    docId?: string;
  }>;
  cachedAnalysis?: CachedAnalysis | null;
  onSelectDocumentForAnalysis?: (title: string, text: string, format?: string, docId?: string) => void;
  /** Reopens a stored document, fetching its text from disk first. */
  onOpenLibraryDocument?: (doc: {
    id: string;
    title: string;
    text?: string;
    date: string;
    wordCount: number;
    format?: string;
    docId?: string;
  }) => void;
  /** Opens a document straight from disk — a PDF lands in the viewer. */
  onOpenStoredDocument?: (meta: StoredDocumentMeta) => void;
  /** Reopens the document already in hand, in the PDF editor. */
  onContinueAnnotating?: () => void;
  /** False when the open document has no PDF behind it and so cannot be annotated. */
  canAnnotateActive?: boolean;
  onDocumentDeleted?: (id: string) => void;
  onDocumentRenamed?: (id: string, title: string) => void;
  /** Bumped after an upload so a newly stored document appears without a manual reload. */
  refreshToken?: number;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onNavigate,
  isDark = false,
  activeDocument = null,
  uploadedLibrary = [],
  cachedAnalysis = null,
  onSelectDocumentForAnalysis,
  onOpenStoredDocument,
  onContinueAnnotating,
  canAnnotateActive = false,
  onDocumentDeleted,
  onDocumentRenamed,
  refreshToken = 0
}) => {
  const hasActiveDoc = Boolean(activeDocument?.text?.trim());
  const hasAnalysis = Boolean(cachedAnalysis?.extractedThemes?.length);
  const themes = cachedAnalysis?.extractedThemes || [];

  /**
   * The library, read from disk rather than from this session's state.
   *
   * That distinction is the whole point. The list used to come from `uploadedLibrary`, which is
   * held in sessionStorage — and Electron clears sessionStorage when the app quits, so every
   * document vanished from the interface on restart even though the files were still on disk.
   * Reading the store directly means the library survives quitting, and shows documents added in
   * any earlier session.
   */
  const [stored, setStored] = useState<StoredDocumentMeta[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    setStored(await listStoredDocuments());
    setIsLoadingLibrary(false);
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary, refreshToken]);

  const commitRename = async (id: string) => {
    const title = draftTitle.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    setBusyId(id);
    const updated = await renameStoredDocument(id, title);
    if (updated) {
      setStored((prev) => prev.map((d) => (d.id === id ? updated : d)));
      onDocumentRenamed?.(id, updated.title);
    }
    setBusyId(null);
    setRenamingId(null);
  };

  const commitDelete = async (id: string) => {
    setBusyId(id);
    if (await deleteStoredDocument(id)) {
      setStored((prev) => prev.filter((d) => d.id !== id));
      onDocumentDeleted?.(id);
    }
    setBusyId(null);
    setConfirmingDeleteId(null);
  };

  const formatBytes = (bytes: number) =>
    !bytes ? '—' : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  /**
   * One row: opening, renaming and deleting a document, all from the library.
   *
   * Clicking the row opens the document — a PDF goes straight to the viewer. Rename and delete
   * sit on the row itself rather than behind a menu, because they are the only two things anyone
   * ever wants to do to a document they are not opening.
   */
  const libraryList = (
    <section id="stored-library" className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-stone-400" />
        <h3 className="text-[13px] font-bold text-stone-700 dark:text-stone-300 tracking-wide">
          Your Documents
        </h3>
        <span className="text-[11px] text-stone-400 tabular-nums">{stored.length}</span>
      </div>

      {isLoadingLibrary && stored.length === 0 ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
        </div>
      ) : stored.length === 0 ? (
        <div className="p-4 rounded-2xl border border-dashed border-stone-300 dark:border-stone-800 text-center bg-stone-50/50 dark:bg-stone-900/30">
          <p className="text-[12px] text-stone-500 dark:text-stone-400">
            Nothing stored yet. Documents you add stay on this computer until you delete them.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {stored.map((doc) => {
            const isRenaming = renamingId === doc.id;
            const isConfirming = confirmingDeleteId === doc.id;
            const canOpen = doc.format === 'PDF' && doc.originalBytes > 0;

            return (
              <div
                key={doc.id}
                className={`rounded-2xl border transition-all ${
                  isDark ? 'bg-[#1b201d] border-stone-800' : 'bg-white border-stone-200/70'
                }`}
              >
                <div className="p-3.5">
                  {isRenaming ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(doc.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className={`flex-1 min-w-0 px-3 py-2 rounded-lg border text-[13px] focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
                          isDark ? 'bg-[#121514] border-stone-700 text-stone-100' : 'bg-white border-stone-300 text-stone-900'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => void commitRename(doc.id)}
                        disabled={busyId === doc.id}
                        title="Save name"
                        className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        title="Cancel"
                        className="p-2 rounded-lg text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenStoredDocument?.(doc)}
                      title={canOpen ? 'Open in the PDF viewer' : 'Open'}
                      className="w-full text-left flex items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-medium text-[13px] text-stone-900 dark:text-stone-100 truncate group-hover:text-emerald-800 dark:group-hover:text-emerald-300">
                            {doc.title}
                          </h4>
                          <p className="text-[11px] text-stone-500 dark:text-stone-400">
                            {doc.format} • {doc.wordCount.toLocaleString()} words • {formatBytes(doc.originalBytes)} •{' '}
                            {new Date(doc.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
                    </button>
                  )}
                </div>

                {!isRenaming && (
                  <div className={`flex items-center justify-end gap-1 px-3 py-2 border-t ${isDark ? 'border-stone-800' : 'border-stone-100'}`}>
                    {isConfirming ? (
                      <div className="flex items-center gap-2 w-full">
                        <span className="text-[11.5px] text-red-700 dark:text-red-400 flex-1 leading-tight">
                          Delete permanently from this computer?
                        </span>
                        <button
                          type="button"
                          onClick={() => void commitDelete(doc.id)}
                          disabled={busyId === doc.id}
                          className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11.5px] font-semibold cursor-pointer disabled:opacity-50"
                        >
                          {busyId === doc.id ? '…' : 'Delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          className="px-3 py-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 text-[11.5px] font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Edit opens the PDF editor. Renaming is a separate, clearly labelled
                            action — calling the rename "Edit" was misleading, since nobody
                            expects an edit button to change a title rather than open the file. */}
                        {canOpen && (
                          <button
                            type="button"
                            onClick={() => onOpenStoredDocument?.(doc)}
                            title="Open in the PDF editor"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 text-[11.5px] font-semibold cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(doc.id);
                            setDraftTitle(doc.title);
                          }}
                          title="Change this document's name"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 text-[11.5px] font-semibold cursor-pointer"
                        >
                          <Type className="w-3.5 h-3.5" />
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(doc.id)}
                          title="Delete from this computer"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-stone-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 text-[11.5px] font-semibold cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <main className="flex-1 px-5 md:px-8 lg:px-12 py-6 md:py-10 pb-28 md:pb-10 max-w-350 mx-auto w-full">
      {hasActiveDoc ? (
        /* ──────────────── HAS ACTIVE DOCUMENT STATE ──────────────── */
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Left Column: Current Document + Insights */}
          <div className="md:col-span-7 lg:col-span-8 flex flex-col gap-6">
            {/* Last Analyzed Card */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
              id="active-document-section"
              className={`rounded-3xl p-6 md:p-8 border transition-colors ${
                isDark
                  ? 'bg-[#1b201d] border-stone-800 text-stone-100'
                  : 'bg-[#f0eee9] border-stone-300/60 text-stone-900'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[11px] font-bold tracking-widest text-emerald-700 dark:text-emerald-400 uppercase">
                    LAST ANALYZED
                  </span>
                </div>
                <div className="bg-[#435c52] p-2 rounded-xl text-white shadow-xs">
                  <FileText className="w-4 h-4" />
                </div>
              </div>

              <h2 className="font-serif text-[26px] md:text-[36px] tracking-tight font-bold leading-[1.1] mb-2 text-stone-900 dark:text-white">
                {activeDocument!.title || 'Uploaded Document'}
              </h2>
              <p className="text-[13px] text-stone-600 dark:text-stone-400 mb-6 leading-relaxed line-clamp-2">
                {activeDocument!.text.substring(0, 160).trim()}…
              </p>

              {/* Word count + date info */}
              <div className="flex items-center gap-3 text-[12px] text-stone-500 dark:text-stone-400 mb-6">
                <span>{activeDocument!.text.split(/\s+/).filter(Boolean).length.toLocaleString()} words</span>
                <span className="text-stone-300 dark:text-stone-700">•</span>
                <span>This session</span>
              </div>

              <div className="flex flex-wrap gap-3">
                {/* Continuing to annotate is the primary action on a document already open —
                    the old "Read & Annotate" button opened a separate text reader, which is gone. */}
                <button
                  id="continue-annotating-btn"
                  type="button"
                  onClick={() => onContinueAnnotating?.()}
                  disabled={!canAnnotateActive}
                  title={
                    canAnnotateActive
                      ? 'Open this document in the PDF editor'
                      : 'Only PDFs can be annotated'
                  }
                  className="bg-[#435c52] hover:bg-[#374c43] active:scale-[0.97] disabled:opacity-45 disabled:cursor-default text-white py-3 px-6 rounded-2xl font-semibold text-[14px] transition-all shadow-sm flex items-center gap-2 cursor-pointer"
                >
                  <Pencil className="w-4 h-4" />
                  Continue Annotating
                </button>

                {/* Analysis stays reachable, but quietly — it is no longer the headline action. */}
                <button
                  id="view-analysis-btn"
                  type="button"
                  onClick={() => onNavigate('analysis', 'push')}
                  className={`py-3 px-6 rounded-2xl font-semibold text-[14px] transition-all flex items-center gap-2 cursor-pointer active:scale-[0.97] border ${
                    isDark
                      ? 'border-stone-700 text-stone-200 hover:bg-stone-800'
                      : 'border-stone-300 text-stone-700 hover:bg-white'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  View Analysis
                </button>
              </div>
            </motion.section>

            {/* AI Insights Preview (from cached analysis) */}
            {hasAnalysis && (
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.5, delay: 0.1 }}
                id="ai-insights-preview"
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-[20px] font-bold tracking-tight text-stone-900 dark:text-white">
                    AI Insights
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigate('analysis', 'push')}
                    className="text-[12px] font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-300 cursor-pointer transition-colors"
                  >
                    View Full Analysis
                  </button>
                </div>

                {/* Executive Summary */}
                {cachedAnalysis?.executiveSummary && (
                  <div className={`p-4 rounded-2xl border text-[13px] italic leading-relaxed ${
                    isDark
                      ? 'bg-emerald-950/20 border-emerald-900/40 text-stone-300'
                      : 'bg-emerald-50/50 border-emerald-200/60 text-stone-700'
                  }`}>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 not-italic block mb-1">
                      AI Summary
                    </span>
                    &ldquo;{cachedAnalysis.executiveSummary}&rdquo;
                  </div>
                )}

                {/* Theme Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {themes.slice(0, 4).map((theme, idx) => (
                    <motion.div
                      key={theme.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: 'spring', bounce: 0, duration: 0.4, delay: 0.15 + idx * 0.05 }}
                      onClick={() => onNavigate('analysis', 'push')}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all hover:scale-[0.98] duration-200 ease-out ${
                        isDark
                          ? 'bg-[#1b201d] border-stone-800 hover:border-stone-700'
                          : 'bg-white border-stone-200/70 hover:border-stone-300 shadow-xs'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: theme.color || '#8b5cf6' }}
                        />
                        <span className="text-[13px] font-bold text-stone-900 dark:text-white truncate">
                          {theme.title}
                        </span>
                      </div>
                      <p className="text-[12px] text-stone-600 dark:text-stone-400 line-clamp-2 leading-relaxed mb-3">
                        {theme.description}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: theme.color || '#8b5cf6' }}
                        >
                          {theme.confidenceLabel || `${Math.round(theme.confidence * 100)}%`}
                        </span>
                        <span className="text-[11px] text-stone-500">
                          {theme.mentions} mentions
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}
          </div>

          {/* Right Column: Quick Actions + Recent Docs */}
          <div className="md:col-span-5 lg:col-span-4 flex flex-col gap-6">
            {/* Quick Actions */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.5, delay: 0.05 }}
              id="quick-actions-section"
              className="grid grid-cols-2 gap-3"
            >
              <button
                id="upload-document-btn"
                type="button"
                onClick={() => onNavigate('upload', 'slide_up')}
                className={`flex flex-col items-center justify-center p-5 rounded-2xl border transition-all cursor-pointer active:scale-[0.97] ${
                  isDark
                    ? 'bg-[#1b201d] border-stone-800 text-stone-200 hover:bg-[#232a26]'
                    : 'bg-white border-stone-200/70 text-stone-800 hover:bg-stone-50 shadow-xs'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center mb-2.5">
                  <Upload className="w-5 h-5 text-emerald-700 dark:text-emerald-300" />
                </div>
                <span className="text-[13px] font-semibold">Upload Doc</span>
              </button>

              <button
                id="paste-text-btn"
                type="button"
                onClick={() => onNavigate('upload', 'slide_up')}
                className={`flex flex-col items-center justify-center p-5 rounded-2xl border transition-all cursor-pointer active:scale-[0.97] ${
                  isDark
                    ? 'bg-[#1b201d] border-stone-800 text-stone-200 hover:bg-[#232a26]'
                    : 'bg-white border-stone-200/70 text-stone-800 hover:bg-stone-50 shadow-xs'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800/80 flex items-center justify-center mb-2.5">
                  <Clipboard className="w-5 h-5 text-stone-600 dark:text-stone-300" />
                </div>
                <span className="text-[13px] font-semibold">Paste Text</span>
              </button>
            </motion.section>

            {/* The library, read from disk — see `libraryList`. */}
            {libraryList}
          </div>
        </div>
      ) : (
        /* ──────────────── EMPTY STATE: NO DOCUMENT ──────────────── */
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-lg mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.6 }}
            className="space-y-6"
          >
            {/* Icon */}
            <div className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center ${
              isDark ? 'bg-[#1b201d]' : 'bg-[#f0eee9]'
            }`}>
              <BookOpen className="w-9 h-9 text-[#435c52]" />
            </div>

            {/* Title */}
            <div className="space-y-2">
              <h2 className="font-serif text-[28px] md:text-[34px] font-bold tracking-tight text-stone-900 dark:text-white">
                Start Annotating
              </h2>
              <p className="text-[14px] text-stone-500 dark:text-stone-400 leading-relaxed max-w-sm mx-auto">
                Upload a document or paste text to unlock AI-powered thematic analysis, insights, and annotation tools.
              </p>
            </div>

            {/* Primary CTA */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                id="empty-upload-btn"
                type="button"
                onClick={() => onNavigate('upload', 'slide_up')}
                className="w-full sm:w-auto bg-[#435c52] hover:bg-[#374c43] active:scale-[0.97] text-white py-3.5 px-8 rounded-2xl font-semibold text-[14px] transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                Upload Document
              </button>
              <button
                id="empty-paste-btn"
                type="button"
                onClick={() => onNavigate('upload', 'slide_up')}
                className={`w-full sm:w-auto py-3.5 px-8 rounded-2xl font-semibold text-[14px] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.97] border ${
                  isDark
                    ? 'border-stone-700 text-stone-200 hover:bg-stone-800'
                    : 'border-stone-300 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <Clipboard className="w-4 h-4" />
                Paste Text
              </button>
            </div>

            {/* Feature hints */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6">
              {[
                { icon: Sparkles, label: 'AI Themes', desc: 'Extract key themes with Gemini' },
                { icon: FileText, label: 'Smart Notes', desc: 'AI-generated annotations' },
                { icon: BookOpen, label: 'Deep Reader', desc: 'Mindful reading experience' }
              ].map((feature, idx) => (
                <motion.div
                  key={feature.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.4, delay: 0.2 + idx * 0.08 }}
                  className={`p-4 rounded-2xl border text-center ${
                    isDark
                      ? 'bg-[#1b201d] border-stone-800'
                      : 'bg-white border-stone-200/70 shadow-xs'
                  }`}
                >
                  <feature.icon className="w-5 h-5 text-[#435c52] mx-auto mb-2" />
                  <div className="text-[12px] font-bold text-stone-900 dark:text-white">{feature.label}</div>
                  <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">{feature.desc}</div>
                </motion.div>
              ))}
            </div>

            {/* Recent docs even in empty state */}
            {uploadedLibrary.length > 0 && (
              <div className="w-full pt-6 space-y-3 text-left">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-stone-400" />
                  <h3 className="text-[13px] font-bold text-stone-700 dark:text-stone-300">
                    Previous Sessions
                  </h3>
                </div>
                <div className="space-y-2">
                  {uploadedLibrary.slice(0, 3).map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => {
                        if (onSelectDocumentForAnalysis) {
                          onSelectDocumentForAnalysis(doc.title, doc.text, doc.format);
                        }
                        onNavigate('analysis', 'push');
                      }}
                      className={`p-3 rounded-2xl border transition-all flex items-center justify-between cursor-pointer hover:shadow-xs active:scale-[0.98] ${
                        isDark
                          ? 'bg-[#1b201d] border-stone-800 hover:bg-[#232a26]'
                          : 'bg-white border-stone-200/70 hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-4 h-4 text-stone-400 shrink-0" />
                        <span className="text-[13px] font-medium text-stone-800 dark:text-stone-200 truncate">
                          {doc.title}
                        </span>
                      </div>
                      <span className="text-[11px] text-stone-500 shrink-0 ml-2">
                        {doc.wordCount.toLocaleString()} words
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>

          {/* Also shown with no document open: on a fresh launch this is the only way back to
              what was stored earlier, and it used to be hidden behind having a document open. */}
          <div className="w-full max-w-lg mt-10 text-left">{libraryList}</div>
        </div>
      )}
    </main>
  );
};
