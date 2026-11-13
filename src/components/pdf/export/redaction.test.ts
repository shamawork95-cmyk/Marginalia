/**
 * Run with: npx tsx --test src/components/pdf/export/redaction.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blackoutsByPage, exportedNoteText, redactionScale, touchesBlackout } from './redaction';
import type { Annotation } from '../annotationModel';

const mark = (extra: Partial<Annotation>): Annotation => ({ id: 'm', page: 1, kind: 'highlight', color: '#000', themeIds: [], createdAt: '', ...extra });
const words = mark({ id: 'w', kind: 'rect', filled: true, blackout: true, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.03 } });
const oldMask = mark({ id: 'o', kind: 'rect', filled: true, page: 2, box: { x: 0, y: 0, w: 0.1, h: 0.1 } });
const pen = mark({ id: 'p', kind: 'ink', blackout: true, page: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }] });

test('black-outs are found by page: Words and Box, a Mask box from 2.8.0, and freehand', () => {
  const byPage = blackoutsByPage([words, oldMask, pen, mark({ id: 'h', rects: [{ x: 0, y: 0, w: 1, h: 0.1 }] }), mark({ id: 'r', kind: 'rect', box: { x: 0, y: 0, w: 1, h: 1 } })]);
  assert.deepEqual([...byPage].map(([p, list]) => [p, list.map((m) => m.id)]), [
    [1, ['w']],
    [2, ['o']],
    [3, ['p']]
  ]);
});

test('a highlight over blacked-out words loses its quote in a redacted export, keeps the reader’s own note', () => {
  const over = mark({ id: 'h', rects: [{ x: 0.2, y: 0.205, w: 0.1, h: 0.02 }], quote: 'the secret', text: 'my note' });
  const apart = mark({ id: 'a', rects: [{ x: 0.2, y: 0.6, w: 0.1, h: 0.02 }], quote: 'other words' });
  assert.equal(touchesBlackout(over, [words]), true);
  assert.equal(touchesBlackout(apart, [words]), false);
  assert.equal(exportedNoteText(over, [words], true), 'my note');
  assert.equal(exportedNoteText({ ...over, text: undefined }, [words], true), '');
  assert.equal(exportedNoteText(apart, [words], true), 'other words');
  // Without redaction nothing changes.
  assert.equal(exportedNoteText({ ...over, text: undefined }, [words], false), 'the secret');
});

test('the page picture is about 2400 px on its long side', () => {
  assert.equal(Math.round(redactionScale({ width: 595, height: 842 }) * 842), 2400);
  assert.equal(Math.round(redactionScale({ width: 842, height: 595 }) * 842), 2400);
});
