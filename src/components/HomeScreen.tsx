/**
 * The library: everything stored on this computer, and the way back into it.
 *
 * Laid out as a grid that fills the window rather than a column down the middle. The previous
 * version put a narrow list in the centre of a wide screen, so a library of a dozen books left
 * two thirds of the page empty and showed four of them — the shape of the page said "there is
 * not much here" about a shelf that was actually full.
 *
 * Documents are read from disk rather than from this session's state. That distinction matters:
 * the list used to come from `sessionStorage`, which Electron clears on quit, so every document
 * vanished from the interface on restart even though the files were still there.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Upload,
  Sparkles,
  ArrowRight,
  FileText,
  Search,
  BookOpen,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
  Type,
  Highlighter
} from 'lucide-react';
import { isAnnotatableFormat } from '../utils/annotatableFormats';
import { motion } from 'motion/react';
import { Screen, TransitionType } from '../types';
import { documentThumbnail } from '../utils/documentThumbnail';
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

/**
 * The colour of a document's spine: the app's own green.
 *
 * An earlier version picked a different hue per title so the shelf was easier to scan, but a
 * row of blues, purples and reds belonged to no part of the rest of the interface — the covers
 * were the loudest thing on a page whose whole palette is one muted green. The titles below
 * already tell the books apart; the covers only need to look like they come from here.
 */
const SPINE_COLOR = '#435c52';

/** The initials shown on a document's tile, standing in for a cover image we do not have. */
function monogram(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

const formatBytes = (bytes: number) =>
  !bytes ? '—' : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * The cover: the document's actual first page, rendered from the stored original.
 *
 * The monogram tile it replaces was a placeholder for artwork we did not have — but for the
 * formats the workspace can open we do have artwork, in the form of page one. It is kept as a
 * fallback for the formats with no page to render (DOCX, EPUB, pasted text) and for the moment
 * before the render lands, so a card never has a hole where its cover goes.
 */
const DocumentCover: React.FC<{ doc: StoredDocumentMeta }> = ({ doc }) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    void documentThumbnail(doc).then((dataUrl) => {
      if (!cancelled) setSrc(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.updatedAt, doc.format, doc.originalBytes]);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        // Anchored to the top of the page rather than centred: a title page's title sits in its
        // upper half, and centring a tall page would crop it out of the card entirely.
        className="absolute inset-0 h-full w-full object-cover object-top bg-white"
      />
    );
  }

  return (
    <span
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: `linear-gradient(135deg, ${SPINE_COLOR} 0%, ${SPINE_COLOR}cc 100%)` }}
    >
      <span className="font-serif text-[34px] font-bold text-white/95 tracking-tight select-none">
        {monogram(doc.title)}
      </span>
    </span>
  );
};

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onNavigate,
  isDark = false,
  activeDocument = null,
  cachedAnalysis = null,
  onOpenStoredDocument,
  onContinueAnnotating,
  canAnnotateActive = false,
  onDocumentDeleted,
  onDocumentRenamed,
  refreshToken = 0
}) => {
  const hasActiveDoc = Boolean(activeDocument?.text?.trim());
  const themes = cachedAnalysis?.extractedThemes || [];

  const [stored, setStored] = useState<StoredDocumentMeta[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return stored;
    return stored.filter((d) => d.title.toLowerCase().includes(needle) || d.format.toLowerCase().includes(needle));
  }, [stored, query]);

  const totalWords = useMemo(() => stored.reduce((sum, d) => sum + d.wordCount, 0), [stored]);
  const totalMarks = useMemo(() => stored.reduce((sum, d) => sum + (d.annotationCount || 0), 0), [stored]);

  const card = (doc: StoredDocumentMeta, index: number) => {
    const isRenaming = renamingId === doc.id;
    const isConfirming = confirmingDeleteId === doc.id;
    const canOpen = isAnnotatableFormat(doc.format) && doc.originalBytes > 0;

    return (
      <motion.article
        key={doc.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        // Staggered only for the first screenful; beyond that the delay outlasts the scroll.
        transition={{ duration: 0.28, delay: Math.min(index, 11) * 0.025 }}
        // Capped so a shelf holding one or two books does not stretch them across the whole
        // window; `auto-fit` below does the rest, collapsing tracks nothing occupies so a row is
        // never left with a hole at the end of it.
        style={{ maxWidth: 420 }}
        className={`group relative flex w-full flex-col rounded-2xl border overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5 ${
          isDark
            ? 'bg-[#1b201d] border-stone-800 hover:border-stone-700'
            : 'bg-white border-stone-200/80 hover:border-stone-300 shadow-xs'
        }`}
      >
        {/* The cover: the document's own first page, so the shelf can be scanned by sight rather
            than by reading a column of similar titles. */}
        <button
          type="button"
          onClick={() => onOpenStoredDocument?.(doc)}
          title={canOpen ? 'Open in the annotating workspace' : 'Open'}
          className="relative h-44 w-full cursor-pointer overflow-hidden bg-stone-100 dark:bg-stone-900"
        >
          <DocumentCover doc={doc} />
          {/* The badges sit on a page now rather than a solid colour, so each carries its own
              dark backing — white-on-white would otherwise be unreadable on a title page. */}
          <span className="absolute top-2.5 left-2.5 px-1.5 py-0.5 rounded-md bg-black/45 text-[10px] font-bold tracking-widest text-white uppercase">
            {doc.format}
          </span>
          {doc.annotationCount > 0 && (
            <span
              className="absolute top-2.5 right-2.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/45 text-white text-[10px] font-semibold tabular-nums"
              title={`${doc.annotationCount} mark${doc.annotationCount === 1 ? '' : 's'} on this document`}
            >
              <Highlighter className="w-2.5 h-2.5" />
              {doc.annotationCount}
            </span>
          )}
          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        </button>

        <div className="flex-1 flex flex-col p-3 gap-1.5 min-w-0">
          {isRenaming ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename(doc.id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                className={`flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border text-[13px] focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
                  isDark ? 'bg-[#121514] border-stone-700 text-stone-100' : 'bg-white border-stone-300 text-stone-900'
                }`}
              />
              <button
                type="button"
                onClick={() => void commitRename(doc.id)}
                disabled={busyId === doc.id}
                title="Save name"
                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setRenamingId(null)}
                title="Cancel"
                className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOpenStoredDocument?.(doc)}
                className="text-left cursor-pointer min-w-0"
              >
                <h3 className="font-serif text-[15px] font-semibold leading-snug text-stone-900 dark:text-stone-100 line-clamp-2 group-hover:text-[#435c52] dark:group-hover:text-emerald-300 transition-colors">
                  {doc.title}
                </h3>
              </button>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
                {doc.wordCount.toLocaleString()} words · {formatBytes(doc.originalBytes)}
                <br />
                {new Date(doc.updatedAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                })}
              </p>
            </>
          )}

          {/* Actions sit at the foot of the card, revealed on hover so a shelf at rest is titles
              and covers rather than rows of buttons. */}
          {!isRenaming && (
            <div className="mt-auto pt-1.5">
              {isConfirming ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-red-700 dark:text-red-400 leading-snug">
                    Delete permanently from this computer?
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void commitDelete(doc.id)}
                      disabled={busyId === doc.id}
                      className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {busyId === doc.id ? '…' : 'Delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      className="px-2.5 py-1 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 text-[11px] font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  {canOpen && (
                    <button
                      type="button"
                      onClick={() => onOpenStoredDocument?.(doc)}
                      title="Open in the annotating workspace"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 text-[11px] font-semibold cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                      Annotate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(doc.id);
                      setDraftTitle(doc.title);
                    }}
                    title="Change this document's name"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 text-[11px] font-semibold cursor-pointer"
                  >
                    <Type className="w-3 h-3" />
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(doc.id)}
                    title="Delete from this computer"
                    aria-label={`Delete ${doc.title}`}
                    className="ml-auto p-1 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.article>
    );
  };

  return (
    <main className="flex-1 w-full px-5 md:px-8 lg:px-10 py-6 md:py-8 pb-28 md:pb-10">
      {/* Masthead: what is here, and the two ways to act on it. */}
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="font-serif text-[28px] md:text-[34px] font-bold tracking-tight text-stone-900 dark:text-white leading-none">
            Library
          </h1>
          <p className="mt-1.5 text-[12.5px] text-stone-500 dark:text-stone-400 tabular-nums">
            {stored.length === 0
              ? 'Nothing stored yet'
              : `${stored.length} document${stored.length === 1 ? '' : 's'} · ${totalWords.toLocaleString()} words${
                  totalMarks > 0 ? ` · ${totalMarks.toLocaleString()} marks` : ''
                } · all on this computer`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {stored.length > 0 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a document…"
                aria-label="Filter the library"
                className={`w-48 md:w-64 pl-8.5 pr-3 py-2 rounded-xl border text-[13px] transition-all focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
                  isDark
                    ? 'bg-[#1b201d] border-stone-800 text-stone-100 placeholder-stone-600'
                    : 'bg-white border-stone-200 text-stone-900 placeholder-stone-400'
                }`}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => onNavigate('upload', 'push')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#435c52] hover:bg-[#374c43] text-white text-[13px] font-semibold transition-all active:scale-[0.97] cursor-pointer shadow-xs shrink-0"
          >
            <Upload className="w-4 h-4" />
            Add document
          </button>
        </div>
      </header>

      {/* The document already in hand, across the full width — the one thing more likely to be
          wanted than anything on the shelf below it. */}
      {hasActiveDoc && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          id="active-document-section"
          className={`mb-7 rounded-2xl border p-5 md:p-6 flex flex-wrap items-center gap-5 ${
            isDark ? 'bg-[#1b201d] border-stone-800' : 'bg-[#f0eee9] border-stone-300/60'
          }`}
        >
          <div className="w-12 h-12 rounded-2xl bg-[#435c52] text-white flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-50">
            <span className="text-[10px] font-bold tracking-widest text-emerald-700 dark:text-emerald-400 uppercase">
              Currently open
            </span>
            <h2 className="font-serif text-[20px] md:text-[24px] font-bold tracking-tight text-stone-900 dark:text-white truncate mt-0.5">
              {activeDocument!.title || 'Uploaded document'}
            </h2>
            {themes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {themes.slice(0, 4).map((theme) => (
                  <span
                    key={theme.id}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/70 dark:bg-white/5 text-stone-700 dark:text-stone-300"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: theme.color }} />
                    {theme.title}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              id="continue-annotating-btn"
              type="button"
              onClick={() => onContinueAnnotating?.()}
              disabled={!canAnnotateActive}
              title={canAnnotateActive ? 'Open this document in the annotating workspace' : 'This format has no pages to annotate'}
              className="bg-[#435c52] hover:bg-[#374c43] active:scale-[0.97] disabled:opacity-45 disabled:cursor-default text-white py-2.5 px-5 rounded-xl font-semibold text-[13px] transition-all shadow-xs flex items-center gap-2 cursor-pointer"
            >
              <Pencil className="w-4 h-4" />
              Continue annotating
            </button>
            <button
              id="view-analysis-btn"
              type="button"
              onClick={() => onNavigate('analysis', 'push')}
              className={`py-2.5 px-5 rounded-xl font-semibold text-[13px] transition-all flex items-center gap-2 cursor-pointer active:scale-[0.97] border ${
                isDark ? 'border-stone-700 text-stone-200 hover:bg-stone-800' : 'border-stone-300 text-stone-700 hover:bg-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              View analysis
            </button>
          </div>
        </motion.section>
      )}

      {/* The shelf. Tracks size themselves, so the same page is full on a laptop and on a wide
          display instead of stranding a narrow column in the middle of it. */}
      {isLoadingLibrary && stored.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
          <p className="text-[12px] text-stone-500">Reading your library…</p>
        </div>
      ) : stored.length === 0 ? (
        <button
          type="button"
          onClick={() => onNavigate('upload', 'push')}
          className={`w-full rounded-3xl border-2 border-dashed py-20 px-6 flex flex-col items-center gap-4 text-center transition-all cursor-pointer ${
            isDark
              ? 'border-stone-800 hover:border-stone-700 bg-[#1b201d]/40'
              : 'border-stone-300 hover:border-stone-400 bg-stone-50/60'
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-[#435c52] text-white flex items-center justify-center">
            <Upload className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-serif text-[20px] font-bold text-stone-900 dark:text-white">
              Your shelf is empty
            </h2>
            <p className="text-[13px] text-stone-500 dark:text-stone-400 mt-1.5 max-w-md">
              Add a PDF, an HTML book, a DOCX, an EPUB or plain text. Everything stays on this
              computer, and nothing is sent anywhere unless you ask for an analysis.
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#435c52] dark:text-emerald-300">
            Add your first document
            <ArrowRight className="w-4 h-4" />
          </span>
        </button>
      ) : visible.length === 0 ? (
        <div className="py-20 flex flex-col items-center gap-2 text-center">
          <FileText className="w-6 h-6 text-stone-400" />
          <p className="text-[13px] text-stone-500 dark:text-stone-400">
            Nothing matches “{query}”.
          </p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
          >
            Clear the filter
          </button>
        </div>
      ) : (
        <section
          id="stored-library"
          className="grid gap-4 md:gap-5 items-start"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}
        >
          {visible.map(card)}
        </section>
      )}
    </main>
  );
};
