/**
 * The PDF workspace's dialogs: the comment editor and the insert-page panel (moved verbatim from
 * PdfWorkspace).
 */

import React from 'react';
import { Loader2, X, PanelTop, PanelBottom, FileStack } from '../../icons';
import { Annotation } from '../annotationModel';
import { PageInsertHeight, PageInsertPlacement } from '../../../utils/documentStorage';

export interface WorkspaceDialogsProps {
  currentPage: number;
  deleteAnnotation: (id: string) => void;
  draftText: string;
  editing: Annotation;
  handleInsertPage: () => Promise<void>;
  insertHeight: PageInsertHeight;
  insertPageMenuOpen: boolean;
  insertPlacement: PageInsertPlacement;
  isDark: boolean;
  isInsertingPage: boolean;
  saveEditing: () => void;
  setDraftText: React.Dispatch<React.SetStateAction<string>>;
  setInsertHeight: React.Dispatch<React.SetStateAction<PageInsertHeight>>;
  setInsertPageMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setInsertPlacement: React.Dispatch<React.SetStateAction<PageInsertPlacement>>;
}

export const WorkspaceDialogs: React.FC<WorkspaceDialogsProps> = ({ currentPage, deleteAnnotation, draftText, editing, handleInsertPage, insertHeight, insertPageMenuOpen, insertPlacement, isDark, isInsertingPage, saveEditing, setDraftText, setInsertHeight, setInsertPageMenuOpen, setInsertPlacement }) => (
  <>
      {/* Comment editor. A small modal rather than an inline field: marks sit at arbitrary points,
          often near a page edge, where an inline editor would be clipped. */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={saveEditing}>
          <div
            className={`ink-card w-full max-w-sm rounded-2xl p-4 space-y-3 shadow-2xl ${
              isDark ? 'bg-night-3 border border-stone-800' : 'bg-white border border-stone-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editing.color }} />
              <h3 className="title-hand text-[23px] text-stone-900 dark:text-paper">
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
              className={`w-full p-3 rounded-xl border text-[13px] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-gold ${
                isDark
                  ? 'bg-night-2 border-stone-800 text-stone-100 placeholder-stone-600'
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
                className="px-4 py-2 rounded-full bg-accent caps hover:bg-accent-hover text-on-accent text-[12px] font-semibold cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insert page. Placement is relative to whichever page the reader was on when they opened
          this — "before"/"after" read naturally against that, and "start and end" ignores it
          entirely since it always means the very edges of the document. */}
      {insertPageMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (isInsertingPage) return;
            setInsertPageMenuOpen(false);
          }}
        >
          <div
            className={`ink-card w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl ${
              isDark ? 'bg-night-3 border border-stone-800' : 'bg-white border border-stone-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="title-hand text-[23px] text-stone-900 dark:text-paper">
                Page {currentPage}
              </h3>
              <button
                type="button"
                onClick={() => setInsertPageMenuOpen(false)}
                className="p-1 rounded-lg text-muted hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <span className="caps text-muted">
                Where
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'before' as const, label: 'Before this page', icon: PanelTop },
                    { id: 'after' as const, label: 'After this page', icon: PanelBottom },
                    { id: 'both-ends' as const, label: 'Start & end of document', icon: FileStack }
                  ]
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setInsertPlacement(id)}
                    className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-[11px] font-medium text-center leading-tight cursor-pointer transition-all ${
                      insertPlacement === id
                        ? 'border-gold bg-gold/10 text-gold dark:text-gold'
                        : isDark
                          ? 'border-stone-700 text-stone-400 hover:bg-stone-800'
                          : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="caps text-muted">
                Size
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'full' as const, label: 'Full page' },
                    { id: 'header' as const, label: 'Header strip' },
                    { id: 'notes' as const, label: 'Notes page' }
                  ]
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setInsertHeight(id)}
                    className={`p-2.5 rounded-xl border text-[11px] font-medium text-center leading-tight cursor-pointer transition-all ${
                      insertHeight === id
                        ? 'border-gold bg-gold/10 text-gold dark:text-gold'
                        : isDark
                          ? 'border-stone-700 text-stone-400 hover:bg-stone-800'
                          : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setInsertPageMenuOpen(false)}
                disabled={isInsertingPage}
                className="px-3.5 py-2 text-[12.5px] font-medium text-muted hover:text-stone-800 dark:hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleInsertPage()}
                disabled={isInsertingPage}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent caps hover:bg-accent-hover text-on-accent text-[12.5px] font-semibold cursor-pointer disabled:opacity-60"
              >
                {isInsertingPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Insert
              </button>
            </div>

            <p className="text-[11.5px] text-muted text-center pt-1">
              To delete a page instead, hover its bottom-right corner.
            </p>
          </div>
        </div>
      )}
  </>
);
