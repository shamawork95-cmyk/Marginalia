/**
 * Asked when a PDF with blacked-out words is exported: a black box only hides words from the eye,
 * so this says plainly that they are still in the file, and offers to remove them for real
 * (export/redaction.ts), with what that costs.
 */

import React, { useRef } from 'react';
import { EyeOff } from '../../icons';
import { useDialogFocus } from '../../../hooks/useDialogFocus';
import { plural } from '../../../utils/plural';

export const BlackoutExportDialog: React.FC<{
  open: boolean;
  pages: number;
  isDark: boolean;
  onRedact: () => void;
  onKeep: () => void;
  onCancel: () => void;
}> = ({ open, pages, isDark, onRedact, onKeep, onCancel }) => {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, open, onCancel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="blackout-export-title"
        aria-describedby="blackout-export-body"
        onClick={(e) => e.stopPropagation()}
        className={`ink-card w-[min(30rem,100%)] rounded-2xl border p-5 shadow-2xl ${isDark ? 'bg-night-3 border-stone-700 text-paper' : 'bg-white border-stone-200 text-stone-900'}`}
      >
        <div className="flex items-start gap-3">
          <EyeOff className="w-5 h-5 text-gold shrink-0 mt-1.5" />
          <div className="space-y-2">
            <h2 id="blackout-export-title" className="title-hand text-[24px] leading-tight">
              Some words are blacked out
            </h2>
            <div id="blackout-export-body" className="space-y-2 text-[13.5px] leading-relaxed">
              <p>
                The black boxes on {plural(pages, 'page')} hide words from view, but{' '}
                <strong>the words are still in the PDF underneath</strong>: anyone with the file can copy them, search for them or have them
                read aloud.
              </p>
              <p className="text-muted">
                Removing them makes {pages === 1 ? 'that page a picture' : 'those pages pictures'} of themselves with the black-outs painted
                in, so nothing under them survives. The other words on {pages === 1 ? 'that page' : 'those pages'} can then no longer be selected
                or searched. Every other page stays as it is.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="mr-auto text-[12px] text-muted hover:underline cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            onClick={onKeep}
            className={`px-4 py-2 rounded-full caps text-[12px] border cursor-pointer ${isDark ? 'border-stone-700 hover:bg-nav-hover' : 'border-stone-300 hover:bg-stone-100'}`}
          >
            Keep the text underneath
          </button>
          <button
            type="button"
            autoFocus
            onClick={onRedact}
            className="px-4 py-2 rounded-full caps text-[12px] bg-accent hover:bg-accent-hover text-on-accent cursor-pointer"
          >
            Remove the hidden text too
          </button>
        </div>
      </div>
    </div>
  );
};
