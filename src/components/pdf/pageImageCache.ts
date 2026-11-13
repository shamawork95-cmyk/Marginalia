/**
 * Finished page images, kept so a page that comes back into view (the next spread after a turn,
 * the spread before it, a page scrolled past and back) is on screen at once instead of being
 * painted again by pdf.js, which on a scanned page takes a second or more.
 *
 * Keyed by document, page, zoom and device pixel ratio, so a zoom change never shows a stale
 * image. Least recently used images are closed and dropped past MAX_PAGE_IMAGES: at typical zoom
 * one image is several megabytes, so the cache stays small (a few spreads either way).
 */

export const MAX_PAGE_IMAGES = 12;

export function pageImageKey(docKey: string, page: number, scale: number, dpr: number): string {
  return `${docKey}|${page}|${scale.toFixed(4)}|${dpr}`;
}

/** A small LRU of closable images. Generic so it is testable without a DOM. */
export class LruImages<T extends { close?: () => void }> {
  private map = new Map<string, T>();
  constructor(private max = MAX_PAGE_IMAGES) {}

  get(key: string): T | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: T): void {
    const old = this.map.get(key);
    if (old && old !== value) old.close?.();
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const [k, v] = this.map.entries().next().value as [string, T];
      this.map.delete(k);
      v.close?.();
    }
  }

  /** Drops every image of one document (it was closed, or its pages changed). */
  dropDocument(docKey: string): void {
    for (const [k, v] of [...this.map]) {
      if (k.startsWith(`${docKey}|`)) {
        this.map.delete(k);
        v.close?.();
      }
    }
  }

  get size(): number {
    return this.map.size;
  }
}

export const pageImages = new LruImages<ImageBitmap>();
