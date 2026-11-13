/**
 * Marks drawn as boxes of HTML on the page: text boxes, sticky notes and reaction glyphs (moved
 * verbatim from AnnotationLayer).
 */

import React from 'react';
import { Lock, Unlock } from '../../icons';
import {
  Annotation,
  DEFAULT_TEXT_SIZE,
  FractionRect,
  NoteStyle,
  fontStack,
  isReaction,
  reactionChar,
  rectStyle
} from '../annotationModel';
import { isDarkFill, withAlpha, GestureMode } from './layerHelpers';

export interface LayerBoxesProps {
  annotations: Annotation[];
  gestureHandlers: (a: Annotation, mode: GestureMode) => { onPointerDown: (e: React.PointerEvent) => void; };
  gestureRef: React.RefObject<{ id: string; mode: GestureMode; startX: number; startY: number; origin: Annotation; originBounds: FractionRect; moved: boolean; }>;
  handleMarkClick: (e: React.MouseEvent, annotation: Annotation) => void;
  hoveredId: string;
  live: (a: Annotation) => Annotation;
  onEdit: (id: string) => void;
  onHover: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  pageHeight: number;
  pageWidth: number;
  selectedId: string;
}

export const LayerBoxes: React.FC<LayerBoxesProps> = ({ annotations, gestureHandlers, gestureRef, handleMarkClick, hoveredId, live, onEdit, onHover, onUpdate, pageHeight, pageWidth, selectedId }) => (
  <>
      {/*
        Text boxes: the reader's words written straight onto the page.

        No border and no panel — a text box is meant to read as writing ON the document, not as a
        widget sitting over it. It moves and locks exactly like a sticky note; the only outline
        that ever appears is a faint dashed one while it is selected, so an empty or short box can
        still be found and grabbed.
      */}
      {annotations
        .filter((a) => a.kind === 'text' && a.box)
        .map((raw) => {
          const a = live(raw);
          const isOpen = selectedId === a.id;
          const lifted = isOpen || hoveredId === a.id;
          const dragging = gestureRef.current?.id === a.id;

          return (
            <div
              key={a.id}
              {...gestureHandlers(raw, 'move')}
              onMouseEnter={() => onHover(a.id)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => handleMarkClick(e, raw)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onEdit(a.id);
              }}
              data-mark-ui=""
              title={a.locked ? 'Locked in place — unlock to move' : 'Drag to move, corner to resize'}
              className="absolute group"
              style={{
                ...rectStyle(a.box!),
                pointerEvents: 'auto',
                cursor: a.locked ? 'pointer' : dragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                color: a.color,
                // Sized against the page rather than the window, so a text box keeps its
                // proportions at any zoom and lands the same size in an export.
                fontSize: Math.max(8, (a.fontSize ?? DEFAULT_TEXT_SIZE) * pageWidth),
                fontFamily: fontStack(a.font),
                fontWeight: a.bold ? 700 : 400,
                fontStyle: a.italic ? 'italic' : 'normal',
                textAlign: a.align ?? 'left',
                lineHeight: 1.25,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflow: 'hidden',
                // Only while selected or hovered, so the page normally shows just the words.
                outline: lifted ? `1px dashed ${a.color}` : 'none',
                outlineOffset: 2
              }}
            >
              {a.text || <span className="italic opacity-45">Double-click to write…</span>}

              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate(a.id, { locked: !a.locked });
                }}
                title={a.locked ? 'Unlock position' : 'Lock position'}
                className={`absolute top-0 right-0 p-1 rounded transition-opacity cursor-pointer ${
                  a.locked ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'
                }`}
                style={{ color: a.color, background: 'rgb(255 255 255 / 0.8)' }}
              >
                {a.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>

              {!a.locked && (
                <div
                  {...gestureHandlers(raw, 'se')}
                  title="Drag to resize"
                  className="absolute bottom-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    width: 12,
                    height: 12,
                    cursor: 'nwse-resize',
                    background: `linear-gradient(135deg, transparent 50%, ${a.color} 50%)`,
                    touchAction: 'none'
                  }}
                />
              )}
            </div>
          );
        })}

      {/*
        Sticky notes.

        Real notes occupying real space on the page, in the same fractional geometry as every
        other mark — so they hold position at any zoom and land identically in an export.

        Three fills, because a note is doing one of three jobs. `outline` is paper laid on the
        page and is the most legible for anything long. `solid` floods the note with its colour so
        it carries across a spread at a glance. `translucent` tints it and lets the text below
        show through, for a remark that should sit WITH the passage rather than over it.

        Movable and resizable by dragging, and lockable once placed.
      */}
      {annotations
        .filter((a) => a.kind === 'note' && a.box)
        .map((raw) => {
          const a = live(raw);
          const isOpen = selectedId === a.id;
          const lifted = isOpen || hoveredId === a.id;
          const dragging = gestureRef.current?.id === a.id;
          const style: NoteStyle = a.noteStyle ?? 'outline';
          const filled = style === 'solid';
          const background =
            style === 'solid' ? a.color : style === 'translucent' ? withAlpha(a.color, 0.3) : '#fffdf5';
          // Ink is chosen against whatever is actually behind it: a solid dark note needs light
          // handwriting, while a tint over the page must stay dark to read against the paper.
          const ink = filled && isDarkFill(a.color) ? '#fffdf5' : '#1c1917';

          return (
            <div
              key={a.id}
              {...gestureHandlers(raw, 'move')}
              onMouseEnter={() => onHover(a.id)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => handleMarkClick(e, raw)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onEdit(a.id);
              }}
              data-mark-ui=""
              title={a.locked ? 'Locked in place — unlock to move' : 'Drag to move, corner to resize'}
              className="absolute group"
              style={{
                ...rectStyle(a.box!),
                pointerEvents: 'auto',
                cursor: a.locked ? 'pointer' : dragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                background,
                border: `1px solid ${a.color}`,
                // The heavy left edge is what makes the colour readable at a glance on the
                // outline style, where it is the only colour the note carries.
                borderLeft: `5px solid ${a.color}`,
                borderRadius: 3,
                boxShadow: lifted ? '0 8px 20px rgb(0 0 0 / 0.25)' : '0 2px 8px rgb(0 0 0 / 0.18)',
                overflow: 'hidden'
              }}
            >
              <div
                className="w-full h-full"
                style={{
                  padding: '4% 5%',
                  color: ink,
                  fontFamily: "'Caveat Variable', 'Caveat', 'Patrick Hand', cursive",
                  // Scales with the page rather than the window, so a note keeps its proportions.
                  // Sized from the note's own box, exactly as the export sizes it
                // (`exportAnnotatedPdf`'s `boxHeight / 4.5`). It used to be `1.5vw`, which is
                // relative to the WINDOW: the handwriting did not grow with zoom, so a note was a
                // huge box of tiny text at 400% and overflowed its box at 30% — and the exported
                // note wrapped to a different number of lines than the one on screen.
                fontSize: Math.max(8, Math.min(16, (a.box?.h ?? 0) * pageHeight / 4.5)),
                  lineHeight: 1.25,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflow: 'hidden'
                }}
              >
                {a.text?.trim() || <span className="italic opacity-40">Double-click to write…</span>}
              </div>

              {/* Lock. Shown on hover, or always once locked so the state is never a surprise. */}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate(a.id, { locked: !a.locked });
                }}
                title={a.locked ? 'Unlock position' : 'Lock position'}
                className={`absolute top-0.5 right-0.5 p-1 rounded transition-opacity cursor-pointer ${
                  a.locked ? 'opacity-80' : 'opacity-0 group-hover:opacity-70'
                }`}
                style={{ color: a.color, background: 'rgb(255 255 255 / 0.75)' }}
              >
                {a.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>

              {/* Diagonal resize handle, bottom-right. Hidden while locked. */}
              {!a.locked && (
                <div
                  {...gestureHandlers(raw, 'se')}
                  title="Drag to resize"
                  className="absolute bottom-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    width: 14,
                    height: 14,
                    cursor: 'nwse-resize',
                    background: `linear-gradient(135deg, transparent 50%, ${a.color} 50%)`,
                    touchAction: 'none'
                  }}
                />
              )}
            </div>
          );
        })}

      {/*
        Quick reactions — ?, *, ! — a single glyph reacting to a passage rather than a style
        tinting it. Rendered like a tiny sticky note: its own `box` (draggable), sized from
        `fontSize` the same way a text box is, resized through the same size picker rather than a
        corner handle since there is nothing to resize but the one character.
      */}
      {annotations
        .filter((a) => isReaction(a.kind) && a.box)
        .map((raw) => {
          const a = live(raw);
          const lifted = selectedId === a.id || hoveredId === a.id;
          const dragging = gestureRef.current?.id === a.id;
          const size = Math.max(8, (a.fontSize ?? DEFAULT_TEXT_SIZE) * pageWidth);
          return (
            <div
              key={a.id}
              {...gestureHandlers(raw, 'move')}
              onMouseEnter={() => onHover(a.id)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => handleMarkClick(e, raw)}
              data-mark-ui=""
              title="Drag to move"
              className="absolute flex items-center justify-center select-none"
              style={{
                ...rectStyle(a.box!),
                pointerEvents: 'auto',
                cursor: dragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                borderRadius: '9999px',
                background: lifted ? withAlpha(a.color, 0.16) : 'transparent',
                outline: lifted ? `1px solid ${a.color}` : 'none'
              }}
            >
              <span style={{ fontSize: size, fontWeight: 800, lineHeight: 1, color: a.color }}>
                {reactionChar(a.kind)}
              </span>
            </div>
          );
        })}
  </>
);
