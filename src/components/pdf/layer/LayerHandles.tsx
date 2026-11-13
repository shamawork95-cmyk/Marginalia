/**
 * The selected mark's move and resize handles, and the passage a hovered note or reaction was made
 * about, lit up on its page (moved verbatim from AnnotationLayer).
 */

import React from 'react';
import {
  Annotation,
  FractionRect,
  annotationBounds,
  isReaction,
  rectStyle
} from '../annotationModel';
import { GestureMode } from './layerHelpers';

export interface LayerHandlesProps {
  annotations: Annotation[];
  gestureHandlers: (a: Annotation, mode: GestureMode) => { onPointerDown: (e: React.PointerEvent) => void; };
  gestureRef: React.RefObject<{ id: string; mode: GestureMode; startX: number; startY: number; origin: Annotation; originBounds: FractionRect; moved: boolean; }>;
  hoveredId: string;
  live: (a: Annotation) => Annotation;
  transformTarget: Annotation;
}

export const LayerHandles: React.FC<LayerHandlesProps> = ({ annotations, gestureHandlers, gestureRef, hoveredId, live, transformTarget }) => (
  <>
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

      {/* The passage a hovered note or reaction was made about, lit up on its own page. */}
      {annotations
        .filter((a) => (a.kind === 'note' || isReaction(a.kind)) && hoveredId === a.id && a.anchorRects?.length)
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
  </>
);
