/**
 * How a book looks on the shelf: monograms, sizes, the opening page, the cover, spine cloths and their
 * look, the fitted spine title, and the small drawn pieces (moved verbatim from Bookshelf).
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { documentThumbnail } from '../../utils/documentThumbnail';
import { fetchDocumentText, type StoredDocumentMeta } from '../../utils/documentStorage';

export function monogram(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

export const formatBytes = (bytes: number) =>
  !bytes ? '—' : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Page one's paragraphs. A verbatim paste (a poem) keeps its line breaks and stanza gaps as one
    pre-wrap block; other text is one paragraph per line, whitespace collapsed. */
export function pageParagraphs(text: string, layout?: 'verbatim'): string[] {
  // A page shows ~15 lines of ~45 characters; 1200 is plenty.
  const head = text.slice(0, 1200).replace(/\r\n?/g, '\n');
  if (layout === 'verbatim') return [head.replace(/^\s*\n/, '').trimEnd()].filter(Boolean);
  return head
    .split('\n')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/* The opening paragraphs of a document without a rendered page, set as its page one. One local read
   per book and edit (no network, no AI), kept for the session; a failed read is not kept. */
export const openings = new Map<string, Promise<string[] | null>>();

export function openingParagraphs(doc: StoredDocumentMeta): Promise<string[] | null> {
  const key = `${doc.id}:${doc.updatedAt}`;
  let work = openings.get(key);
  if (!work) {
    work = fetchDocumentText(doc.id).then((text) => {
      const paras = text == null ? null : pageParagraphs(text, doc.layout);
      if (!paras?.length) openings.delete(key);
      return paras?.length ? paras : null;
    });
    openings.set(key, work);
  }
  return work;
}

/** Page one: the rendered first page (PDF, printed HTML), else the document's opening lines set in serif. */
export const DocumentCover: React.FC<{ doc: StoredDocumentMeta; className?: string }> = ({ doc, className = '' }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [paras, setParas] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setParas(null);
    void documentThumbnail(doc).then((dataUrl) => {
      if (cancelled) return;
      setSrc(dataUrl);
      if (!dataUrl) void openingParagraphs(doc).then((p) => !cancelled && setParas(p));
    });
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.updatedAt, doc.format, doc.originalBytes]);

  return (
    <div className={`shelf-page ${className}`}>
      {src ? (
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover object-top bg-white select-none pointer-events-none" />
      ) : (
        paras && (
          <div className="shelf-page-text" data-verbatim={doc.layout === 'verbatim' || undefined}>
            {paras.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )
      )}
      {!src && paras && <span className="shelf-page-folio">1</span>}
    </div>
  );
};

/**
 * Cloth colours for spines: base, ink, and the painted band near the foot. One muted pastel
 * family (low chroma, close in lightness) so the shelf reads as a single quiet set in either
 * theme; the warm near-black ink keeps every title at 4.5:1 or more on base and band
 * (checked in Bookshelf.test.ts).
 */
export const CLOTHS = [
  { name: 'sage', base: '#bcc5b0', ink: '#2a2621', band: '#a3ae95' },
  { name: 'stone', base: '#d3cabb', ink: '#2a2621', band: '#bcb2a1' },
  { name: 'blush', base: '#dfc3ba', ink: '#2a2621', band: '#caa89d' },
  { name: 'clay', base: '#ccb09f', ink: '#2a2621', band: '#b69683' },
  { name: 'mist', base: '#bccacd', ink: '#2a2621', band: '#a2b3b7' },
  { name: 'oat', base: '#e2d7c1', ink: '#2a2621', band: '#cdbfa4' },
  { name: 'heather', base: '#c8c0cc', ink: '#2a2621', band: '#b0a7b6' },
  { name: 'lichen', base: '#aeb5a0', ink: '#2a2621', band: '#969e88' }
] as const;

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type Look = ReturnType<typeof spineLook>;

/** `k` scales the whole book with the stage (1 to MAX_SCALE), so a wide window gets bigger books. */
export function spineLook(doc: StoredDocumentMeta, k = 1) {
  const h = hash(doc.id);
  const cloth = CLOTHS[h % CLOTHS.length];
  // Thicker for longer books: about 34px for an essay, capped at 66px for a long novel.
  const width = Math.round(k * Math.min(66, 30 + Math.sqrt(Math.max(0, doc.wordCount)) / 6));
  // Floored, so no spine is taller than 306 * k (the row's reserved height).
  const height = Math.floor(k * (262 + ((h >> 4) % 5) * 11));
  return { ...cloth, width, height, bandAt: 70 + ((h >> 8) % 14) };
}

/* Books grow with the stage from 760px wide, up to 1.5x (then the shelf is about as wide as the desk
   below it), but never so far that a shelf which fits at 1x would start to scroll: `span` is the
   books' width at 1x, and they may take 90% of the row. 0.05 steps, so a window drag refits titles
   a handful of times, not on every pixel. */
export const MAX_SCALE = 1.5;
export function stageScale(stageWidth: number, rowPadding: number, span: number) {
  const fits = span > 0 ? (0.9 * (stageWidth - rowPadding)) / span : MAX_SCALE;
  return Math.min(MAX_SCALE, Math.max(1, Math.floor(Math.min(stageWidth / 760, fits) * 20) / 20));
}

/** "N% completed", or nothing for a book never opened (`progressPercent` null). */
export const progressLabel = (doc: { progressPercent?: number | null }) =>
  typeof doc.progressPercent === 'number' ? `${Math.round(doc.progressPercent)}% completed` : '';

export const clothVars = (look: Look) =>
  ({ color: look.ink, '--cloth': look.base, '--band': look.band, '--band-at': `${look.bandAt}%` }) as React.CSSProperties;

export const monthLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

export type ShelfItem = { kind: 'book'; doc: StoredDocumentMeta } | { kind: 'bookend'; key: string; label: string };

/* ── Spine titles ──────────────────────────────────────────────────────────
   The reference sets each spine title on a canvas: the largest size from 7px up
   to about half the spine's thickness at which the title wraps into the columns
   the spine has room for (1, 2, or 3 when 40px or thicker), lines balanced;
   failing that, the smallest size with the last column cut at a word and "…". */
export let measureCtx: CanvasRenderingContext2D | null = null;

export function fitSpineTitle(title: string, breadth: number, length: number, family: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  if (!ctx || length <= 0) return null;
  const width = (text: string) => ctx.measureText(text).width;
  const columnsFor = (size: number) => Math.max(1, Math.min(breadth >= 40 ? 3 : 2, Math.floor((breadth - 4) / (size * 1.08))));
  const words = title.trim().split(/\s+/).filter(Boolean);
  const wrap = (max: number) => {
    const out: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && width(next) > max) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  // Narrowest measure that still needs no more columns, so two columns come out even.
  const balance = (n: number) => {
    let lo = 0;
    let hi = length;
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      if (wrap(mid).length <= n) hi = mid;
      else lo = mid;
    }
    return wrap(hi);
  };

  for (let size = Math.max(7, Math.min(16, breadth * 0.52)); size >= 7; size -= 0.5) {
    ctx.font = `600 ${size}px ${family}`;
    const n = columnsFor(size);
    const lines = wrap(length);
    if (lines.length <= n && lines.every((l) => width(l) <= length)) {
      return { size, lines: lines.length > 1 ? balance(lines.length) : lines };
    }
  }

  ctx.font = `600 7px ${family}`;
  const n = columnsFor(7);
  const clip = (text: string) => {
    if (width(text) <= length) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (width(`${text.slice(0, mid).trimEnd()}…`) <= length) lo = mid;
      else hi = mid - 1;
    }
    return `${text.slice(0, lo).trimEnd()}…`;
  };
  const all = wrap(length);
  const lines = all.slice(0, n);
  if (all.length > n) {
    const last = lines[n - 1].split(' ');
    while (last.length > 1 && width(`${last.join(' ')} …`) > length) last.pop();
    lines[n - 1] =
      last.length > 1 || width(`${last[0]} …`) <= length ? `${last.join(' ').replace(/[\s,;:–—-]+$/, '')} …` : last[0];
  }
  return { size: 7, lines: lines.map(clip) };
}

export const SpineTitle: React.FC<{ title: string; breadth: number; height: number }> = ({ title, breadth, height }) => {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ size: number; lines: string[] } | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    let alive = true;
    // The title box changes size with the spine (`height`, the stage scale) and when the webfont arrives.
    const run = () => alive && setFit(fitSpineTitle(title, breadth, box.clientHeight - 2, getComputedStyle(text).fontFamily));
    run();
    void document.fonts?.ready.then(run);
    return () => {
      alive = false;
    };
  }, [title, breadth, height]);

  return (
    <span ref={boxRef} className="shelf-spine-title">
      <span ref={textRef} style={{ fontSize: fit?.size ?? 13 }}>
        {fit
          ? fit.lines.map((line, i) => (
              <React.Fragment key={i}>
                {i > 0 && <br />}
                {line}
              </React.Fragment>
            ))
          : title}
      </span>
    </span>
  );
};

/** What a spine shows, on the shelf and in flight. */
export const SpineFace: React.FC<{ doc: StoredDocumentMeta; look: Look }> = ({ doc, look }) => (
  <>
    {doc.annotationCount > 0 && <span className="shelf-ribbon" aria-hidden="true" />}
    <SpineTitle title={doc.title} breadth={look.width - 6} height={look.height} />
    <span className="shelf-spine-foot">
      <span className="shelf-spine-format">{doc.format}</span>
      <span className="shelf-spine-badge">{monogram(doc.title)}</span>
    </span>
  </>
);

/** A short hand-drawn arrow, the shelf's pointer. */
export const Doodle: React.FC<{ className?: string; d: string; viewBox: string; style?: React.CSSProperties; show?: boolean }> = ({
  className,
  d,
  viewBox,
  style,
  show
}) => (
  <svg viewBox={viewBox} style={style} data-show={show ? '' : undefined} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d={d} />
  </svg>
);
