/**
 * The properties strip for the mark that is currently selected.
 *
 * Draw a shape and it stays selected with its own controls floating beside it, so its colour,
 * thickness and dash pattern can be changed after the fact rather than only before. It works on
 * marks made in an earlier session too — click one, and the same strip appears.
 *
 * Every control here is the same component the main toolbar uses (see `StyleControls`), so a mark
 * can be restyled in exactly the vocabulary it was drawn in.
 *
 * Rendered in the shared `AnchoredPopover`: above the mark by default, below it near the top edge,
 * clamped to the window and wrapped onto more rows on a narrow one. It closes the moment the reader
 * presses anywhere else, or Escape, because a strip that outlives the selection it describes is
 * worse than no strip. Delete or Backspace removes the mark (handled by the workspace).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Trash2, Pencil, Quote, Check, Link2, Unlink, ArrowRight } from '../icons';
import {
  Annotation,
  BracketSide,
  NoteStyle,
  StrokeStyle,
  TextAlign,
  TextFont,
  isReaction,
  isStroked,
  isTextAnchored
} from './annotationModel';
import { UserSettings } from '../../types';
import {
  AlignPicker,
  BracketSidePicker,
  EmphasisPicker,
  FontPicker,
  ColorPalette,
  Divider,
  NoteStylePicker,
  StrokeStylePicker,
  TextSizePicker,
  WeightPicker
} from './StyleControls';
import { AnchoredPopover, PanelContext } from './AnchoredPopover';
import { withShortcut } from './workspaceKeys';

/** How the Delete key is named on this platform, for the delete button's tooltip. */
const DELETE_KEY =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? '⌫'
    : 'Delete';

interface MarkPropertiesProps {
  mark: Annotation;
  /** Viewport rectangle of the mark, used to place the strip. */
  rect: { left: number; top: number; right: number; bottom: number };
  /** Pixels at the foot of the window this strip must stay clear of — the instance navigator. */
  bottomInset?: number;
  /** Pixels at the top of the window this strip must stay clear of — the toolbar. */
  topInset?: number;
  /** Glyphs to keep clear and free places to use (the reader's; see `placePanel`). */
  placementContext?: () => PanelContext;
  settings: UserSettings;
  isDark?: boolean;
  onColorChange: (color: string, themeId: string | null) => void;
  onWeightChange: (weight: number) => void;
  onStrokeStyleChange: (style: StrokeStyle) => void;
  onNoteStyleChange: (style: NoteStyle) => void;
  onBracketSideChange: (side: BracketSide) => void;
  onTextSizeChange: (size: number) => void;
  onTextAlignChange: (align: TextAlign) => void;
  onTextFontChange: (font: TextFont) => void;
  onTextBoldChange: (bold: boolean) => void;
  onTextItalicChange: (italic: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Clears the selection, which is what takes this strip off the screen. */
  onDismiss: () => void;
  /** Copies `"quote" (Title, p. N)`; absent for marks without words. Resolves false on failure. */
  onCopyQuote?: () => Promise<boolean>;
  /** Linked marks ("see also"): absent where links are not offered. */
  links?: MarkLinks;
}

/** One mark as the link menu lists it. */
export interface LinkOption {
  id: string;
  /** The marked words (or the note) shortened. */
  label: string;
  /** Where it is: "p. 4", "para. 12". */
  where: string;
}

export interface MarkLinks {
  linked: LinkOption[];
  /** Every other mark it could be linked to, in reading order. */
  candidates: LinkOption[];
  onLink: (id: string) => void;
  onUnlink: (id: string) => void;
  onJump: (id: string) => void;
}

export const MarkProperties: React.FC<MarkPropertiesProps> = ({
  mark,
  rect,
  bottomInset = 0,
  topInset = 0,
  placementContext,
  settings,
  isDark = false,
  onColorChange,
  onWeightChange,
  onStrokeStyleChange,
  onNoteStyleChange,
  onBracketSideChange,
  onTextSizeChange,
  onTextAlignChange,
  onTextFontChange,
  onTextBoldChange,
  onTextItalicChange,
  onEdit,
  onDelete,
  onDismiss,
  onCopyQuote,
  links
}) => {
  const [copied, setCopied] = useState<null | boolean>(null);
  useEffect(() => {
    if (copied === null) return;
    const t = window.setTimeout(() => setCopied(null), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  // Highlights fill rather than stroke, so they have no thickness or dash pattern to set.
  const showsStroke = isStroked(mark.kind);
  const showsText = mark.kind === 'note' || mark.kind === 'text' || isTextAnchored(mark.kind);
  // A reaction is just a glyph — no font, alignment or emphasis to set, only how big it reads.
  const showsSize = mark.kind === 'text' || isReaction(mark.kind);

  // The strip is always "open" while a mark is selected, so dismissal here means deselecting.
  // Presses on the mark's own handles out on the page count as inside, or grabbing a handle would
  // deselect the mark at the very moment the reader took hold of it. The kind decides which
  // controls show, so it is what re-places the strip.
  return (
    <AnchoredPopover
      anchor={rect}
      label={`${mark.isTerminology ? 'Terminology' : mark.kind} mark properties`}
      isDark={isDark}
      onDismiss={onDismiss}
      ignoreSelector="[data-mark-ui]"
      topInset={topInset}
      bottomInset={bottomInset}
      measureKey={mark.kind}
      // Off the reader's note cards when the other side of the mark is free.
      avoidSelector="[data-note-card]"
      placementContext={placementContext}
      className="flex-nowrap gap-1 p-1.5"
    >
      {/* One row at every width: on a phone the style controls scroll sideways (edges fade)
          rather than stacking a second row over the text being styled. Comment and delete stay
          pinned at the end, always in reach. */}
      <div className="hide-scrollbar flex flex-nowrap items-center gap-1 min-w-0 flex-1 overflow-x-auto">
      {/* The kind is in the toolbar's name; on a phone its label gives way to the controls. */}
      <span className="caps caps-sm text-muted dark:text-paper/70 px-1 capitalize max-sm:hidden">
        {mark.isTerminology ? 'Terminology' : mark.kind}
      </span>

      <Divider isDark={isDark} className="max-sm:hidden" />

      {mark.isTerminology ? (
        // Its colour is the live Settings → Terminology setting, not a per-mark choice — offering
        // a palette here would change `mark.color` for nothing, since rendering and export both
        // ignore it in favour of that setting.
        <span className="text-[10.5px] text-muted px-1 italic whitespace-nowrap">
          Colour set in Settings → Terminology
        </span>
      ) : (
        <ColorPalette
          color={mark.color}
          themes={settings.activeThemes}
          themeIds={mark.themeIds ?? []}
          customColors={settings.customColors}
          onChange={onColorChange}
        />
      )}

      {showsStroke && (
        <>
          <Divider isDark={isDark} />
          <WeightPicker weight={mark.weight} color={mark.color} onChange={onWeightChange} swatchScale={620} />
          <Divider isDark={isDark} />
          <StrokeStylePicker value={mark.strokeStyle} color={mark.color} onChange={onStrokeStyleChange} />
        </>
      )}

      {mark.kind === 'note' && (
        <>
          <Divider isDark={isDark} />
          <NoteStylePicker value={mark.noteStyle} color={mark.color} onChange={onNoteStyleChange} />
        </>
      )}

      {mark.kind === 'bracket' && (
        <>
          <Divider isDark={isDark} />
          <BracketSidePicker value={mark.bracketSide} onChange={onBracketSideChange} />
        </>
      )}

      {mark.kind === 'text' && (
        <>
          <Divider isDark={isDark} />
          <FontPicker value={mark.font} onChange={onTextFontChange} />
          <Divider isDark={isDark} />
          <EmphasisPicker
            bold={mark.bold}
            italic={mark.italic}
            onBoldChange={onTextBoldChange}
            onItalicChange={onTextItalicChange}
          />
        </>
      )}

      {showsSize && (
        <>
          <Divider isDark={isDark} />
          <TextSizePicker value={mark.fontSize} color={mark.color} onChange={onTextSizeChange} />
        </>
      )}

      {mark.kind === 'text' && (
        <>
          <Divider isDark={isDark} />
          <AlignPicker value={mark.align} color={mark.color} onChange={onTextAlignChange} />
        </>
      )}

      </div>

      <Divider isDark={isDark} />

      {onCopyQuote && (
        <button
          type="button"
          onClick={() => void onCopyQuote().then(setCopied)}
          title={copied ? 'Copied with its reference' : copied === false ? 'Could not reach the clipboard' : 'Copy quote with its reference'}
          aria-label="Copy quote with its reference"
          className={ICON_BTN}
        >
          {copied ? <Check className="w-3.5 h-3.5 text-gold" weight="bold" /> : <Quote className="w-3.5 h-3.5" />}
        </button>
      )}
      {copied && (
        <span role="status" className="sr-only">
          Quote copied
        </span>
      )}
      {links && <LinkMenu links={links} isDark={isDark} />}
      {showsText && (
        <button
          type="button"
          onClick={onEdit}
          title="Write a comment on this mark"
          aria-label="Write a comment on this mark"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted dark:text-paper/70 hover:text-stone-800 dark:hover:text-paper hover:bg-stone-100 dark:hover:bg-nav-hover cursor-pointer"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        title={withShortcut('Delete this mark', DELETE_KEY)}
        aria-label="Delete this mark"
        aria-keyshortcuts="Delete Backspace"
        className="w-7 h-7 flex items-center justify-center rounded-lg text-muted dark:text-paper/70 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </AnchoredPopover>
  );
};

const ICON_BTN =
  'relative w-7 h-7 flex items-center justify-center rounded-lg text-muted dark:text-paper/70 hover:text-stone-800 dark:hover:text-paper hover:bg-stone-100 dark:hover:bg-nav-hover cursor-pointer';

/**
 * "Link to…": the marks this one is linked to (jump, unlink), then a filterable list of the
 * others to link it to. Opens under the strip (above it when the strip sits low).
 */
const LinkMenu: React.FC<{ links: MarkLinks; isDark: boolean }> = ({ links, isDark }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setUp((ref.current?.getBoundingClientRect().top ?? 0) > window.innerHeight * 0.55);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Closes the menu only; the strip stays.
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  const q = query.trim().toLowerCase();
  const linkedIds = new Set(links.linked.map((l) => l.id));
  const shown = links.candidates.filter((c) => !linkedIds.has(c.id) && (!q || c.label.toLowerCase().includes(q) || c.where.toLowerCase().includes(q)));
  const row = 'w-full flex items-baseline gap-2 px-2.5 py-1.5 rounded-lg text-left text-[12px] cursor-pointer hover:bg-stone-100 dark:hover:bg-nav-hover';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={links.linked.length ? `Linked marks (${links.linked.length})` : 'Link to another mark'}
        aria-label={links.linked.length ? `Linked marks (${links.linked.length})` : 'Link to another mark'}
        className={ICON_BTN}
      >
        <Link2 className="w-3.5 h-3.5" />
        {links.linked.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-gold text-[9px] font-bold leading-[14px] text-white dark:text-night-1 text-center">
            {links.linked.length}
          </span>
        )}
      </button>
      {open && (
        <div
          role="group"
          aria-label="Linked marks"
          className={`absolute right-0 z-10 w-[min(20rem,calc(100vw-24px))] rounded-xl shadow-2xl border p-1.5 ${up ? 'bottom-full mb-2' : 'top-full mt-2'} ${
            isDark ? 'bg-night-3 border-stone-700 text-paper' : 'bg-white border-stone-200 text-stone-800'
          }`}
        >
          {links.linked.length > 0 && (
            <>
              <div className="caps caps-sm text-muted px-2.5 pt-1 pb-0.5">Linked</div>
              <ul className="mb-1">
                {links.linked.map((l) => (
                  <li key={l.id} className="flex items-center gap-1">
                    <button type="button" onClick={() => links.onJump(l.id)} className={`${row} flex-1 min-w-0`} title="Go to this mark">
                      <ArrowRight className="w-3 h-3 shrink-0 text-gold self-center" />
                      <span className="truncate flex-1">{l.label}</span>
                      <span className="shrink-0 text-[11px] text-muted">{l.where}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => links.onUnlink(l.id)}
                      aria-label={`Unlink ${l.label}`}
                      title="Unlink"
                      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="caps caps-sm text-muted px-2.5 pt-1 pb-1">Link to…</div>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a mark"
            aria-label="Find a mark to link"
            className={`w-full mb-1 px-2.5 py-1.5 rounded-lg text-[12px] border outline-none focus:border-gold ${
              isDark ? 'bg-night-2 border-stone-700 placeholder:text-paper/50' : 'bg-stone-50 border-stone-200 placeholder:text-stone-500'
            }`}
          />
          <ul className="max-h-52 overflow-y-auto">
            {shown.length === 0 ? (
              <li className="px-2.5 py-2 text-[12px] text-muted">{links.candidates.length ? 'No other mark matches.' : 'No other marks yet.'}</li>
            ) : (
              shown.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => links.onLink(c.id)} className={row}>
                    <span className="truncate flex-1">{c.label}</span>
                    <span className="shrink-0 text-[11px] text-muted">{c.where}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
