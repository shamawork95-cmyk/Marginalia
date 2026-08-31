/**
 * The interactive overlay on one page: it draws that page's marks and creates new ones from
 * pointer input.
 *
 * Everything is positioned in percentages of the page box, so the layer needs no knowledge of the
 * current zoom and nothing is recalculated when it changes — the browser rescales the marks along
 * with the page.
 *
 * Pointer handling is conditional. The layer only intercepts events for tools that draw or place
 * something; for the text-anchored tools it stays transparent so the selection lands on the text
 * layer beneath it, which is where highlight, underline and strikeout get their geometry.
 */

import React, { useRef, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import {
  Annotation,
  BOX_KINDS,
  DEFAULT_NOTE_SIZE,
  FractionPoint,
  LINE_KINDS,
  PdfTool,
  boxFromPoints,
  newAnnotationId,
  pointToFraction,
  pointsToPolyline,
  rectStyle
} from './annotationModel';

interface AnnotationLayerProps {
  pageNumber: number;
  pageRef: React.RefObject<HTMLDivElement | null>;
  /** The page's rendered width in CSS pixels, used to turn fractional weights into stroke widths. */
  pageWidth: number;
  annotations: Annotation[];
  tool: PdfTool;
  activeColor: string;
  activeThemeId: string | null;
  /** Weight the active tool will draw at, so the live preview matches the finished mark. */
  toolWeight?: number;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (annotation: Annotation) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  /** Moves or resizes a note, in page fractions. */
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onHover: (id: string | null) => void;
}

/** True for colours light enough that a warm paper tone would wash them out. */
function isDarkNote(hex: string): boolean {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const n = parseInt(full || '000000', 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance < 0.6;
}

/** Fallback weight for marks made before thickness was configurable. */
const DEFAULT_WEIGHT = 0.0028;

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  pageNumber,
  pageRef,
  pageWidth,
  annotations,
  tool,
  activeColor,
  activeThemeId,
  toolWeight,
  selectedId,
  hoveredId,
  onSelect,
  onCreate,
  onDelete,
  onEdit,
  onUpdate,
  onHover
}) => {
  /**
   * A note being dragged or resized.
   *
   * Held here rather than committed on every pointer move so the document is not re-saved dozens
   * of times a second; the final geometry is written once the gesture ends.
   */
  const dragRef = useRef<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; box: Annotation['box'] } | null>(null);

  const [draftStroke, setDraftStroke] = useState<FractionPoint[] | null>(null);
  const [draftStart, setDraftStart] = useState<FractionPoint | null>(null);
  const [draftEnd, setDraftEnd] = useState<FractionPoint | null>(null);
  const drawingRef = useRef(false);

  /**
   * Whether the layer itself needs to swallow pointer events.
   *
   * Only tools that DRAW need that — they capture a drag across the whole page. `select` and
   * `erase` act on marks, which carry their own pointer handling, so the layer stays transparent
   * and clicks fall through to the text underneath. That distinction matters: making the layer
   * opaque for `select` would block text selection, and making it transparent for the drawing
   * tools would mean nothing could be drawn.
   */
  const capturesDrag =
    tool === 'ink' || tool === 'note' || BOX_KINDS.includes(tool as never) || LINE_KINDS.includes(tool as never);

  // Marks stay clickable whatever the tool, so Select can pick one and Erase can remove one. The
  // exception is mid-drag, when a mark under the pointer must not steal the gesture.
  const marksClickable = !capturesDrag;

  const pageBox = (): DOMRect | null => pageRef.current?.getBoundingClientRect() ?? null;

  const base = (kind: Annotation['kind']) => ({
    id: newAnnotationId(),
    page: pageNumber,
    kind,
    color: activeColor,
    themeId: activeThemeId,
    createdAt: new Date().toISOString()
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = pageBox();
    if (!box) return;
    const point = pointToFraction(e.clientX, e.clientY, box);

    if (tool === 'note') {
      // Placed centred on the click and clamped inside the page, so a note dropped near an edge
      // is not left hanging half outside the paper.
      const w = DEFAULT_NOTE_SIZE.w;
      const h = DEFAULT_NOTE_SIZE.h;
      const annotation: Annotation = {
        ...base('note'),
        box: {
          x: Math.min(Math.max(point.x - w / 2, 0), 1 - w),
          y: Math.min(Math.max(point.y - h / 2, 0), 1 - h),
          w,
          h
        },
        text: ''
      };
      onCreate(annotation);
      // Straight into its editor: a pin with no comment is not worth keeping, so the reader is
      // put in front of the field rather than having to find and click the pin.
      onEdit(annotation.id);
      return;
    }

    if (tool === 'ink' || BOX_KINDS.includes(tool as never) || LINE_KINDS.includes(tool as never)) {
      drawingRef.current = true;
      // Capture keeps the drag following the pointer when it leaves the page box, which would
      // otherwise truncate the mark at the edge.
      e.currentTarget.setPointerCapture(e.pointerId);
      if (tool === 'ink') setDraftStroke([point]);
      else {
        setDraftStart(point);
        setDraftEnd(point);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    const box = pageBox();
    if (!box) return;
    const point = pointToFraction(e.clientX, e.clientY, box);

    if (tool === 'ink') {
      setDraftStroke((prev) => {
        if (!prev) return [point];
        // Thin out near-duplicate samples: a high-frequency pointer emits far more points than
        // the curve needs, and every one is persisted to disk.
        const last = prev[prev.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) < 0.002) return prev;
        return [...prev, point];
      });
    } else {
      setDraftEnd(point);
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (tool === 'ink') {
      setDraftStroke((points) => {
        // A tap with the pen is a mis-click, not a one-point drawing.
        if (points && points.length > 1) {
          onCreate({ ...base('ink'), points, weight: toolWeight ?? DEFAULT_WEIGHT });
        }
        return null;
      });
      return;
    }

    if (draftStart && draftEnd) {
      const dragged = Math.hypot(draftEnd.x - draftStart.x, draftEnd.y - draftStart.y) > 0.01;
      if (dragged) {
        if (LINE_KINDS.includes(tool as never)) {
          onCreate({
            ...base(tool as Annotation['kind']),
            from: draftStart,
            to: draftEnd,
            weight: toolWeight ?? DEFAULT_WEIGHT
          });
        } else {
          const created: Annotation = {
            ...base(tool as Annotation['kind']),
            box: boxFromPoints(draftStart, draftEnd),
            weight: toolWeight ?? DEFAULT_WEIGHT
          };
          onCreate(created);
          // A text box is useless until it has words in it.
          if (tool === 'text') onEdit(created.id);
        }
      }
    }
    setDraftStart(null);
    setDraftEnd(null);
  };

  /**
   * Starts moving or resizing a note.
   *
   * A locked note ignores this entirely, which is the whole point of the lock: once a note is
   * where it belongs, brushing past it while reading must not move it.
   */
  const startNoteGesture = (e: React.PointerEvent, a: Annotation, mode: 'move' | 'resize') => {
    if (a.locked || !a.box) return;
    e.stopPropagation();
    e.preventDefault();
    const box = pageBox();
    if (!box) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: a.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...a.box }
    };
    setDragPreview({ id: a.id, box: a.box });
  };

  const moveNoteGesture = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const box = pageBox();
    if (!drag || !box) return;
    // Deltas are converted to page fractions, so a drag moves the note the same distance on the
    // page whatever the zoom.
    const dx = (e.clientX - drag.startX) / box.width;
    const dy = (e.clientY - drag.startY) / box.height;
    const o = drag.origin;

    const next =
      drag.mode === 'move'
        ? {
            x: Math.min(Math.max(o.x + dx, 0), 1 - o.w),
            y: Math.min(Math.max(o.y + dy, 0), 1 - o.h),
            w: o.w,
            h: o.h
          }
        : {
            x: o.x,
            y: o.y,
            // Diagonal resize from the bottom-right corner, floored so a note cannot be shrunk
            // into something too small to grab again.
            w: Math.min(Math.max(o.w + dx, 0.06), 1 - o.x),
            h: Math.min(Math.max(o.h + dy, 0.04), 1 - o.y)
          };
    setDragPreview({ id: drag.id, box: next });
  };

  const endNoteGesture = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (dragPreview?.box) onUpdate(drag.id, { box: dragPreview.box });
    dragRef.current = null;
    setDragPreview(null);
  };

  /** Erase deletes on click; every other tool selects, which is what reveals a mark's comment. */
  const handleMarkClick = (e: React.MouseEvent, annotation: Annotation) => {
    e.stopPropagation();
    if (tool === 'erase') {
      onDelete(annotation.id);
      return;
    }
    onSelect(annotation.id === selectedId ? null : annotation.id);
  };

  /**
   * Whether a mark is picked out right now.
   *
   * Emphasis is shown with an OUTLINE, never by changing the mark's own opacity or colour. Making
   * a highlight darker when clicked looked like the click had edited it — the colour is data, and
   * data should not change to indicate focus.
   */
  const emphasis = (a: Annotation) => (selectedId === a.id || hoveredId === a.id ? 1 : 0);

  const draftBox = draftStart && draftEnd ? boxFromPoints(draftStart, draftEnd) : null;

  return (
    <div
      className="absolute inset-0 z-3"
      style={{
        pointerEvents: capturesDrag ? 'auto' : 'none',
        cursor:
          tool === 'ink' ? 'crosshair' : tool === 'note' ? 'copy' : tool === 'erase' ? 'not-allowed' : capturesDrag ? 'crosshair' : 'default',
        touchAction: capturesDrag ? 'none' : 'auto'
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {/* Vector marks share one normalized 0–100 viewBox, so the same path data scales with the
          page. `vector-effect` keeps strokes a constant visual weight instead of ballooning with
          zoom, and `preserveAspectRatio="none"` lets the square viewBox stretch to the real page
          shape so a mark stays where it was drawn on a non-square page. */}
      <svg
        className="absolute inset-0 w-full h-full overflow-visible"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          {annotations
            .filter((a) => a.kind === 'arrow')
            .map((a) => (
              <marker
                key={`head-${a.id}`}
                id={`arrowhead-${a.id}`}
                markerWidth="4"
                markerHeight="4"
                refX="3"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L4,2 L0,4 z" fill={a.color} />
              </marker>
            ))}
        </defs>

        {annotations.map((a) => {
          // Against the page's pixel width, not the viewBox: see `Annotation.weight`.
          const width = Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pageWidth);
          const interactive: React.CSSProperties = {
            pointerEvents: marksClickable ? 'stroke' : 'none',
            cursor: 'pointer'
          };

          if (a.kind === 'ink' && a.points && a.points.length > 1) {
            return (
              <polyline
                key={a.id}
                points={pointsToPolyline(a.points)}
                fill="none"
                stroke={a.color}
                strokeWidth={width}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={interactive}
                onClick={(e) => handleMarkClick(e, a)}
              />
            );
          }

          if ((a.kind === 'arrow' || a.kind === 'line') && a.from && a.to) {
            return (
              <line
                key={a.id}
                x1={a.from.x * 100}
                y1={a.from.y * 100}
                x2={a.to.x * 100}
                y2={a.to.y * 100}
                stroke={a.color}
                strokeWidth={width}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                markerEnd={a.kind === 'arrow' ? `url(#arrowhead-${a.id})` : undefined}
                style={interactive}
                onClick={(e) => handleMarkClick(e, a)}
              />
            );
          }

          if (a.kind === 'ellipse' && a.box) {
            return (
              <ellipse
                key={a.id}
                cx={(a.box.x + a.box.w / 2) * 100}
                cy={(a.box.y + a.box.h / 2) * 100}
                rx={(a.box.w / 2) * 100}
                ry={(a.box.h / 2) * 100}
                fill="none"
                stroke={a.color}
                strokeWidth={width}
                vectorEffect="non-scaling-stroke"
                style={interactive}
                onClick={(e) => handleMarkClick(e, a)}
              />
            );
          }

          if (a.kind === 'rect' && a.box) {
            return (
              <rect
                key={a.id}
                x={a.box.x * 100}
                y={a.box.y * 100}
                width={a.box.w * 100}
                height={a.box.h * 100}
                fill="none"
                stroke={a.color}
                strokeWidth={width}
                vectorEffect="non-scaling-stroke"
                style={interactive}
                onClick={(e) => handleMarkClick(e, a)}
              />
            );
          }
          return null;
        })}

        {/* Live preview of whatever is being dragged right now. */}
        {draftStroke && draftStroke.length > 1 && (
          <polyline
            points={pointsToPolyline(draftStroke)}
            fill="none"
            stroke={activeColor}
            strokeWidth={Math.max(1, (toolWeight ?? DEFAULT_WEIGHT) * pageWidth)}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {draftBox && tool === 'rect' && (
          <rect
            x={draftBox.x * 100}
            y={draftBox.y * 100}
            width={draftBox.w * 100}
            height={draftBox.h * 100}
            fill="none"
            stroke={activeColor}
            strokeDasharray="4 4"
            strokeWidth={Math.max(1, (toolWeight ?? DEFAULT_WEIGHT) * pageWidth)}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {draftBox && (tool === 'ellipse' || tool === 'text') && (
          <rect
            x={draftBox.x * 100}
            y={draftBox.y * 100}
            width={draftBox.w * 100}
            height={draftBox.h * 100}
            fill="none"
            stroke={activeColor}
            strokeDasharray="4 4"
            strokeWidth={Math.max(1, (toolWeight ?? DEFAULT_WEIGHT) * pageWidth)}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {draftStart && draftEnd && LINE_KINDS.includes(tool as never) && (
          <line
            x1={draftStart.x * 100}
            y1={draftStart.y * 100}
            x2={draftEnd.x * 100}
            y2={draftEnd.y * 100}
            stroke={activeColor}
            strokeWidth={Math.max(1, (toolWeight ?? DEFAULT_WEIGHT) * pageWidth)}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Text-anchored marks. Each covered line is its own rectangle, which is what makes a
          highlight follow the ragged shape of real prose instead of boxing the whole block. */}
      {annotations
        .filter((a) => a.rects?.length)
        .flatMap((a) =>
          a.rects!.map((rect, index) => {
            const strong = emphasis(a) === 1;
            const style: React.CSSProperties = {
              ...rectStyle(rect),
              position: 'absolute',
              pointerEvents: 'auto',
              cursor: 'pointer'
            };

            if (a.kind === 'underline' || a.kind === 'strikeout') {
              return (
                <span key={`${a.id}-${index}`} title={a.text || a.quote} style={style} onClick={(e) => handleMarkClick(e, a)}>
                  <span
                    className="absolute left-0 right-0"
                    style={{
                      // Underline sits on the baseline, strikeout through the middle of the line.
                      top: a.kind === 'underline' ? '92%' : '52%',
                      // The mark's own thickness, against the page width like every other stroke.
                      height: Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pageWidth),
                      background: a.color,
                      borderRadius: 2,
                      outline: strong ? `1px solid ${a.color}` : 'none',
                      outlineOffset: 1
                    }}
                  />
                </span>
              );
            }

            return (
              <span
                key={`${a.id}-${index}`}
                title={a.text || a.quote}
                onClick={(e) => handleMarkClick(e, a)}
                style={{
                  ...style,
                  backgroundColor: a.color,
                  // Multiply keeps the page's own text legible through the tint, which a flat
                  // opaque fill greys out.
                  mixBlendMode: 'multiply',
                  opacity: strong ? 0.62 : 0.38,
                  borderRadius: 2
                }}
              />
            );
          })
        )}

      {/*
        Text boxes: the reader's words written straight onto the page.

        No border and no panel — a text box is meant to read as writing ON the document, not as a
        widget sitting over it. It moves and locks exactly like a sticky note; the only outline
        that ever appears is a faint dashed one while it is selected, so an empty or short box can
        still be found and grabbed.
      */}
      {annotations
        .filter((a) => a.kind === 'text' && a.box)
        .map((a) => {
          const isOpen = selectedId === a.id;
          const lifted = isOpen || hoveredId === a.id;
          const live = dragPreview?.id === a.id ? dragPreview.box! : a.box!;
          const dragging = dragRef.current?.id === a.id;

          return (
            <div
              key={a.id}
              onPointerDown={(e) => startNoteGesture(e, a, 'move')}
              onPointerMove={moveNoteGesture}
              onPointerUp={endNoteGesture}
              onPointerCancel={endNoteGesture}
              onMouseEnter={() => onHover(a.id)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => handleMarkClick(e, a)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onEdit(a.id);
              }}
              title={a.locked ? 'Locked in place — unlock to move' : 'Drag to move, corner to resize'}
              className="absolute group"
              style={{
                ...rectStyle(live),
                pointerEvents: 'auto',
                cursor: a.locked ? 'pointer' : dragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                color: a.color,
                fontSize: 'clamp(10px, 1.35vw, 21px)',
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
                  onPointerDown={(e) => startNoteGesture(e, a, 'resize')}
                  onPointerMove={moveNoteGesture}
                  onPointerUp={endNoteGesture}
                  onPointerCancel={endNoteGesture}
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
        other mark — so they hold position at any zoom and land identically in an export. The
        background is SOLID rather than tinted: a note is a piece of paper laid on the page, and
        text showing through it made both harder to read.

        Movable and resizable by dragging, and lockable once placed.
      */}
      {annotations
        .filter((a) => a.kind === 'note' && a.box)
        .map((a) => {
          const isOpen = selectedId === a.id;
          const lifted = isOpen || hoveredId === a.id;
          const live = dragPreview?.id === a.id ? dragPreview.box! : a.box!;
          const dragging = dragRef.current?.id === a.id;

          return (
            <div
              key={a.id}
              onPointerDown={(e) => startNoteGesture(e, a, 'move')}
              onPointerMove={moveNoteGesture}
              onPointerUp={endNoteGesture}
              onPointerCancel={endNoteGesture}
              onMouseEnter={() => onHover(a.id)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => handleMarkClick(e, a)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onEdit(a.id);
              }}
              title={a.locked ? 'Locked in place — unlock to move' : 'Drag to move, corner to resize'}
              className="absolute group"
              style={{
                ...rectStyle(live),
                pointerEvents: 'auto',
                cursor: a.locked ? 'pointer' : dragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                // Opaque paper with the note's colour carried on its border, so the colour codes
                // the note without competing with the handwriting for legibility.
                background: '#fffdf5',
                borderLeft: `5px solid ${a.color}`,
                border: `1px solid ${a.color}`,
                borderRadius: 3,
                boxShadow: lifted ? '0 8px 20px rgb(0 0 0 / 0.25)' : '0 2px 8px rgb(0 0 0 / 0.18)',
                overflow: 'hidden'
              }}
            >
              <div
                className="w-full h-full"
                style={{
                  padding: '4% 5%',
                  color: '#1c1917',
                  fontFamily: "'Caveat Variable', 'Caveat', 'Patrick Hand', cursive",
                  // Scales with the page rather than the window, so a note keeps its proportions.
                  fontSize: 'clamp(12px, 1.5vw, 24px)',
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
                  onPointerDown={(e) => startNoteGesture(e, a, 'resize')}
                  onPointerMove={moveNoteGesture}
                  onPointerUp={endNoteGesture}
                  onPointerCancel={endNoteGesture}
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

      {/* The passage a hovered note was written about, lit up on its own page. */}
      {annotations
        .filter((a) => a.kind === 'note' && hoveredId === a.id && a.anchorRects?.length)
        .flatMap((a) =>
          a.anchorRects!.map((rect, index) => (
            <span
              key={`anchor-${a.id}-${index}`}
              style={{
                ...rectStyle(rect),
                position: 'absolute',
                pointerEvents: 'none',
                backgroundColor: a.color,
                mixBlendMode: 'multiply',
                opacity: 0.4,
                borderRadius: 2
              }}
            />
          ))
        )}
    </div>
  );
};
