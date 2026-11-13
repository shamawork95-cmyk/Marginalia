/**
 * The PDF toolbar's two menus: More (the view controls the row has no room for) and Export (the
 * annotated PDF and the marks archive) (moved verbatim from PdfToolbar).
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, Loader2, MoreHorizontal } from '../../icons';
import { useDismiss } from '../useDismiss';
import { ArchivePanel, type ArchiveRow } from '../../MarksArchive';
import { HoverTooltip } from '../../HoverTooltip';

/**
 * "More": the view controls the row has no room for, in a fixed panel measured from its button
 * (portalled for the same reason as Export: the row clips even fixed children).
 */
export const MoreMenu: React.FC<{ isDark: boolean; children: React.ReactNode }> = ({ isDark, children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useDismiss(ref, open, () => setOpen(false), '[data-more-menu]');
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const measure = () => {
      const a = ref.current?.getBoundingClientRect();
      const m = menuRef.current?.getBoundingClientRect();
      if (!a || !m) return;
      setPos({ left: Math.max(8, Math.min(a.right - m.width, window.innerWidth - m.width - 8)), top: a.bottom + 6 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <HoverTooltip label="Pages, zoom and view">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="More: pages, zoom and view"
          className={`p-2 rounded-lg cursor-pointer ${open ? 'bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-100' : 'text-muted hover:bg-stone-100 dark:hover:bg-stone-800'}`}
        >
          <MoreHorizontal className="w-4 h-4" weight="bold" />
        </button>
      </HoverTooltip>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            data-more-menu
            role="group"
            aria-label="Pages, zoom and view"
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            className={`fixed z-50 flex flex-wrap items-center gap-1 p-2 rounded-2xl shadow-2xl border max-w-[calc(100vw-16px)] ${
              isDark ? 'bg-night-3 border-stone-700' : 'bg-white border-stone-200'
            }`}
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  );
};

/**
 * Export: the annotated PDF first, then the marks archive. A fixed panel measured from its
 * button (the toolbar row scrolls sideways on a phone and would clip an absolute one).
 */
export const ExportMenu: React.FC<{ onExport: () => void; isExporting: boolean; rows?: ArchiveRow[]; isDark: boolean }> = ({
  onExport,
  isExporting,
  rows,
  isDark
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Portalled: the tools row is masked for its edge fade, and a mask clips even fixed children.
  useDismiss(ref, open, () => setOpen(false), '[data-export-menu]');
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const measure = () => {
      const a = ref.current?.getBoundingClientRect();
      const m = menuRef.current?.getBoundingClientRect();
      if (!a || !m) return;
      const left = Math.max(8, Math.min(a.right - m.width, window.innerWidth - m.width - 8));
      setPos({ left, top: Math.min(a.bottom + 6, Math.max(8, window.innerHeight - m.height - 8)) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  if (!rows) {
    return (
      <HoverTooltip label="Export a PDF with your marks embedded as real PDF annotations">
        <button type="button" onClick={onExport} disabled={isExporting} className={EXPORT_BTN}>
          {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span className="hidden xl:inline">Export PDF</span>
        </button>
      </HoverTooltip>
    );
  }
  return (
    <div ref={ref} className="relative">
      <HoverTooltip label="Export the annotated PDF, your marks or a commonplace book">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Export"
          className={EXPORT_BTN}
        >
          {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span className="hidden xl:inline">Export</span>
          <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
      </HoverTooltip>
      {open && createPortal(
        <div
          ref={menuRef}
          data-export-menu
          role="group"
          aria-label="Export options"
          className={`fixed z-50 w-[min(26rem,calc(100vw-16px))] max-h-[calc(100vh-16px)] overflow-y-auto rounded-2xl shadow-2xl border ${
            isDark ? 'bg-night-3 border-stone-700' : 'bg-white border-stone-200'
          }`}
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        >
          <div className="px-3 py-2.5 flex items-center justify-between gap-3 border-b border-stone-200 dark:border-stone-700/70">
            <div className="min-w-0">
              <div className="font-bold text-[13px] text-stone-900 dark:text-paper">Annotated PDF</div>
              <div className="text-[11.5px] text-muted leading-snug">Your marks embedded as real PDF annotations.</div>
            </div>
            <button
              type="button"
              disabled={isExporting}
              onClick={() => {
                onExport();
                setOpen(false);
              }}
              className="shrink-0 rounded-full caps caps-sm px-3 py-1.5 bg-accent text-on-accent hover:bg-accent-hover cursor-pointer disabled:opacity-50"
            >
              Save PDF
            </button>
          </div>
          <ArchivePanel rows={rows} compact onAction={() => setOpen(false)} />
        </div>,
        // Inside the app container, so the `.dark` theme and its tokens still apply.
        document.getElementById('app-container') ?? document.body
      )}
    </div>
  );
};

export const EXPORT_BTN =
  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50';
