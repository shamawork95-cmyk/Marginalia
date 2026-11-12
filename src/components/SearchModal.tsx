/**
 * Search across the whole library: documents, and every mark inside them.
 *
 * Server-backed, because the browser holds only metadata — document bodies and annotations live
 * on disk. A search done here in the renderer could only ever cover whatever happened to be open,
 * which is exactly what the old version did.
 *
 * A mark is a better answer than a word, so marks come first. Opening one takes the reader to
 * that passage rather than to page one of the book it is in.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, FileText, Tag, Sparkles, Loader2 } from './icons';
import { AnnotationFocus, Screen, TransitionType } from '../types';
import {
  searchLibrary,
  listStoredDocuments,
  type SearchHit,
  type StoredDocumentMeta
} from '../utils/documentStorage';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  /** Opens a stored document, optionally stepping straight to a kind of mark inside it. */
  onOpenStoredDocument?: (meta: StoredDocumentMeta, focus?: AnnotationFocus) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  isDark = false,
  onOpenStoredDocument
}) => {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [library, setLibrary] = useState<StoredDocumentMeta[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setHits([]);
    void listStoredDocuments().then(setLibrary);
    // The field is the whole point of the dialog; nobody opens it to look at it.
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Debounced: the search reads every document on disk, so it should not run per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const found = await searchLibrary(q);
      if (cancelled) return;
      setHits(found);
      setSearching(false);
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const grouped = useMemo(
    () => ({
      marks: hits.filter((h) => h.kind === 'mark').slice(0, 40),
      documents: hits.filter((h) => h.kind === 'document').slice(0, 20)
    }),
    [hits]
  );

  const open = (hit: SearchHit) => {
    const meta = library.find((d) => d.id === hit.id);
    if (!meta) return;
    onClose();
    // A mark hit opens the book already stepping through marks of its kind, so the passage that
    // matched is the first thing on screen.
    const focus: AnnotationFocus | undefined =
      hit.kind !== 'mark'
        ? undefined
        : hit.isTerminology
          ? { kind: 'terminology', label: 'Terminology', color: hit.themeColor ?? '#8a8578' }
          : hit.themeId
            ? {
                kind: 'theme',
                themeId: hit.themeId,
                label: hit.themeName ?? 'Theme',
                color: hit.themeColor ?? '#435c52'
              }
            : undefined;
    onOpenStoredDocument?.(meta, focus);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search My Collections"
        onClick={(e) => e.stopPropagation()}
        className={`ink-card w-full max-w-xl rounded-3xl shadow-2xl border overflow-hidden ${
          isDark ? 'bg-night-3 border-stone-700 text-paper' : 'bg-white border-stone-200 text-stone-900'
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-stone-200 dark:border-stone-800">
          <Search className="w-5 h-5 text-stone-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search marks, themes, terminology and text…"
            className="flex-1 bg-transparent outline-none rounded-md focus-visible:ring-1 focus-visible:ring-gold/60 text-[14px] placeholder:text-muted"
          />
          {searching && <Loader2 className="w-4 h-4 animate-spin text-stone-400 shrink-0" />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="p-1 rounded-lg text-muted hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-3 py-3 space-y-4">
          {query.trim().length < 2 ? (
            <p className="px-2 py-6 text-center text-[12.5px] text-muted leading-relaxed">
              Type to search everything on this computer — the words you highlighted, your notes,
              a theme's name, terminology, and the full text of every book.
            </p>
          ) : !searching && hits.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12.5px] text-muted">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <>
              {grouped.marks.length > 0 && (
                <section className="space-y-1">
                  <h3 className="caps px-2 text-muted">
                    Marks · {grouped.marks.length}
                  </h3>
                  {grouped.marks.map((hit) => (
                    <button
                      key={`${hit.id}-${hit.annotationId}`}
                      type="button"
                      onClick={() => open(hit)}
                      className="w-full flex items-start gap-2.5 px-2 py-2 rounded-xl text-left hover:bg-stone-500/[0.07] cursor-pointer transition-colors"
                    >
                      <span
                        aria-hidden
                        className="mt-1 w-2 h-2 rounded-[2px] shrink-0"
                        style={{ backgroundColor: hit.themeColor ?? '#8a8578' }}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[12.5px] text-stone-800 dark:text-stone-200 line-clamp-2">
                          {hit.snippet}
                        </span>
                        <span className="block text-[11px] text-muted truncate">
                          {hit.title}
                          {hit.page ? ` · page ${hit.page}` : ''}
                          {hit.isTerminology ? ' · Terminology' : hit.themeName ? ` · ${hit.themeName}` : ''}
                        </span>
                      </span>
                      {hit.isTerminology ? (
                        <Tag className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
                      )}
                    </button>
                  ))}
                </section>
              )}

              {grouped.documents.length > 0 && (
                <section className="space-y-1">
                  <h3 className="caps px-2 text-muted">
                    In the text · {grouped.documents.length}
                  </h3>
                  {grouped.documents.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => open(hit)}
                      className="w-full flex items-start gap-2.5 px-2 py-2 rounded-xl text-left hover:bg-stone-500/[0.07] cursor-pointer transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-1" />
                      <span className="flex-1 min-w-0">
                        <span className="block font-serif text-[13px] text-stone-800 dark:text-stone-200 truncate">
                          {hit.title}
                        </span>
                        <span className="block text-[11.5px] text-muted line-clamp-2">{hit.snippet}</span>
                      </span>
                      <span className="text-[11px] text-muted tabular-nums shrink-0 mt-1">
                        {hit.matches}
                      </span>
                    </button>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
