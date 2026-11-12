/**
 * Mark backups over HTTP: up to 5 time-spaced backups (see LocalDocumentBackend `keepMarkBackup`),
 * the "document left" checkpoint, and restoring one. A restore is itself a marks save, so the set that was live
 * becomes a backup first and the restore can be undone from the same list.
 */

import { Router } from 'express';
import { catchAsyncErrors } from './asyncRoutes';
import { checkpointMarkBackup, getDocument, listMarkBackups, restoreMarkBackup } from './documentStore';

const router = catchAsyncErrors(Router());

/** `{ backups: [{ id, savedAt, markCount }] }`, newest first. */
router.get('/documents/:id/backups', async (req, res) => {
  res.json({ backups: await listMarkBackups(req.params.id) });
});

/** The reader closed or left the document: `{ kept }`, true when its changed marks were backed up. */
router.post('/documents/:id/backups/checkpoint', async (req, res) => {
  res.json({ kept: await checkpointMarkBackup(req.params.id) });
});

/** `{ meta, annotations }` after the restore; 404 when the document or backup is missing. */
router.post('/documents/:id/backups/:backupId/restore', async (req, res) => {
  const meta = await restoreMarkBackup(req.params.id, req.params.backupId);
  if (!meta) {
    res.status(404).json({ error: 'That backup or document no longer exists.' });
    return;
  }
  const doc = await getDocument(req.params.id);
  console.log(`[Marginalia] restored mark backup ${req.params.backupId} on ${req.params.id}`);
  res.json({ meta, annotations: doc?.annotations ?? [] });
});

export default router;
