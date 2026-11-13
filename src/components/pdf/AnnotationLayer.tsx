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
import {
  Annotation,
  BOX_KINDS,
  highlightOpacity,
  BracketSide,
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
  dashArray,
  isMovable,
  isReaction,
  pointToFraction,
  rectStyle,
  scaleAnnotation,
  translateAnnotation
} from './annotationModel';
import { DEFAULT_WEIGHT, DRAG_THRESHOLD_PX, GestureMode } from './layer/layerHelpers';
import { LayerHandles } from './layer/LayerHandles';
import { LayerBoxes } from './layer/LayerBoxes';
import { LayerVectors } from './layer/LayerVectors';
import { useDrawing } from './layer/useDrawing';
import { ExtraThemeDots } from '../ExtraThemeDots';

interface AnnotationLayerProps {
  pageNumber: number;
  pageRef: React.RefObject<HTMLDivElement | null>;
  /** The page's rendered width in CSS pixels, used to turn fractional weights into stroke widths. */
  pageWidth: number;
  /** Rendered height of the page, for anything sized against the page rather than its width. */
  pageHeight: number;
  annotations: Annotation[];
  tool: PdfTool;
  activeColor: string;
  activeThemeIds: string[];
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


export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  pageNumber,
  pageRef,
  pageWidth,
  pageHeight,
  annotations,
  tool,
  activeColor,
  activeThemeIds,
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
    tool === 'ink' || tool === 'mask' || tool === 'note' || tool === 'area' || BOX_KINDS.includes(tool as never) || LINE_KINDS.includes(tool as never);

  // Marks stay clickable whatever the tool, so Select can pick one and Erase can remove one. The
  // exception is mid-drag, when a mark under the pointer must not steal the gesture.
  const marksClickable = !capturesDrag;

  const pageBox = (): DOMRect | null => pageRef.current?.getBoundingClientRect() ?? null;

  /** The mark as it looks right now, including any gesture in progress. */
  const live = (a: Annotation): Annotation =>
    preview?.id === a.id ? ({ ...a, ...preview.patch } as Annotation) : a;
  const { bracketBoxFrom, finishDrag, handlePointerDown, handlePointerMove } = useDrawing({ activeColor, activeThemeIds, draftEnd, draftStart, drawingRef, onCreate, onEdit, pageBox, pageNumber, setDraftEnd, setDraftStart, setDraftStroke, tool, toolBracketSide, toolNoteStyle, toolStrokeStyle, toolTextAlign, toolTextBold, toolTextFont, toolTextItalic, toolTextSize, toolWeight });

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
      vectorEffect: 'non-scaling-stroke' as const,
      // `emphasis` was computed and then never used, so hovering an ink stroke or a shape — from
      // the notes panel, or while stepping through marks with the instance navigator — raised
      // nothing at all and the reader had no idea which one they had arrived at. A halo rather
      // than a colour change, for the reason in `emphasis`'s own comment: the colour is data.
      filter: emphasis(a) ? `drop-shadow(0 0 ${width * 1.5}px ${a.color})` : undefined
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
      !isReaction(a.kind) &&
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
      <LayerVectors activeColor={activeColor} annotations={annotations} bracketBoxFrom={bracketBoxFrom} draftBox={draftBox} draftEnd={draftEnd} draftStart={draftStart} draftStroke={draftStroke} draftWidth={draftWidth} handleMarkClick={handleMarkClick} live={live} marksClickable={marksClickable} pageWidth={pageWidth} strokeProps={strokeProps} tool={tool} toolBracketSide={toolBracketSide} toolStrokeStyle={toolStrokeStyle} toolWeight={toolWeight} />

      <LayerBoxes annotations={annotations} gestureHandlers={gestureHandlers} gestureRef={gestureRef} handleMarkClick={handleMarkClick} hoveredId={hoveredId} live={live} onEdit={onEdit} onHover={onHover} onUpdate={onUpdate} pageHeight={pageHeight} pageWidth={pageWidth} selectedId={selectedId} />

      <LayerHandles annotations={annotations} gestureHandlers={gestureHandlers} gestureRef={gestureRef} hoveredId={hoveredId} live={live} transformTarget={transformTarget} />
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
  /** The live colour every `isTerminology` mark is drawn in, overriding its own stored `color` —
   *  see `UserSettings.terminologyColor`. */
  terminologyColor: string;
  /** For the dots that show a mark's other themes (several themes per mark). */
  themes?: { id: string; name: string; color: string }[];
}> = ({ annotations, pageWidth, selectedId, hoveredId, terminologyColor, themes = [] }) => (
  <div className="absolute inset-0 z-1" style={{ pointerEvents: 'none' }}>
    {annotations
      .filter((a) => a.rects?.length)
      .flatMap((a) => [
        // A mark under several themes: a dot per other theme, just above its first line's start.
        (a.themeIds?.length ?? 0) > 1 && (
          <ExtraThemeDots
            key={`${a.id}-themes`}
            themeIds={a.themeIds}
            themes={themes}
            className="absolute -translate-y-full pb-[2px]"
            style={{ left: `${a.rects![0].x * 100}%`, top: `${a.rects![0].y * 100}%`, pointerEvents: 'auto' }}
          />
        ),
        ...a.rects!.map((rect, index) => {
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
                // A terminology mark ignores its own stored colour in favour of the live setting —
                // see `terminologyColor`'s doc comment above.
                backgroundColor: a.isTerminology ? terminologyColor : a.color,
                // Multiply keeps the page's own text legible through the tint, which a flat
                // opaque fill greys out. Muted colours are laid down harder (`highlightOpacity`).
                mixBlendMode: 'multiply',
                opacity: highlightOpacity(a.isTerminology ? terminologyColor : a.color, strong),
                borderRadius: 2
              }}
            />
          );
        })
      ])}
  </div>
);
