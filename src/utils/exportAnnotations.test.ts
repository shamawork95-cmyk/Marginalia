/**
 * Run with: npx tsx --test src/utils/exportAnnotations.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMarkdown, generatePlainText, noteDateLabel, textMarksForExport, type ExportOptions } from './exportAnnotations';
import type { StickyNote } from '../types';

const note = (extra: Partial<StickyNote>): StickyNote => ({
  id: 'n', paragraphIndex: 0, color: 'yellow', title: 'T', content: 'C', author: 'Ann',
  timestamp: 'Just now', themeIds: [], ...extra
});
const options: ExportOptions = { bookTitle: 'B', bookAuthor: 'A', themes: [], format: 'txt', includeQuotes: false };

test('createdAt is preferred and printed as a readable date', () => {
  const n = note({ createdAt: '2026-03-05T14:30:00.000Z', timestamp: 'Mar 5, 2026, 2:30 PM' });
  assert.equal(noteDateLabel(n), 'March 5, 2026');
  assert.match(generatePlainText([n], options), /Date: +March 5, 2026\n/);
  assert.match(generateMarkdown([n], options), /\*\*Author:\*\* Ann \(March 5, 2026\)/);
});

test('a legacy "Just now" note prints no date at all', () => {
  const n = note({});
  assert.equal(noteDateLabel(n), '');
  assert.doesNotMatch(generatePlainText([n], options), /Date:|Just now/);
  assert.doesNotMatch(generateMarkdown([n], options), /Just now|\(\)/);
});

test('a legacy note with a real timestamp string keeps it', () => {
  assert.equal(noteDateLabel(note({ timestamp: 'Mar 5, 2026, 2:30 PM' })), 'Mar 5, 2026, 2:30 PM');
  assert.equal(noteDateLabel(note({ createdAt: 'garbage', timestamp: 'Mar 5, 2026' })), 'Mar 5, 2026');
});

// ── Text-document marks ─────────────────────────────────────────────────────────────────────

import type { TextMark } from './textMarks';

const paras = ['Alpha beta gamma.', 'Delta epsilon.', 'Zeta eta.'];
const tm = (id: string, p: number, start: number, end: number, extra: Partial<TextMark> = {}): TextMark => ({
  id, kind: 'highlight', anchor: { paragraphIndex: p, start, end }, themeIds: [], ...extra
});

test('export entries follow reading order, one per mark, labelled by kind', () => {
  const marks = [
    tm('n', 2, 0, 4, { kind: 'note', title: 'Zeta?', text: 'Look up.', createdAt: '2026-03-05T14:30:00.000Z', quote: 'Zeta' }),
    tm('s', 1, 0, 5, { kind: 'strikeout' }),
    tm('g2', 1, 6, 14, { groupId: 'g', kind: 'underline' }),
    tm('g1', 0, 11, 17, { groupId: 'g', kind: 'underline' }),
    tm('t', 0, 6, 10, { isTerminology: true }),
    tm('q', 0, 0, 5, { kind: 'question' })
  ];
  const entries = textMarksForExport(marks, paras);
  assert.deepEqual(entries.map((e) => [e.id, e.title, e.quote]), [
    ['q', 'Reaction (?)', 'Alpha'],
    ['t', 'Term', 'beta'],
    ['g1', 'Underline', 'gamma. epsilon.'],
    ['s', 'Strikethrough', 'Delta'],
    ['n', 'Zeta?', 'Zeta']
  ]);
  assert.equal(entries[4].content, 'Look up.');
  assert.equal(noteDateLabel(entries[4]), 'March 5, 2026');
});

test('a migrated highlight with no stored quote takes its words from the text', () => {
  const [entry] = textMarksForExport([tm('h', 1, 0, 5)], paras);
  assert.equal(entry.quote, 'Delta');
  assert.equal(entry.title, 'Highlight');
});

test('Markdown prints a highlight as its passage, with no empty note body', () => {
  const md = generateMarkdown(textMarksForExport([tm('h', 0, 6, 10, { createdAt: '2026-03-05T14:30:00.000Z' })], paras), options);
  assert.match(md, /### 1\. Highlight\n/);
  assert.match(md, /> "beta"\n/);
  assert.match(md, /\(March 5, 2026\)/);
  assert.doesNotMatch(md, /> "beta"\n\n\n/);
});

test('plain text prints a strikeout as its passage and skips the empty note block', () => {
  const txt = generatePlainText(textMarksForExport([tm('s', 1, 0, 5, { kind: 'strikeout' })], paras), options);
  assert.match(txt, /1\. Strikethrough\n/);
  assert.match(txt, /"Delta"/);
  assert.doesNotMatch(txt, /Annotation Note:/);
});

test('an untitled text-reader note exports as "Reader Note", like its card; a titled one keeps its title', () => {
  const [untitled, titled] = textMarksForExport(
    [tm('a', 0, 0, 5, { kind: 'note', text: 'Why?' }), tm('b', 1, 0, 5, { kind: 'note', title: 'Mine', text: 'x' })],
    paras
  );
  assert.equal(untitled.title, 'Reader Note');
  assert.equal(titled.title, 'Mine');
  assert.match(generateMarkdown([untitled], options), /### 1\. Reader Note\n/);
});

test('the printable notes page sets each block by its own direction and inlines the font', async () => {
  const { notesPrintHtml } = await import('./exportAnnotations');
  const html = notesPrintHtml(
    [{ id: 'n', paragraphIndex: 0, color: '', title: 'غزل <1>', content: 'A note', author: '', timestamp: '', themeIds: [], quote: 'دل ہی تو ہے', kind: 'highlight' }],
    { bookTitle: 'Ghalib', bookAuthor: 'Reader', themes: [], format: 'pdf', includeQuotes: true },
    'data:font/woff2;base64,AAAA'
  );
  assert.match(html, /@font-face\{font-family:'Noto Nastaliq Urdu';src:url\(data:font\/woff2;base64,AAAA\)/);
  assert.match(html, /<blockquote dir="auto">“دل ہی تو ہے”<\/blockquote>/);
  assert.match(html, /غزل &lt;1&gt;/);
  assert.doesNotMatch(html, /<script/);
});
