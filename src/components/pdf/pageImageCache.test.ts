/**
 * Run with: npx tsx --test src/components/pdf/pageImageCache.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruImages, pageImageKey } from './pageImageCache';

const image = (log: string[], name: string) => ({ name, close: () => log.push(name) });

test('keys tell documents, pages, zooms and screens apart', () => {
  const keys = new Set([pageImageKey('a', 1, 1.25, 2), pageImageKey('a', 2, 1.25, 2), pageImageKey('a', 1, 1.5, 2), pageImageKey('a', 1, 1.25, 1), pageImageKey('b', 1, 1.25, 2)]);
  assert.equal(keys.size, 5);
});

test('the least recently used image is closed and dropped past the limit', () => {
  const closed: string[] = [];
  const lru = new LruImages<{ name: string; close: () => void }>(2);
  lru.set('1', image(closed, 'one'));
  lru.set('2', image(closed, 'two'));
  lru.get('1'); // used again: now the newest
  lru.set('3', image(closed, 'three'));
  assert.deepEqual(closed, ['two']);
  assert.equal(lru.get('2'), undefined);
  assert.equal(lru.get('1')?.name, 'one');
  assert.equal(lru.size, 2);
});

test('replacing an image closes the old one; a document can be dropped whole', () => {
  const closed: string[] = [];
  const lru = new LruImages<{ name: string; close: () => void }>(5);
  lru.set('a|1', image(closed, 'old'));
  lru.set('a|1', image(closed, 'new'));
  lru.set('b|1', image(closed, 'other'));
  assert.deepEqual(closed, ['old']);
  lru.dropDocument('a');
  assert.deepEqual(closed, ['old', 'new']);
  assert.equal(lru.get('b|1')?.name, 'other');
});
