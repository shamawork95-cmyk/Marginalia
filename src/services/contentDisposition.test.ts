/**
 * Run with: npx tsx --test src/services/contentDisposition.test.ts
 *
 * Download headers for file names Node would otherwise refuse (curly quotes, Urdu).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { contentDisposition } from './contentDisposition';

const settable = (value: string) => {
  const res = new http.ServerResponse(new http.IncomingMessage(null as never));
  res.setHeader('Content-Disposition', value);
  return true;
};

test('a curly apostrophe or an Urdu name makes a header Node accepts', () => {
  for (const name of ['Shelley’s Ozymandias.pdf', 'کلیات اقبال.pdf', 'The "Waste" Land — draft.pdf', '“Quoted” name.epub', 'plain.txt']) {
    assert.equal(settable(contentDisposition('attachment', name)), true, name);
  }
});

test('the real name travels percent-encoded; the fallback is ASCII', () => {
  const h = contentDisposition('inline', 'Ghalib’s غزل.pdf');
  assert.match(h, /^inline; filename="Ghalib's _+\.pdf"; filename\*=UTF-8''/);
  const encoded = h.split("UTF-8''")[1];
  assert.equal(decodeURIComponent(encoded), 'Ghalib’s غزل.pdf');
});

test('quotes, backslashes and control characters cannot break the header', () => {
  const h = contentDisposition('attachment', 'a"b\\c\r\nd.pdf');
  assert.match(h, /filename="abcd\.pdf"/);
  assert.equal(contentDisposition('attachment', '   '), `attachment; filename="document"; filename*=UTF-8''document`);
});

test('each name round-trips through filename* exactly', () => {
  for (const name of ['Shelley’s Ozymandias.pdf', 'کلیات اقبال.pdf', 'The "Waste" Land — draft.pdf']) {
    const h = contentDisposition('attachment', name);
    assert.equal(decodeURIComponent(h.split("UTF-8''")[1]), name);
    assert.doesNotMatch(h.split('; filename*=')[0], /[^ -~]/);
  }
});
