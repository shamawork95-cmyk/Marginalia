/**
 * Run with: npx tsx --test src/components/pdf/InstanceNavigator.test.ts
 *
 * The navigator's whole job is picking the right marks and walking them in reading order. Both
 * are easy to get subtly wrong — a terminology mark also carries a themeId, and creation order is
 * not page order.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingAnnotations } from './InstanceNavigator';
import type { Annotation } from './annotationModel';

const mark = (id: string, page: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ id, page, kind: 'highlight', rects: [{ x: 0, y, w: 0.5, h: 0.02 }], ...extra }) as Annotation;

test('a theme focus takes only that theme, in reading order', () => {
  const annotations = [
    mark('c', 3, 0.1, { themeIds: ['key'] }),
    mark('a', 1, 0.8, { themeIds: ['key'] }),
    mark('b', 1, 0.2, { themeIds: ['key'] }),
    mark('x', 2, 0.5, { themeIds: ['questions'] })
  ];
  assert.deepEqual(
    matchingAnnotations(annotations, {
      kind: 'theme',
      themeId: 'key',
      label: 'Key Concepts',
      color: '#435c52'
    }).map((a) => a.id),
    ['b', 'a', 'c']
  );
});

test('a terminology focus takes flagged marks whatever theme they carry', () => {
  const annotations = [
    mark('t1', 2, 0.3, { isTerminology: true, themeIds: ['key'] }),
    mark('t2', 1, 0.4, { isTerminology: true, themeIds: [] }),
    mark('plain', 1, 0.1, { themeIds: ['key'] })
  ];
  assert.deepEqual(
    matchingAnnotations(annotations, {
      kind: 'terminology',
      label: 'Terminology',
      color: '#8a8578'
    }).map((a) => a.id),
    ['t2', 't1']
  );
});

test('no matches is an empty run, not a crash', () => {
  assert.deepEqual(
    matchingAnnotations([mark('a', 1, 0.1, { themeIds: ['other'] })], {
      kind: 'theme',
      themeId: 'key',
      label: 'Key Concepts',
      color: '#435c52'
    }),
    []
  );
});

// ── Text documents ──────────────────────────────────────────────────────────────────────────

import type { TextMark } from '../../utils/textMarks';

const tmark = (id: string, p: number, start: number, extra: Partial<TextMark> = {}): TextMark => ({
  id, kind: 'highlight', anchor: { paragraphIndex: p, start, end: start + 3 }, themeIds: ['key'], ...extra
});
const keyFocus = { kind: 'theme' as const, themeId: 'key', label: 'Key Concepts', color: '#435c52' };

test('text marks walk in reading order: paragraph, then offset', () => {
  const marks = [tmark('c', 4, 0), tmark('b', 1, 30), tmark('a', 1, 2), tmark('x', 0, 0, { themeIds: ['other'] })];
  assert.deepEqual(matchingAnnotations(marks, keyFocus).map((m) => m.id), ['a', 'b', 'c']);
});

test('a mark over several paragraphs is one stop, at its first range', () => {
  const marks = [tmark('g2', 3, 0, { groupId: 'g' }), tmark('solo', 2, 5), tmark('g1', 1, 10, { groupId: 'g' })];
  assert.deepEqual(matchingAnnotations(marks, keyFocus).map((m) => m.id), ['g1', 'solo']);
});

test('a terminology focus takes flagged text marks', () => {
  const marks = [tmark('t', 2, 0, { isTerminology: true, themeIds: [] }), tmark('plain', 1, 0)];
  assert.deepEqual(
    matchingAnnotations(marks, { kind: 'terminology', label: 'Terminology', color: '#8a8578' }).map((m) => m.id),
    ['t']
  );
});
