/**
 * Run with: npx tsx --test src/hooks/usePlainTextAnnotations.test.ts
 *
 * Leaving a text document: the pending edit is written, then a mark backup of the visit is
 * checkpointed, exactly like the PDF workspace.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTextAnnotationSession } from './textAnnotationSession';
import { closeTextSession } from './usePlainTextAnnotations';

function setup(saveOk = true) {
  const events: string[] = [];
  const session = createTextAnnotationSession({
    load: async () => ({ annotations: [] }),
    save: async () => {
      events.push('save');
      return saveOk;
    },
    delayMs: 60_000
  });
  return { session, events };
}

test('closing a text session writes the pending edit, then checkpoints a backup', async () => {
  const { session, events } = setup();
  await session.load();
  session.addMarks([{ paraIdx: 0, start: 0, end: 5 }], { kind: 'highlight', color: '#f00', themeIds: [] }, ['Alpha beta.']);
  await closeTextSession(session, async () => {
    events.push('checkpoint');
    return true;
  });
  assert.deepEqual(events, ['save', 'checkpoint']);
});

test('no checkpoint when the last save failed', async () => {
  const { session, events } = setup(false);
  await session.load();
  session.addMarks([{ paraIdx: 0, start: 0, end: 5 }], { kind: 'highlight', color: '#f00', themeIds: [] }, ['Alpha beta.']);
  await closeTextSession(session, async () => {
    events.push('checkpoint');
    return true;
  });
  assert.deepEqual(events, ['save']);
});
