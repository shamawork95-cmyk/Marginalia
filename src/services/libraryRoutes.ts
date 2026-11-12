/**
 * Library-wide routes added in 2.7.0:
 *
 *   POST /api/motifs/trace                 every passage a motif's words appear in, by document
 *   GET  /api/documents/:id/class-pack     the document with its marks, as one file for a class
 *   POST /api/class-packs                  a class pack, opened as a new document
 *
 * All local: the library is read from and written to this device only.
 */

import express, { Router } from 'express';
import { catchAsyncErrors } from './asyncRoutes';
import { attachOriginal, deleteDocument, getDocument, getOriginal, getSettings, listDocuments, saveDocument, updateDocument } from './documentStore';
import { cleanTerms, documentUnits, traceParagraphs, type MotifDocResult } from '../utils/motifTrace';
import { buildClassPack, parseClassPack } from '../utils/classPack';
import type { Theme } from '../utils/themes';

const router = catchAsyncErrors(Router());

/** `{ terms: string[], docIds?: string[] }` → `{ results, total, truncated }`, documents with hits only. */
router.post('/motifs/trace', express.json({ limit: '1mb' }), async (req, res) => {
  const terms = cleanTerms(Array.isArray(req.body?.terms) ? req.body.terms.filter((t: unknown) => typeof t === 'string') : []);
  if (!terms.length) {
    res.status(400).json({ error: 'Give the motif at least one word to trace.' });
    return;
  }
  const only = Array.isArray(req.body?.docIds) ? new Set<string>(req.body.docIds.filter((d: unknown) => typeof d === 'string')) : null;
  try {
    const results: MotifDocResult[] = [];
    let total = 0;
    let truncated = false;
    for (const meta of await listDocuments()) {
      if (only && !only.has(meta.id)) continue;
      const doc = await getDocument(meta.id);
      if (!doc) continue;
      const { units, location } = documentUnits(doc.text, meta.format, doc.layout);
      const hits = traceParagraphs(units, terms, 300);
      if (hits.length === 300) truncated = true;
      if (!hits.length) continue;
      total += hits.length;
      results.push({ id: meta.id, title: meta.title, format: meta.format, location, hits });
    }
    results.sort((a, b) => b.hits.length - a.hits.length || a.title.localeCompare(b.title));
    res.json({ results, total, truncated });
  } catch (error) {
    console.error('Motif trace failed:', error);
    res.status(500).json({ error: 'The motif could not be traced.' });
  }
});

/** The class pack as a download. `?teacher=` signs it, `?message=` adds a line for the class. */
router.get('/documents/:id/class-pack', async (req, res) => {
  const doc = await getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }
  const original = doc.originalBytes > 0 ? await getOriginal(doc.id) : null;
  const settings = (await getSettings()) ?? {};
  const themes = Array.isArray(settings.activeThemes) ? (settings.activeThemes as Theme[]) : [];
  const body = buildClassPack({
    teacher: typeof req.query.teacher === 'string' ? req.query.teacher.slice(0, 120) : typeof settings.name === 'string' ? settings.name : '',
    message: typeof req.query.message === 'string' ? req.query.message.slice(0, 2000) : undefined,
    document: {
      title: doc.title,
      format: doc.format,
      text: doc.text,
      ...(doc.layout ? { layout: doc.layout } : {}),
      ...(doc.textStyles?.length ? { textStyles: doc.textStyles } : {}),
      ...(original ? { filename: original.filename, original: original.buffer.toString('base64') } : {})
    },
    themes,
    annotations: doc.annotations
  });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(body);
});

/** Opens a pack as a new document: `{ meta, themes, teacher, message, marks }`. */
router.post('/class-packs', express.json({ limit: '100mb' }), async (req, res) => {
  const parsed = parseClassPack(req.body);
  if (parsed.ok === false) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { pack } = parsed;
  const d = pack.document;
  try {
    const meta = await saveDocument({
      title: d.title,
      text: d.text,
      format: d.format,
      filename: d.filename,
      layout: d.layout,
      textStyles: d.textStyles
    });
    if (d.original) {
      const ok = await attachOriginal(meta.id, Buffer.from(d.original, 'base64'), d.filename);
      if (!ok) {
        await deleteDocument(meta.id).catch(() => undefined);
        res.status(500).json({ error: 'The document in this class pack could not be saved on this device.' });
        return;
      }
    }
    const saved = pack.annotations.length ? await updateDocument(meta.id, { annotations: pack.annotations }) : null;
    res.json({
      meta: saved ?? (await listDocuments()).find((m) => m.id === meta.id) ?? meta,
      themes: pack.themes,
      teacher: pack.teacher,
      message: pack.message ?? null,
      marks: pack.annotations.length
    });
  } catch (error) {
    console.error('Class pack import failed:', error);
    res.status(500).json({ error: 'This class pack could not be opened.' });
  }
});

export default router;
