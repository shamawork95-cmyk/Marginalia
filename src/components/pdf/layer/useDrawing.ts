/**
 * Drawing a new mark on the page: the pointer down, move and up of every drawing tool (pen, shapes,
 * lines, brackets, area highlight, mask, note, text box) (moved verbatim from AnnotationLayer).
 */

import React from 'react';
import { createAreaHighlight } from '../../../utils/areaMark';
import {
  Annotation,
  BOX_KINDS,
  BracketSide,
  DEFAULT_NOTE_SIZE,
  FractionPoint,
  FractionRect,
  LINE_KINDS,
  NoteStyle,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont,
  boxFromPoints,
  constrainToShape,
  newAnnotationId,
  pointToFraction
} from '../annotationModel';
import { DEFAULT_WEIGHT, DEFAULT_BRACKET_WIDTH } from './layerHelpers';

export interface UseDrawingDeps {
  activeColor: string;
  activeThemeIds: string[];
  draftEnd: FractionPoint;
  draftStart: FractionPoint;
  drawingRef: React.RefObject<boolean>;
  onCreate: (annotation: Annotation) => void;
  onEdit: (id: string) => void;
  pageBox: () => DOMRect | null;
  pageNumber: number;
  setDraftEnd: React.Dispatch<React.SetStateAction<FractionPoint>>;
  setDraftStart: React.Dispatch<React.SetStateAction<FractionPoint>>;
  setDraftStroke: React.Dispatch<React.SetStateAction<FractionPoint[]>>;
  tool: PdfTool;
  toolBracketSide: BracketSide;
  toolNoteStyle: NoteStyle;
  toolStrokeStyle: StrokeStyle;
  toolTextAlign: TextAlign;
  toolTextBold: boolean;
  toolTextFont: TextFont;
  toolTextItalic: boolean;
  toolTextSize: number;
  toolWeight: number;
}

export function useDrawing(deps: UseDrawingDeps) {
  const { activeColor, activeThemeIds, draftEnd, draftStart, drawingRef, onCreate, onEdit, pageBox, pageNumber, setDraftEnd, setDraftStart, setDraftStroke, tool, toolBracketSide, toolNoteStyle, toolStrokeStyle, toolTextAlign, toolTextBold, toolTextFont, toolTextItalic, toolTextSize, toolWeight } = deps;

  const base = (kind: Annotation['kind']) => ({
    id: newAnnotationId(),
    page: pageNumber,
    kind,
    color: activeColor,
    themeIds: activeThemeIds,
    createdAt: new Date().toISOString()
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Left button only. A right-click with the Note tool dropped a note, and with a drawing tool
    // started a stroke that then had no matching release.
    if (e.button !== 0) return;
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

    if (tool === 'ink' || tool === 'maskPen' || tool === 'mask' || tool === 'area' || BOX_KINDS.includes(tool as never) || LINE_KINDS.includes(tool as never)) {
      drawingRef.current = true;
      // Capture keeps the drag following the pointer when it leaves the page box, which would
      // otherwise truncate the mark at the edge.
      e.currentTarget.setPointerCapture(e.pointerId);
      if (tool === 'ink' || tool === 'maskPen') setDraftStroke([point]);
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

    if (tool === 'ink' || tool === 'maskPen') {
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

    if (tool === 'mask' && draftStart) {
      // A solid box over whatever was dragged across (see PdfTool's doc comment).
      const box = pageBox();
      const to = box ? pointToFraction(e.clientX, e.clientY, box) : draftEnd ?? draftStart;
      if (Math.hypot(to.x - draftStart.x, to.y - draftStart.y) > 0.01) {
        onCreate({ ...base('rect'), box: boxFromPoints(draftStart, to), filled: true, weight: 0, blackout: true });
      }
      setDraftStart(null);
      setDraftEnd(null);
      return;
    }

    if (tool === 'ink' || tool === 'maskPen') {
      setDraftStroke((points) => {
        // A tap with the pen is a mis-click, not a one-point drawing.
        if (points && points.length > 1) {
          onCreate({
            ...base('ink'),
            points,
            weight: toolWeight ?? DEFAULT_WEIGHT,
            strokeStyle: toolStrokeStyle,
            // Black it out, freehand: an opaque stroke to blot content out.
            ...(tool === 'maskPen' && { blackout: true as const })
          });
        }
        return null;
      });
      return;
    }

    if (tool === 'area' && draftStart) {
      // A figure, a table, a scan: stored as an ordinary highlight with one rect (see areaMark).
      // The release point is the corner, even when no move event came between press and release.
      const box = pageBox();
      const to = box ? pointToFraction(e.clientX, e.clientY, box) : draftEnd ?? draftStart;
      const mark = createAreaHighlight(
        { page: pageNumber, from: draftStart, to, color: activeColor, themeIds: activeThemeIds },
        { now: new Date().toISOString(), newId: newAnnotationId }
      );
      if (mark) onCreate(mark);
      setDraftStart(null);
      setDraftEnd(null);
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

  return { bracketBoxFrom, finishDrag, handlePointerDown, handlePointerMove };
}
