/**
 * Local filesystem document backend — the store the app uses for uploaded documents.
 *
 * Everything lives on the machine the app is running on; nothing is uploaded anywhere. In the
 * packaged desktop build the Electron main process points MARGINALIA_STORE_DIR at the OS's
 * per-user application-data directory, so the library follows the user account rather than
 * whatever directory the app happened to be launched from.
 *
 * Layout:
 *   {STORE_ROOT}/documents/{id}.json   metadata + extracted text + annotations
 *   {STORE_ROOT}/originals/{id}{ext}   the raw uploaded file
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  DocumentBackend,
  DocumentMeta,
  SaveDocumentParams,
  StoredDocument,
  ThemeTags,
  UpdateDocumentParams,
  buildMeta,
  countWords,
  isValidId,
  safeExtension
} from './types';

export class LocalDocumentBackend implements DocumentBackend {
  readonly name: string;
  readonly location: string;
  private docsDir: string;
  private originalsDir: string;

  constructor(storeRoot?: string) {
    const root = storeRoot ? path.resolve(storeRoot) : path.join(process.cwd(), '.marginalia-store');
    this.location = root;
    this.docsDir = path.join(root, 'documents');
    this.originalsDir = path.join(root, 'originals');
    this.name = `local disk (${root})`;
  }

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.docsDir, { recursive: true });
    await fs.mkdir(this.originalsDir, { recursive: true });
  }

  private docPath(id: string): string {
    return path.join(this.docsDir, `${id}.json`);
  }

  private async findOriginalPath(id: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(this.originalsDir);
      const match = entries.find((name) => name.startsWith(`${id}.`) || name === id);
      return match ? path.join(this.originalsDir, match) : null;
    } catch {
      return null;
    }
  }

  private async write(doc: StoredDocument): Promise<void> {
    await fs.writeFile(this.docPath(doc.id), JSON.stringify(doc), 'utf-8');
  }

  async saveDocument(params: SaveDocumentParams): Promise<DocumentMeta> {
    await this.ensureDirs();
    const meta = buildMeta(crypto.randomBytes(16).toString('hex'), params);
    await this.write({ ...meta, text: params.text, annotations: [], themeTags: {} });
    return meta;
  }

  async attachOriginal(id: string, original: Buffer, filename?: string): Promise<boolean> {
    if (!isValidId(id)) return false;
    const doc = await this.getDocument(id);
    if (!doc) return false;

    await this.ensureDirs();
    const source = filename || doc.filename;
    await fs.writeFile(path.join(this.originalsDir, `${id}${safeExtension(source)}`), original);
    await this.write({ ...doc, filename: source, originalBytes: original.length });
    return true;
  }

  /**
   * Reads one document, filling in fields that records written by older versions of the app
   * predate. Without this backfill an existing library would come back with `annotations`
   * undefined and crash the viewer the first time it tried to draw them.
   */
  async getDocument(id: string): Promise<StoredDocument | null> {
    if (!isValidId(id)) return null;
    try {
      const raw = JSON.parse(await fs.readFile(this.docPath(id), 'utf-8')) as Partial<StoredDocument>;
      const annotations = Array.isArray(raw.annotations) ? raw.annotations : [];
      // Records written before theme tagging existed have no map; an absent one is simply
      // "nothing tagged yet" rather than an error.
      const themeTags: ThemeTags =
        raw.themeTags && typeof raw.themeTags === 'object' ? (raw.themeTags as ThemeTags) : {};
      return {
        id,
        title: raw.title || 'Untitled Document',
        format: raw.format || 'TXT',
        filename: raw.filename || `${raw.title || 'document'}.txt`,
        wordCount: typeof raw.wordCount === 'number' ? raw.wordCount : countWords(raw.text || ''),
        originalBytes: raw.originalBytes || 0,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
        expiresAt: raw.expiresAt ?? null,
        annotationCount: annotations.length,
        text: raw.text || '',
        annotations,
        themeTags
      };
    } catch {
      return null;
    }
  }

  async getOriginal(id: string): Promise<{ buffer: Buffer; filename: string } | null> {
    if (!isValidId(id)) return null;
    const filePath = await this.findOriginalPath(id);
    if (!filePath) return null;
    try {
      const doc = await this.getDocument(id);
      return { buffer: await fs.readFile(filePath), filename: doc?.filename || path.basename(filePath) };
    } catch {
      return null;
    }
  }

  async listDocuments(): Promise<DocumentMeta[]> {
    await this.ensureDirs();
    const entries = await fs.readdir(this.docsDir);
    const metas: DocumentMeta[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const doc = await this.getDocument(entry.replace(/\.json$/, ''));
      if (!doc) continue;
      const { text, annotations, themeTags, ...meta } = doc;
      metas.push(meta);
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateDocument(id: string, params: UpdateDocumentParams): Promise<DocumentMeta | null> {
    const doc = await this.getDocument(id);
    if (!doc) return null;

    const annotations = params.annotations ?? doc.annotations;
    const updated: StoredDocument = {
      ...doc,
      title: params.title?.trim() ? params.title.trim() : doc.title,
      annotations,
      themeTags: params.themeTags ?? doc.themeTags,
      annotationCount: annotations.length,
      updatedAt: new Date().toISOString()
    };
    await this.write(updated);

    const { text, annotations: _a, themeTags: _t, ...meta } = updated;
    return meta;
  }

  /**
   * Removes a document from disk permanently — both its record and its original file. There is
   * no trash and no tombstone: the library's delete button is meant to actually erase the file
   * from the user's machine, so this unlinks rather than marking anything hidden.
   */
  async deleteDocument(id: string): Promise<boolean> {
    if (!isValidId(id)) return false;
    let deleted = false;
    try {
      await fs.unlink(this.docPath(id));
      deleted = true;
    } catch {
      /* already gone */
    }
    const original = await this.findOriginalPath(id);
    if (original) {
      try {
        await fs.unlink(original);
        deleted = true;
      } catch {
        /* already gone */
      }
    }
    return deleted;
  }

  async sweepExpiredDocuments(): Promise<number> {
    if (!existsSync(this.docsDir)) return 0;
    const now = Date.now();
    let removed = 0;

    const docs = await this.listDocuments();
    const liveIds = new Set<string>();
    for (const meta of docs) {
      // A null `expiresAt` means retention is off for this document and it is kept until the
      // user deletes it themselves.
      if (meta.expiresAt && new Date(meta.expiresAt).getTime() <= now) {
        await this.deleteDocument(meta.id);
        removed++;
      } else {
        liveIds.add(meta.id);
      }
    }

    // Remove originals whose metadata file is already gone, so a delete interrupted halfway
    // through can't leave the originals directory growing invisibly.
    try {
      for (const name of await fs.readdir(this.originalsDir)) {
        if (!liveIds.has(name.split('.')[0])) {
          await fs.unlink(path.join(this.originalsDir, name)).catch(() => {});
        }
      }
    } catch {
      /* originals dir may not exist yet */
    }

    return removed;
  }
}
