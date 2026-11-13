/**
 * The note card on the desk beside an open book: its title (renamable), its marks and themes, its
 * words and progress, and Read, Rename, Delete (moved verbatim from Bookshelf).
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { type StoredDocumentMeta } from '../../utils/documentStorage';
import { plural } from '../../utils/plural';
import { formatBytes, progressLabel, Doodle } from './shelfLook';

export const DeskCard: React.FC<{
  doc: StoredDocumentMeta;
  themes: { id: string; name: string; color: string }[];
  busy: boolean;
  renaming: boolean;
  draft: string;
  confirmingDelete: boolean;
  canStep: boolean;
  readRef: React.Ref<HTMLButtonElement>;
  onOpen: () => void;
  onStartRename: () => void;
  onDraft: (v: string) => void;
  onCommitRename: () => Promise<void>;
  onCancelRename: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => Promise<void>;
  onPrev: () => void;
  onNext: () => void;
  onShelve: () => void;
}> = (p) => {
  const { doc } = p;
  const docThemes = p.themes.filter((t) => doc.themeIds?.includes(t.id));
  const added = new Date(doc.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const chipLabels = docThemes.map((t) => t.name).join('\n');

  // The chip slot is two rows tall and never grows: chips that fall below it are hidden and a "+N"
  // chip takes the last place that still fits. Set imperatively (the `hidden` attribute is not a
  // React prop here) so a resize re-fits without a render loop.
  const chipsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = chipsRef.current;
    if (!box) return;
    const fit = () => {
      const chips = Array.from(box.querySelectorAll<HTMLElement>('[data-chip]'));
      const more = box.querySelector<HTMLElement>('[data-more]')!;
      const fits = (el: HTMLElement) => el.offsetTop + el.offsetHeight <= box.clientHeight;
      chips.forEach((c) => (c.hidden = false));
      more.hidden = true;
      if (!chips.length || fits(chips[chips.length - 1])) return;
      more.hidden = false;
      for (let k = chips.length - 1; k >= 0; k--) {
        chips[k].hidden = true;
        more.textContent = `+${chips.length - k}`;
        if (fits(more)) return;
      }
    };
    fit();
    // Chip widths change once the handwriting font arrives.
    let live = true;
    void document.fonts.ready.then(() => live && fit());
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [doc.id, chipLabels]);

  // The row being swapped out turns invisible, which would drop focus to <body> (and Escape on the
  // card with it): hand focus to "Keep it" when the question opens, and back to "Delete" when it closes.
  const askDeleteRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(p.confirmingDelete);
  useEffect(() => {
    if (wasConfirming.current === p.confirmingDelete) return;
    wasConfirming.current = p.confirmingDelete;
    (p.confirmingDelete ? keepRef : askDeleteRef).current?.focus({ preventScroll: true });
  }, [p.confirmingDelete]);

  const summary =
    doc.annotationCount > 0
      ? `${plural(doc.annotationCount, 'mark')}${
          docThemes.length ? ` filed under ${plural(docThemes.length, 'theme')}` : ''
        }${doc.terminologyCount > 0 ? `, ${plural(doc.terminologyCount, 'term')} defined` : ''}.`
      : 'No marks yet. Open it to start annotating.';

  return (
    <div
      className="shelf-note"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || p.renaming) return;
        // Escape backs out of the delete question first; only then does it shelve the book.
        if (p.confirmingDelete) p.onCancelDelete();
        else p.onShelve();
      }}
    >
      <p className="shelf-label shelf-underline truncate">
        {doc.format} · added {added}
      </p>

      {/* Fixed slot: the title clamps to two lines and the rename field sits in the same space. */}
      <div className="shelf-note-title mt-5">
        {p.renaming ? (
          <div className="flex items-center gap-2 h-full">
            <input
              autoFocus
              maxLength={300}
              value={p.draft}
              onChange={(e) => p.onDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void p.onCommitRename();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  p.onCancelRename();
                }
              }}
              aria-label="New title"
              className="flex-1 min-w-0 bg-transparent border-b-2 border-[var(--shelf-ink)]/50 focus:border-[var(--shelf-ink)] outline-none font-handwriting text-[34px] leading-tight py-1"
            />
            <button type="button" className="shelf-pill" disabled={p.busy} onClick={() => void p.onCommitRename()}>
              {p.busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="shelf-pill" onClick={p.onCancelRename}>
              Cancel
            </button>
          </div>
        ) : (
          <h3 className="shelf-clamp font-handwriting" title={doc.title}>
            {doc.title}
          </h3>
        )}
      </div>

      <p className="shelf-label font-spine shelf-note-words mt-3 truncate">
        {plural(doc.wordCount, 'word')}{doc.originalBytes > 0 ? ` · ${formatBytes(doc.originalBytes)}` : ''}
        {progressLabel(doc) && <span className="shelf-progress"> · {progressLabel(doc)}</span>}
      </p>

      <p className="shelf-note-summary shelf-clamp font-serif text-[var(--shelf-ink)]/90 mt-4">{summary}</p>

      <div ref={chipsRef} className="shelf-chips mt-4">
        {docThemes.map((t) => (
          <span key={t.id} data-chip className="shelf-chip" title={t.name}>
            <span className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="truncate">{t.name}</span>
          </span>
        ))}
        <span data-more hidden className="shelf-chip" />
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button ref={p.readRef} type="button" className="shelf-primary" onClick={p.onOpen}>
          Read <span aria-hidden="true">→</span>
        </button>
        <Doodle viewBox="0 0 40 20" d="M38 3C28 3 18 7 9 15M8 8.5c0 2.5.2 4.6.6 7 2.4-.2 4.6-.3 7-.2" className="w-10 h-5 opacity-80" />
      </div>

      {/* Hidden, not removed, while renaming, so the card keeps its height. */}
      <button type="button" className={`shelf-link mt-4 ${p.renaming ? 'invisible' : ''}`} onClick={p.onStartRename}>
        Rename
      </button>

      {/* Both rows share one grid cell; the cell is as tall as the taller row, so the delete question
          never resizes the card. The inactive row is invisible (and so unfocusable). */}
      <div className="grid mt-6">
        <div className={`shelf-actions ${p.confirmingDelete ? '' : 'invisible'}`}>
          <span className="shelf-label self-center text-[var(--shelf-danger)]">Delete permanently?</span>
          <button type="button" className="shelf-pill shelf-pill-danger" disabled={p.busy} onClick={() => void p.onDelete()}>
            {p.busy ? 'Deleting…' : 'Delete'}
          </button>
          <button ref={keepRef} type="button" className="shelf-pill" onClick={p.onCancelDelete}>
            Keep it
          </button>
        </div>
        <div className={`shelf-actions ${p.confirmingDelete ? 'invisible' : ''}`}>
          <button type="button" className="shelf-pill" data-step="prev" disabled={!p.canStep} onClick={p.onPrev}>
            ← Previous
          </button>
          <button type="button" className="shelf-pill" data-step="next" disabled={!p.canStep} onClick={p.onNext}>
            Next →
          </button>
          <button ref={askDeleteRef} type="button" className="shelf-pill" onClick={p.onAskDelete}>
            Delete
          </button>
          <button type="button" className="shelf-pill" onClick={p.onShelve}>
            Shelve it
          </button>
        </div>
      </div>
    </div>
  );
};
