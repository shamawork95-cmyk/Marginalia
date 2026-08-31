import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, BookOpen, Sparkles, FileText, ArrowRight, StickyNote as StickyNoteIcon } from 'lucide-react';
import { Screen, TransitionType, StickyNote } from '../types';
import { analysisCacheKey } from '../utils/cacheKeys';

/**
 * `text` is optional and `docId` new: document bodies live on disk now and are fetched by id when
 * a document is opened, so the library holds only metadata until then.
 */
interface LibraryDoc {
  id: string;
  title: string;
  text?: string;
  date: string;
  wordCount: number;
  format?: string;
  docId?: string;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  uploadedLibrary?: LibraryDoc[];
  documentNotes?: Record<string, StickyNote[]>;
  onSelectDocumentForAnalysis?: (title: string, text: string, format?: string, docId?: string) => void;
  /** Reopens a stored document, fetching its text from disk first. */
  onOpenLibraryDocument?: (doc: LibraryDoc) => void;
}

interface ThemeMatch {
  docTitle: string;
  title: string;
  description: string;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
  isDark = false,
  uploadedLibrary = [],
  documentNotes = {},
  onSelectDocumentForAnalysis
}) => {
  const [query, setQuery] = useState('');

  // Start each fresh open with a clean search box rather than whatever was typed last time.
  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

  const q = query.trim().toLowerCase();

  const matchingDocs = useMemo(() => {
    if (!q) return [];
    return uploadedLibrary.filter(
      (doc) => doc.title.toLowerCase().includes(q) || doc.text.toLowerCase().includes(q)
    );
  }, [q, uploadedLibrary]);

  const matchingNotes = useMemo(() => {
    if (!q) return [];
    const results: Array<{ docTitle: string; note: StickyNote }> = [];
    Object.entries(documentNotes).forEach(([docTitle, notes]: [string, StickyNote[]]) => {
      notes.forEach((note) => {
        const haystack = `${note.title} ${note.content} ${note.quote || ''}`.toLowerCase();
        if (haystack.includes(q)) results.push({ docTitle, note });
      });
    });
    return results;
  }, [q, documentNotes]);

  const matchingThemes = useMemo(() => {
    if (!q) return [];
    const results: ThemeMatch[] = [];
    uploadedLibrary.forEach((doc) => {
      try {
        const raw = sessionStorage.getItem(analysisCacheKey(doc.title));
        if (!raw) return;
        const parsed = JSON.parse(raw);
        (parsed.extractedThemes || []).forEach((theme: any) => {
          const haystack = `${theme.title || ''} ${theme.description || ''}`.toLowerCase();
          if (haystack.includes(q)) {
            results.push({ docTitle: doc.title, title: theme.title, description: theme.description });
          }
        });
      } catch {
        // Cache entry missing or malformed — just skip it, not a search failure.
      }
    });
    return results;
  }, [q, uploadedLibrary]);

  const hasResults = matchingDocs.length > 0 || matchingNotes.length > 0 || matchingThemes.length > 0;
  const isSearching = q.length > 0;

  const findDocText = (title: string) => uploadedLibrary.find((d) => d.title === title)?.text || '';
  const findDocFormat = (title: string) => uploadedLibrary.find((d) => d.title === title)?.format;

  const goToAnalysis = (title: string, text: string, format?: string) => {
    onClose();
    if (onSelectDocumentForAnalysis) onSelectDocumentForAnalysis(title, text, format);
    onNavigate('analysis', 'push');
  };

  const goToReader = (title: string, text: string, format?: string) => {
    onClose();
    if (onSelectDocumentForAnalysis) onSelectDocumentForAnalysis(title, text, format);
    onNavigate('reader', 'push');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/60 backdrop-blur-xs">
      <div className={`w-full max-w-md rounded-3xl p-5 shadow-2xl border ${
        isDark ? 'bg-[#1b201d] border-stone-700 text-white' : 'bg-white border-stone-200 text-stone-900'
      }`}>
        <div className="flex items-center gap-3 pb-3 border-b border-stone-200 dark:border-stone-800">
          <Search className="w-5 h-5 text-stone-400" />
          <input
            type="text"
            placeholder="Search themes, docs & notes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-0 bg-transparent text-[14px] focus:outline-none placeholder-stone-400"
            autoFocus
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 max-h-96 overflow-y-auto">
          {isSearching ? (
            hasResults ? (
              <>
                {matchingDocs.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
                      Documents
                    </div>
                    {matchingDocs.map((doc) => (
                      <div
                        key={doc.id}
                        onClick={() => goToAnalysis(doc.title, doc.text, doc.format)}
                        className="flex items-center justify-between p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                          <p className="text-[13px] font-medium truncate">{doc.title}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
                      </div>
                    ))}
                  </div>
                )}

                {matchingThemes.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
                      Themes
                    </div>
                    {matchingThemes.map((match, idx) => (
                      <div
                        key={`${match.docTitle}-${idx}`}
                        onClick={() => goToAnalysis(match.docTitle, findDocText(match.docTitle), findDocFormat(match.docTitle))}
                        className="flex items-center justify-between p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium truncate">{match.title}</p>
                            <p className="text-[11px] text-stone-400 truncate">in {match.docTitle}</p>
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
                      </div>
                    ))}
                  </div>
                )}

                {matchingNotes.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
                      Notes
                    </div>
                    {matchingNotes.map(({ docTitle, note }) => (
                      <div
                        key={note.id}
                        onClick={() => goToReader(docTitle, findDocText(docTitle), findDocFormat(docTitle))}
                        className="flex items-center justify-between p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <StickyNoteIcon className="w-4 h-4 text-amber-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium truncate">{note.title}</p>
                            <p className="text-[11px] text-stone-400 truncate">in {docTitle}</p>
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] text-stone-500 text-center py-6">
                No documents, themes, or notes match &ldquo;{query.trim()}&rdquo;.
              </p>
            )
          ) : (
            <>
              <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
                Quick Navigation
              </div>

              <div
                onClick={() => { onClose(); onNavigate('reader', 'push'); }}
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <BookOpen className="w-4 h-4 text-[#435c52]" />
                  <div>
                    <p className="text-[13px] font-medium">Active Reading Session</p>
                    <p className="text-[11px] text-stone-400">Open active document text</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400" />
              </div>

              <div
                onClick={() => { onClose(); onNavigate('analysis', 'push'); }}
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-purple-500" />
                  <div>
                    <p className="text-[13px] font-medium">Thematic Analysis Screen</p>
                    <p className="text-[11px] text-stone-400">AI Synthesis</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400" />
              </div>

              <div
                onClick={() => { onClose(); onNavigate('upload', 'push'); }}
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <div>
                    <p className="text-[13px] font-medium">Upload & Analyze New Document</p>
                    <p className="text-[11px] text-stone-400">PDF, EPUB, TXT, DOCX</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
