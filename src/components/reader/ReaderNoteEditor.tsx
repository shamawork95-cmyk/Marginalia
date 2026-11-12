/**
 * The reader's note and comment editor: a small modal with a title, a quoted excerpt and the words.
 * Escape or Cancel discards; a note still being written is never made (moved verbatim from ReaderScreen).
 */

import React from 'react';
import { ParagraphRange } from '../../utils/textFormatting';
import { type TextMark } from '../../utils/textMarks';
import type { Annotation } from '../pdf/annotationModel';

export interface ReaderNoteEditorProps {
  closeEditor: () => void;
  deleteMark: (id: string) => void;
  draftQuote: string;
  draftText: string;
  draftTitle: string;
  editing: TextMark;
  editorColor: string;
  editorIsNote: boolean;
  editorOpen: boolean;
  editorPara: number;
  editorRef: React.RefObject<HTMLDivElement>;
  isDark: boolean;
  newNote: { ranges: ParagraphRange[]; quote: string; themeId: string | null; color: string; paragraphOnly?: true; };
  saveEditing: () => void;
  setDraftQuote: React.Dispatch<React.SetStateAction<string>>;
  setDraftText: React.Dispatch<React.SetStateAction<string>>;
  setDraftTitle: React.Dispatch<React.SetStateAction<string>>;
  viewById: Map<string, Annotation>;
}

export const ReaderNoteEditor: React.FC<ReaderNoteEditorProps> = ({ closeEditor, deleteMark, draftQuote, draftText, draftTitle, editing, editorColor, editorIsNote, editorOpen, editorPara, editorRef, isDark, newNote, saveEditing, setDraftQuote, setDraftText, setDraftTitle, viewById }) => (
  <>
      {/* Comment / note editor — the PDF workspace's, with a title for notes. Escape or Cancel
          discards the edit (a note still being written is never made). The backdrop does
          nothing when clicked: a stray click must neither save nor throw away words. */}
      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          // A press on the backdrop keeps focus where it was, inside the dialog.
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) e.preventDefault();
          }}
        >
          <div
            ref={editorRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reader-editor-title"
            className={`ink-card w-full max-w-sm rounded-2xl p-4 space-y-3 shadow-2xl ${
              isDark ? 'bg-night-3 border border-stone-800' : 'bg-white border border-stone-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editorColor }} />
              <h3 id="reader-editor-title" className="title-hand text-[23px] text-stone-900 dark:text-paper">
                {editorIsNote ? (newNote ? 'New note' : 'Note') : 'Comment'} · paragraph {editorPara + 1}
              </h3>
            </div>
            {editing && !editorIsNote && editing.quote && (
              <p
                className="text-[12px] italic text-stone-600 dark:text-stone-400 border-l-2 pl-2.5 line-clamp-3"
                style={{ borderLeftColor: editorColor }}
              >
                &ldquo;{viewById.get(editing.id)?.quote ?? editing.quote}&rdquo;
              </p>
            )}
            {editorIsNote && (
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Title (optional)"
                aria-label="Note title"
                className={`w-full px-3 py-2 rounded-xl border text-[13px] focus:outline-none focus:ring-1 focus:ring-gold ${
                  isDark ? 'bg-night-2 border-stone-800 text-stone-100 placeholder:text-paper/50' : 'bg-white border-stone-300 text-stone-900 placeholder:text-muted'
                }`}
              />
            )}
            {editorIsNote && (
              <textarea
                rows={2}
                value={draftQuote}
                onChange={(e) => setDraftQuote(e.target.value)}
                placeholder="Quoted excerpt (optional)"
                aria-label="Quoted excerpt"
                className={`w-full px-3 py-2 rounded-xl border border-l-[3px] text-[12.5px] italic leading-snug resize-none focus:outline-none focus:ring-1 focus:ring-gold ${
                  isDark ? 'bg-night-2 border-stone-800 text-stone-200 placeholder:text-paper/50' : 'bg-white border-stone-300 text-stone-700 placeholder:text-muted'
                }`}
                style={{ borderLeftColor: editorColor }}
              />
            )}
            <textarea
              autoFocus
              rows={4}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              aria-label={editorIsNote ? 'Note' : 'Comment'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEditing();
                }
              }}
              placeholder="Write your note… (Enter to save, Shift+Enter for a new line)"
              className={`w-full p-3 rounded-xl border text-[13px] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-gold ${
                isDark ? 'bg-night-2 border-stone-800 text-stone-100 placeholder:text-paper/50' : 'bg-white border-stone-300 text-stone-900 placeholder:text-muted'
              }`}
            />
            <div className="flex items-center gap-2">
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    deleteMark(editing.id);
                    closeEditor();
                  }}
                  className="text-[12px] font-semibold text-red-700 dark:text-red-400 hover:underline cursor-pointer"
                >
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={closeEditor}
                className={`px-4 py-2 rounded-full caps text-[12px] border cursor-pointer transition-colors ${
                  isDark ? 'border-stone-700 text-stone-200 hover:bg-nav-hover' : 'border-stone-300 text-stone-700 hover:bg-stone-100'
                }`}
              >
                Cancel
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
  </>
);
