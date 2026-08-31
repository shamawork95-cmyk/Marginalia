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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import {
  Annotation,
  BOX_KINDS,
  BracketSide,
  DEFAULT_NOTE_SIZE,
  DEFAULT_TEXT_SIZE,
  FractionPoint,
  FractionRect,
  LINE_KINDS,
  NoteStyle,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont,
  annotationBounds,
  boxFromPoints,
  bracketPath,
  constrainToShape,
  fontStack,
  dashArray,
  isMovable,
  newAnnotationId,
  pointToFraction,
  pointsToPolyline,
  rectStyle,
  scaleAnnotation,
  translateAnnotation
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
  /** Dash pattern the active tool will draw with. */
  toolStrokeStyle?: StrokeStyle;
  /** Fill style new sticky notes are given. */
  toolNoteStyle?: NoteStyle;
  /** Which way new brackets open. */
  toolBracketSide?: BracketSide;
  /** Type size, alignment and face new text boxes get. */
  toolTextSize?: number;
  toolTextAlign?: TextAlign;
  toolTextFont?: TextFont;
  toolTextBold?: boolean;
  toolTextItalic?: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (annotation: Annotation) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  /** Moves, resizes or restyles a mark, in page fractions. */
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onHover: (id: string | null) => void;
}

/** True for colours light enough that dark ink reads better on them than light. */
function isDarkFill(hex: string): boolean {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const n = parseInt(full || '000000', 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance < 0.6;
}

/** '#rrggbb' with an alpha channel, for the translucent note fill. */
function withAlpha(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const n = parseInt(full || '000000', 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}

/** Fallback weight for marks made before thickness was configurable. */
const DEFAULT_WEIGHT = 0.0028;

/** A bracket's width when the reader drags straight down without spreading it out. */
const DEFAULT_BRACKET_WIDTH = 0.02;

/**
 * How far the pointer must travel before a press on a mark becomes a drag.
 *
 * Below this it is a click, and the mark is selected without being moved. Clicking a sticky note
 * to read it should not shift it by the two or three pixels a hand moves while pressing a button.
 */
const DRAG_THRESHOLD_PX = 4;

/** How a mark being manipulated is being changed. */
type GestureMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'from' | 'to';

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  pageNumber,
  pageRef,
  pageWidth,
  annotations,
  tool,
  activeColor,
  activeThemeId,
  toolWeight,
  toolStrokeStyle,
  toolNoteStyle,
  toolBracketSide,
  toolTextSize,
  toolTextAlign,
  toolTextFont,
  toolTextBold,
  toolTextItalic,
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
   * The mark currently being dragged, resized or reshaped.
   *
   * Held in a ref and previewed in state rather than committed on every pointer move, so the
   * document is not re-saved dozens of times a second — and, just as importantly, so one drag
   * lands on the undo stack as ONE step rather than as several hundred.
   */
  const gestureRef = useRef<{
    id: string;
    mode: GestureMode;
    startX: number;
    startY: number;
    origin: Annotation;
    originBounds: FractionRect;
    /** Whether the pointer has travelled far enough to count as a drag rather than a click. */
    moved: boolean;
  } | null>(null);
  const [preview, setPreview] = useState<{ id: string; patch: Partial<Annotation> } | null>(null);
  /** Mirrors `gestureRef` in state, purely so the window listeners can be bound only while needed. */
  const [gestureActive, setGestureActive] = useState(false);

  /**
   * Ends the gesture in progress, committing it as a single change.
   *
   * Written as one function called from every ending — release, cancel, lost focus, a move with
   * no button held — so there is exactly one place that can leave the gesture half-finished.
   */
  const finishGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setGestureActive(false);
    setPreview((current) => {
      // One commit for the whole gesture: the reader undoes a drag, not four hundred moves. The
      // patch is read from the state updater rather than the render closure so the very last
      // pointer position is the one that lands, whatever order React flushed things in.
      if (gesture && current?.id === gesture.id && Object.keys(current.patch).length > 0) {
        onUpdate(gesture.id, current.patch);
      }
      return null;
    });
  }, [onUpdate]);

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

  /** The mark as it looks right now, including any gesture in progress. */
  const live = (a: Annotation): Annotation =>
    preview?.id === a.id ? ({ ...a, ...preview.patch } as Annotation) : a;

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
        noteStyle: toolNoteStyle,
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
      // Shift constrains the shape: a true square or circle, or a line snapped to the nearest
      // 45 degrees. Applied live on every move, so releasing and re-pressing Shift mid-drag shows
      // the difference immediately rather than only deciding it at the end.
      setDraftEnd(
        e.shiftKey && draftStart
          ? constrainToShape(draftStart, point, box.width, box.height, LINE_KINDS.includes(tool as never) ? 'line' : 'box')
          : point
      );
    }
  };

  /** The box a bracket drag produces: vertical span from the drag, width only if spread out. */
  const bracketBoxFrom = (a: FractionPoint, b: FractionPoint): FractionRect => {
    const box = boxFromPoints(a, b);
    if (box.w >= DEFAULT_BRACKET_WIDTH) return box;
    // A straight downward drag is the common gesture, and it carries no width — so the brace is
    // given a sensible one, centred on the line the reader actually drew.
    const x = Math.min(Math.max(box.x + box.w / 2 - DEFAULT_BRACKET_WIDTH / 2, 0), 1 - DEFAULT_BRACKET_WIDTH);
    return { ...box, x, w: DEFAULT_BRACKET_WIDTH };
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (tool === 'ink') {
      setDraftStroke((points) => {
        // A tap with the pen is a mis-click, not a one-point drawing.
        if (points && points.length > 1) {
          onCreate({
            ...base('ink'),
            points,
            weight: toolWeight ?? DEFAULT_WEIGHT,
            strokeStyle: toolStrokeStyle
          });
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
            weight: toolWeight ?? DEFAULT_WEIGHT,
            strokeStyle: toolStrokeStyle
          });
        } else if (tool === 'bracket') {
          onCreate({
            ...base('bracket'),
            box: bracketBoxFrom(draftStart, draftEnd),
            bracketSide: toolBracketSide ?? 'left',
            weight: toolWeight ?? DEFAULT_WEIGHT,
            strokeStyle: toolStrokeStyle
          });
        } else {
          const created: Annotation = {
            ...base(tool as Annotation['kind']),
            box: boxFromPoints(draftStart, draftEnd),
            weight: toolWeight ?? DEFAULT_WEIGHT,
            strokeStyle: tool === 'text' ? undefined : toolStrokeStyle,
            ...(tool === 'text'
              ? {
                  fontSize: toolTextSize,
                  align: toolTextAlign,
                  font: toolTextFont,
                  bold: toolTextBold,
                  italic: toolTextItalic
                }
              : {})
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

  // ── Moving, resizing and reshaping existing marks ──

  /**
   * Starts a manipulation of an existing mark.
   *
   * A locked mark ignores this entirely, which is the whole point of the lock: once a mark is
   * where it belongs, brushing past it while reading must not move it.
   *
   * The gesture is tracked on the WINDOW rather than on the element, and this is the important
   * part. Element handlers plus pointer capture look equivalent and are not: if the release ever
   * fails to land back on the element — the pointer leaves the window, capture is lost when the
   * node re-renders, another listener swallows the event — the gesture never ends, and the mark
   * silently stays glued to the cursor, moving on every subsequent mouse move with no button
   * held. Listening on the window means the release is caught wherever it happens.
   */
  const startGesture = (e: React.PointerEvent, a: Annotation, mode: GestureMode) => {
    if (a.locked) return;
    const bounds = annotationBounds(a);
    if (!bounds) return;
    e.stopPropagation();
    e.preventDefault();
    gestureRef.current = {
      id: a.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: a,
      originBounds: bounds,
      // A gesture is not a drag until the pointer has actually travelled. Without this, the tiny
      // tremor between pressing and releasing a click nudges the mark a pixel or two every time
      // it is merely selected.
      moved: false
    };
    setGestureActive(true);
    setPreview(null);
  };

  /**
   * Live tracking for whatever gesture is in progress, for as long as one is.
   *
   * Bound while a gesture is running and torn down the moment it ends, so the workspace carries
   * no window-level listeners at rest.
   */
  useEffect(() => {
    if (!gestureActive) return;

    const onMove = (e: PointerEvent) => {
      const gesture = gestureRef.current;
      const box = pageBox();
      if (!gesture || !box) return;

      // A release that happened somewhere we never heard about — the pointer left the window, or
      // another element swallowed the event. The next move with no button held is the signal, and
      // ending here is what stops a mark following the cursor around the page for ever.
      if (e.buttons === 0) {
        finishGesture();
        return;
      }

      const dx = (e.clientX - gesture.startX) / box.width;
      const dy = (e.clientY - gesture.startY) / box.height;
      if (!gesture.moved && Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      gesture.moved = true;

      const { origin, originBounds, mode } = gesture;

      if (mode === 'move') {
        setPreview({ id: gesture.id, patch: translateAnnotation(origin, dx, dy) });
        return;
      }

      if (mode === 'from' || mode === 'to') {
        // Endpoints move independently, which is what lets an arrow be re-aimed rather than only
        // slid around — the one manipulation a bounding box cannot express.
        const point = pointToFraction(e.clientX, e.clientY, box);
        setPreview({ id: gesture.id, patch: mode === 'from' ? { from: point } : { to: point } });
        return;
      }

      // Corner resize. The dragged corner follows the pointer; the opposite one stays pinned,
      // which is what makes the gesture feel like grabbing the shape rather than nudging its size.
      const b = originBounds;
      const left = mode === 'nw' || mode === 'sw';
      const top = mode === 'nw' || mode === 'ne';
      const x1 = left ? b.x + dx : b.x;
      const x2 = left ? b.x + b.w : b.x + b.w + dx;
      const y1 = top ? b.y + dy : b.y;
      const y2 = top ? b.y + b.h : b.y + b.h + dy;
      const next: FractionRect = {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1)
      };
      setPreview({ id: gesture.id, patch: scaleAnnotation(origin, b, next) });
    };

    const onEnd = () => finishGesture();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    // A window that loses focus mid-drag never sees the release at all.
    window.addEventListener('blur', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', onEnd);
    };
  });

  const gestureHandlers = (a: Annotation, mode: GestureMode) => ({
    onPointerDown: (e: React.PointerEvent) => startGesture(e, a, mode)
  });

  /**
   * Selecting a highlight, underline or strikeout.
   *
   * Those marks are drawn BENEATH the text layer and take no pointer events at all, so that a
   * drag across an already-highlighted passage reaches the text and selects it — marking a
   * sentence must never make it unselectable afterwards. The cost is that they cannot be clicked
   * directly, so the click is caught on the page and matched against their rectangles here.
   */
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const onClick = (e: MouseEvent) => {
      // A click that ends a text selection is the reader choosing words, not choosing a mark.
      if (!window.getSelection()?.isCollapsed) return;
      // Notes, shapes and their handles carry their own handling.
      if (e.target instanceof Element && e.target.closest('[data-mark-ui]')) return;

      const box = page.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width;
      const y = (e.clientY - box.top) / box.height;
      // Last first: later marks are painted on top, so the topmost one under the pointer wins.
      const hit = [...annotations]
        .reverse()
        .find((a) => a.rects?.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h));
      if (!hit) return;
      e.stopPropagation();
      if (tool === 'erase') onDelete(hit.id);
      else onSelect(hit.id === selectedId ? null : hit.id);
    };

    page.addEventListener('click', onClick);
    return () => page.removeEventListener('click', onClick);
  }, [pageRef, annotations, tool, selectedId, onSelect, onDelete]);

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
  /** The weight the active tool draws at, so a preview matches the mark it becomes. */
  const draftWidth = Math.max(1, (toolWeight ?? DEFAULT_WEIGHT) * pageWidth);

  /** Shared stroke attributes, so every kind dashes and scales the same way. */
  const strokeProps = (a: Annotation) => {
    const width = Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pageWidth);
    return {
      stroke: a.color,
      strokeWidth: width,
      strokeDasharray: dashArray(a.strokeStyle, width),
      strokeLinecap: 'round' as const,
      vectorEffect: 'non-scaling-stroke' as const
    };
  };

  // The mark whose handles are on screen. Only marks the reader drew themselves are movable, and
  // only while a tool that manipulates rather than draws is active — otherwise the handles would
  // sit under the pointer and swallow the next stroke.
  const transformTarget = annotations.find(
    (a) =>
      a.id === selectedId &&
      isMovable(a) &&
      a.kind !== 'note' &&
      a.kind !== 'text' &&
      tool !== 'erase' &&
      !capturesDrag
  );

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
                {/* The head is never dashed, whatever the shaft does — a broken arrowhead reads
                    as a rendering fault rather than as a style. */}
                <path d="M0,0 L4,2 L0,4 z" fill={a.color} />
              </marker>
            ))}
        </defs>

        {annotations.map((raw) => {
          const a = live(raw);
          const interactive: React.CSSProperties = {
            pointerEvents: marksClickable ? 'stroke' : 'none',
            cursor: 'pointer'
          };
          // `data-mark-ui` marks everything that is part of manipulating an annotation, so the
          // properties strip knows not to treat a press on it as "the reader moved on".
          const marker = { 'data-mark-ui': '' };

          if (a.kind === 'ink' && a.points && a.points.length > 1) {
            return (
              <polyline
                key={a.id}
                {...marker}
                points={pointsToPolyline(a.points)}
                fill="none"
                {...strokeProps(a)}
                strokeLinejoin="round"
                style={interactive}
                onClick={(e) => handleMarkClick(e, raw)}
              />
            );
          }

          if ((a.kind === 'arrow' || a.kind === 'line') && a.from && a.to) {
            return (
              <line
                key={a.id}
                {...marker}
                x1={a.from.x * 100}
                y1={a.from.y * 100}
                x2={a.to.x * 100}
                y2={a.to.y * 100}
                {...strokeProps(a)}
                markerEnd={a.kind === 'arrow' ? `url(#arrowhead-${a.id})` : undefined}
                style={interactive}
                onClick={(e) => handleMarkClick(e, raw)}
              />
            );
          }

          if (a.kind === 'bracket' && a.box) {
            return (
              <path
                key={a.id}
                {...marker}
                d={bracketPath(a.box, a.bracketSide ?? 'left')}
                fill="none"
                {...strokeProps(a)}
                strokeLinejoin="round"
                style={interactive}
                onClick={(e) => handleMarkClick(e, raw)}
              />
            );
          }

          if (a.kind === 'ellipse' && a.box) {
            return (
              <ellipse
                key={a.id}
                {...marker}
                cx={(a.box.x + a.box.w / 2) * 100}
                cy={(a.box.y + a.box.h / 2) * 100}
                rx={(a.box.w / 2) * 100}
                ry={(a.box.h / 2) * 100}
                fill="none"
                {...strokeProps(a)}
                style={interactive}
                onClick={(e) => handleMarkClick(e, raw)}
              />
            );
          }

          if (a.kind === 'rect' && a.box) {
            return (
              <rect
                key={a.id}
                {...marker}
                x={a.box.x * 100}
                y={a.box.y * 100}
                width={a.box.w * 100}
                height={a.box.h * 100}
                fill="none"
                {...strokeProps(a)}
                style={interactive}
                onClick={(e) => handleMarkClick(e, raw)}
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
            strokeWidth={draftWidth}
            strokeDasharray={dashArray(toolStrokeStyle, draftWidth)}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {draftBox && tool === 'bracket' && (
          <path
            d={bracketPath(bracketBoxFrom(draftStart!, draftEnd!), toolBracketSide ?? 'left')}
            fill="none"
            stroke={activeColor}
            strokeWidth={draftWidth}
            strokeDasharray={dashArray(toolStrokeStyle, draftWidth)}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {draftBox && (tool === 'rect' || tool === 'ellipse' || tool === 'text') && (
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
            strokeWidth={draftWidth}
            strokeDasharray={dashArray(toolStrokeStyle, draftWidth)}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

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
        Handles for the selected shape.

        Shapes are drawn in SVG and have no body to grab — a one-pixel line is not a drag target,
        and an ellipse's interior is empty. So the selected mark gets an HTML frame over its
        bounds: the frame moves it, the corners scale it, and a line's two ends can be re-aimed
        individually. The frame is deliberately faint; it is scaffolding, not decoration.
      */}
      {transformTarget && (() => {
        const a = live(transformTarget);
        const bounds = annotationBounds(a);
        if (!bounds) return null;
        const isLine = Boolean(a.from && a.to);
        // A frame is padded outwards so it can be grabbed even when the shape it wraps is flat —
        // a horizontal line has zero height and would otherwise have no frame at all.
        const pad = 0.006;
        const frame: FractionRect = {
          x: bounds.x - pad,
          y: bounds.y - pad,
          w: bounds.w + pad * 2,
          h: bounds.h + pad * 2
        };
        const handle: React.CSSProperties = {
          position: 'absolute',
          width: 11,
          height: 11,
          borderRadius: 3,
          background: '#fff',
          border: `1.5px solid ${a.color}`,
          boxShadow: '0 1px 3px rgb(0 0 0 / 0.3)',
          pointerEvents: 'auto',
          touchAction: 'none'
        };

        return (
          <div
            key={`handles-${a.id}`}
            data-mark-ui=""
            className="absolute"
            style={{
              ...rectStyle(frame),
              pointerEvents: 'none',
              outline: `1px dashed ${a.color}`,
              outlineOffset: 0,
              opacity: 0.85
            }}
          >
            {/* The body: grabbing anywhere inside the frame moves the mark. */}
            <div
              {...gestureHandlers(transformTarget, 'move')}
              title="Drag to move"
              className="absolute inset-0"
              style={{
                pointerEvents: 'auto',
                cursor: gestureRef.current?.mode === 'move' ? 'grabbing' : 'grab',
                touchAction: 'none'
              }}
            />

            {isLine ? (
              <>
                {/* Endpoints, placed where the line's own ends fall inside the frame. */}
                {(['from', 'to'] as const).map((end) => {
                  const point = end === 'from' ? a.from! : a.to!;
                  return (
                    <div
                      key={end}
                      {...gestureHandlers(transformTarget, end)}
                      title={end === 'from' ? 'Drag the start' : 'Drag the end'}
                      style={{
                        ...handle,
                        borderRadius: '50%',
                        left: `${((point.x - frame.x) / frame.w) * 100}%`,
                        top: `${((point.y - frame.y) / frame.h) * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        cursor: 'move'
                      }}
                    />
                  );
                })}
              </>
            ) : (
              (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <div
                  key={corner}
                  {...gestureHandlers(transformTarget, corner)}
                  title="Drag to resize"
                  style={{
                    ...handle,
                    left: corner === 'nw' || corner === 'sw' ? 0 : '100%',
                    top: corner === 'nw' || corner === 'ne' ? 0 : '100%',
                    transform: 'translate(-50%, -50%)',
                    cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize'
                  }}
                />
              ))
            )}
          </div>
        );
      })()}

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


/**
 * Highlights, underlines and strikeouts, drawn UNDER the text layer.
 *
 * Their position in the stack is the whole point of the component existing separately. Drawn on
 * top — where every other mark lives — they intercept the pointer, and a passage that had been
 * highlighted could never be selected again: the press landed on the tint rather than on the
 * words. Underneath, and taking no pointer events, they tint the page while the text beneath
 * stays as selectable as it was before anyone marked it. Clicking one to select it is handled by
 * `AnnotationLayer`, which hit-tests these rectangles against clicks on the page.
 */
export const TextMarkLayer: React.FC<{
  annotations: Annotation[];
  pageWidth: number;
  selectedId: string | null;
  hoveredId: string | null;
}> = ({ annotations, pageWidth, selectedId, hoveredId }) => (
  <div className="absolute inset-0 z-1" style={{ pointerEvents: 'none' }}>
    {annotations
      .filter((a) => a.rects?.length)
      .flatMap((a) =>
        a.rects!.map((rect, index) => {
          const strong = selectedId === a.id || hoveredId === a.id;
          const style: React.CSSProperties = { ...rectStyle(rect), position: 'absolute' };

          if (a.kind === 'underline' || a.kind === 'strikeout') {
            const thickness = Math.max(1, (a.weight ?? DEFAULT_WEIGHT) * pageWidth);
            const dashed = a.strokeStyle === 'dashed' || a.strokeStyle === 'dotted';
            return (
              <span key={`${a.id}-${index}`} style={style}>
                <span
                  className="absolute left-0 right-0"
                  style={{
                    // Underline sits on the baseline, strikeout through the middle of the line.
                    top: a.kind === 'underline' ? '92%' : '52%',
                    // A dashed rule has to be a BORDER rather than a filled block: a background
                    // has no dash pattern, so the same mark is drawn two ways depending on
                    // whether its style calls for gaps.
                    ...(dashed
                      ? { height: 0, borderTop: `${thickness}px ${a.strokeStyle} ${a.color}` }
                      : { height: thickness, background: a.color }),
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
  </div>
);
