/**
 * Importing a standalone HTML document (a `.htm`/`.html` book, typically an OCR export or a
 * "save page as" capture) into something Marginalia can both read and annotate.
 *
 * The annotating workspace only understands paginated PDFs, because every mark's geometry is
 * stored as a fraction of a page box. HTML has no pages. Rather than build a second annotation
 * model for reflowable text — which would mean marks that drift whenever the window resizes —
 * the import paginates the document once, at the moment it is added, by printing it through
 * Chromium. From then on it is an ordinary PDF as far as the rest of the app is concerned, so
 * highlights, ink, sticky notes, theme colours and PDF export all work with no special cases.
 *
 * This module does the preparation; the actual print happens server-side (see
 * `POST /api/documents/from-html` in `server.ts`), which is where the Electron renderer lives.
 */

/** Extensions we are willing to inline alongside an HTML file, and what to label them as. */
const ASSET_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  css: 'text/css',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf'
};

export function isHtmlFile(file: File): boolean {
  return /\.x?html?$/i.test(file.name);
}

export function isInlinableAsset(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return ext in ASSET_MIME_TYPES;
}

/**
 * Decodes the file's bytes to a string using the encoding the document itself declares.
 *
 * This is not pedantry. Books exported by OCR tools are routinely WINDOWS-1252, and reading one
 * as UTF-8 turns every em dash, curly quote and accented name into a replacement character —
 * in the extracted text the AI analyses, in the search index, and in the printed PDF. The
 * declaration is found by decoding the head as Latin-1 first, which is safe because the meta
 * tag itself is always plain ASCII whatever the rest of the document is.
 */
export function decodeHtmlBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);

  // A byte-order mark outranks any declaration inside the document.
  if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(view.subarray(3));
  }

  const head = new TextDecoder('windows-1252').decode(view.subarray(0, 4096));
  const declared =
    head.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/i)?.[1] ||
    head.match(/charset\s*=\s*["']?\s*([a-z0-9_-]+)/i)?.[1];

  if (declared) {
    try {
      return new TextDecoder(declared.toLowerCase()).decode(view);
    } catch {
      // An unknown or misspelled label falls through to the sniffing below.
    }
  }

  // Nothing declared. Prefer UTF-8, but only if the bytes really are valid UTF-8 — `fatal`
  // makes the decoder say so instead of silently producing replacement characters, at which
  // point Windows-1252 is the overwhelmingly likely alternative for a Western-language book.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    return new TextDecoder('windows-1252').decode(view);
  }
}

/** Reads a file's bytes as a `data:` URI so it can be embedded with no filesystem access. */
async function toDataUri(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = ASSET_MIME_TYPES[ext] || file.type || 'application/octet-stream';
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Chunked so a multi-megabyte image does not blow the argument limit of `String.fromCharCode`.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Keys an asset by its bare filename, lowercased, which is how references are matched. */
function assetKey(reference: string): string {
  const withoutQuery = reference.split(/[?#]/)[0];
  const name = withoutQuery.split('/').pop() || withoutQuery;
  try {
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}

/**
 * Removes anything executable.
 *
 * The prepared HTML is loaded into an offscreen Chromium window with JavaScript enabled, which
 * it needs in order to report when layout has settled. Book files are not trusted input, so the
 * document's own scripts, event handlers and `javascript:` links come out before it gets there.
 */
function stripScripting(doc: Document): void {
  doc.querySelectorAll('script, noscript, iframe, object, embed').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
}

/** Rewrites `url(...)` references inside a stylesheet to their inlined equivalents. */
function inlineCssUrls(css: string, assets: Map<string, string>): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote, ref) => {
    const replacement = assets.get(assetKey(ref));
    return replacement ? `url("${replacement}")` : whole;
  });
}

/**
 * Points every image, stylesheet and background at an inlined copy of the sibling file it
 * refers to.
 *
 * A book saved as a single `.htm` almost always keeps its images in a folder beside it, and a
 * browser file picker hands us detached `File` objects with no directory to resolve against.
 * Matching on bare filename is therefore the only join available — and it is good enough,
 * because these captures reference their assets by plain relative names. References with no
 * matching file are left alone rather than blanked, so a document that does have working
 * absolute URLs keeps them.
 */
async function inlineAssets(doc: Document, siblings: File[]): Promise<void> {
  const usable = siblings.filter((file) => isInlinableAsset(file));
  if (usable.length === 0) return;

  const assets = new Map<string, string>();
  for (const file of usable) {
    assets.set(assetKey(file.name), await toDataUri(file));
  }

  doc.querySelectorAll('img[src], input[type="image"][src]').forEach((el) => {
    const replacement = assets.get(assetKey(el.getAttribute('src') || ''));
    if (replacement) el.setAttribute('src', replacement);
  });
  doc.querySelectorAll('img[srcset], source[srcset]').forEach((el) => el.removeAttribute('srcset'));
  doc.querySelectorAll('image[href]').forEach((el) => {
    const replacement = assets.get(assetKey(el.getAttribute('href') || ''));
    if (replacement) el.setAttribute('href', replacement);
  });

  // External stylesheets become inline <style> blocks, since a data: href on a <link> is
  // blocked in some contexts and inlining lets their own url() references be rewritten too.
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet" i][href]'))) {
    const file = usable.find((f) => assetKey(f.name) === assetKey(link.getAttribute('href') || ''));
    if (!file) continue;
    const style = doc.createElement('style');
    style.textContent = inlineCssUrls(await file.text(), assets);
    link.replaceWith(style);
  }

  doc.querySelectorAll('style').forEach((el) => {
    el.textContent = inlineCssUrls(el.textContent || '', assets);
  });
  doc.querySelectorAll('[style]').forEach((el) => {
    el.setAttribute('style', inlineCssUrls(el.getAttribute('style') || '', assets));
  });
}

/** Elements that end the current paragraph when text extraction walks into them. */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'CAPTION', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR',
  'UL'
]);

/**
 * Pulls readable text out of the document, one paragraph per block element.
 *
 * The blank-line separation matters more than it looks: the reader, the inspection panel and
 * the thematic-analysis prompt all index paragraphs by splitting this string on blank lines,
 * so what counts as a paragraph here is what the AI's citations will refer to. As in the PDF
 * parser, no page dividers or headings-as-markers are injected, because an extra block would
 * shift every index after it out of sync between the AI's count and the rendered document.
 */
export function extractHtmlText(doc: Document): string {
  const paragraphs: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const joined = current.join('').replace(/\s+/g, ' ').trim();
    if (joined) paragraphs.push(joined);
    current = [];
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current.push(node.nodeValue || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = (node as Element).tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD') return;

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) flush();
    node.childNodes.forEach(walk);
    if (isBlock) flush();
  };

  if (doc.body) walk(doc.body);
  flush();
  return paragraphs.join('\n\n');
}

/** The document's own title, falling back to its first heading and then to the filename. */
function resolveTitle(doc: Document, fallback: string): string {
  const declared = doc.title?.trim();
  if (declared) return declared;
  const heading = doc.querySelector('h1, h2')?.textContent?.trim();
  if (heading) return heading.replace(/\s+/g, ' ').slice(0, 120);
  return fallback;
}

/**
 * The body text size the document actually reads at, in points, or null when it does not set
 * absolute sizes.
 *
 * Used only to pick a sensible column width below. OCR exports assign a `.fontN` class per
 * size found on the scanned page, most of which appear once on a heading; the size that
 * matters is whichever class the bulk of the prose uses, so candidates are weighted by how
 * often the class is referenced rather than by how many rules define them.
 */
function dominantBodyPointSize(html: string): number | null {
  const sizesByClass = new Map<string, number>();
  const rulePattern = /\.([A-Za-z0-9_-]+)\s*\{[^}]*?\bfont(?:-size)?\s*:[^;}]*?([\d.]+)pt/gi;
  for (const match of html.matchAll(rulePattern)) {
    sizesByClass.set(match[1], parseFloat(match[2]));
  }
  if (sizesByClass.size === 0) return null;

  const weights = new Map<number, number>();
  const usagePattern = /class\s*=\s*["']?([A-Za-z0-9_ -]+)["']?/gi;
  for (const match of html.matchAll(usagePattern)) {
    for (const name of match[1].split(/\s+/)) {
      const size = sizesByClass.get(name);
      if (size) weights.set(size, (weights.get(size) || 0) + 1);
    }
  }
  if (weights.size === 0) return null;

  let best: number | null = null;
  let bestWeight = 0;
  for (const [size, weight] of weights) {
    // Ties break towards the smaller size: body copy is never the largest size on the page.
    if (weight > bestWeight || (weight === bestWeight && best !== null && size < best)) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

/**
 * The size body text should end up at, in points.
 *
 * Scanned books are captured at whatever size the printed page happened to use — commonly 9–11pt,
 * which is comfortable in the hand at a paperback's page size but small on screen once the text
 * has been re-set onto A4. Everything is scaled so the prose lands here instead.
 */
const TARGET_BODY_PT = 17;

/**
 * Sizes at or above this are display type — a chapter opener, the title on a cover — and are
 * already large enough. Scaling them along with the body copy is what makes a title overflow its
 * line, so they are left exactly as the document set them.
 */
const DISPLAY_PT_THRESHOLD = 20;

/**
 * Enlarges the absolute type sizes a document sets, so its prose reads at a sensible size.
 *
 * Rewriting the document's OWN values is the only thing that works here. An OCR export gives
 * every run of text a class with an explicit `font-size` in points, and those rules beat anything
 * set on an ancestor — so simply setting a comfortable size on the body has no effect at all on
 * the text the reader is actually looking at.
 */
function scaleTypography(css: string, factor: number): string {
  if (factor <= 1.01) return css;
  return css.replace(/([\d.]+)pt/g, (whole, value) => {
    const size = parseFloat(value);
    if (!Number.isFinite(size) || size >= DISPLAY_PT_THRESHOLD) return whole;
    return `${(size * factor).toFixed(2)}pt`;
  });
}

/**
 * A stylesheet appended after the document's own, shaping it into something that reads like a
 * book rather than like a printed web page.
 *
 * The column width is in `em` of the body's real size, so it holds a comfortable measure of
 * roughly 70 characters whatever size the source set. Both halves of that matter and they pull
 * against each other: type large enough to read fills the page faster, and a column wide enough
 * to fill the page runs the lines too long. Letting the text span the full width of A4 gives ~95
 * characters a line, which is legible but exhausting, and which no reader would choose.
 *
 * Horizontal rules collapse to nothing. An OCR export emits one between every pair of scanned
 * pages, and an earlier version of this turned each into a forced page break so the PDF's
 * pagination would match the printed book's. That was a bad trade: a paperback page holds well
 * under half an A4, so it produced two hundred pages that were each more than half empty, set in
 * type that had shrunk to fit a column occupying under two-thirds of the paper. Letting the text
 * flow continuously fills the page, at the cost of page numbers that are the file's own rather
 * than the printed book's.
 */
function printStylesheet(bodyPt: number): string {
  return `
html, body { background: #fff; }
body {
  margin: 0;
  font-size: ${bodyPt.toFixed(2)}pt;
  line-height: 1.5;
  color: #14110f;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.marginalia-import-body {
  max-width: 29em;
  margin: 0 auto;
  font-size: ${bodyPt.toFixed(2)}pt;
}
p { margin: 0 0 0.6em; orphans: 3; widows: 3; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
img, svg, video {
  max-width: 100% !important;
  max-height: 96vh;
  height: auto !important;
  /* Both caps can bind at once on a small page; contain keeps the aspect ratio when they do. */
  object-fit: contain;
}
table { max-width: 100%; border-collapse: collapse; }
pre { white-space: pre-wrap; word-wrap: break-word; }
/* Scanned page boundaries: a break in the flow, drawn as nothing at all. */
hr { border: 0; height: 0; margin: 0; }
/* Empty paragraphs are OCR artefacts and would otherwise ladder blank lines down the page. */
p:empty { display: none; }
`.trim();
}

export interface PreparedHtmlDocument {
  title: string;
  /** Extracted prose, blank-line separated, for search and thematic analysis. */
  text: string;
  /** Self-contained HTML with assets inlined, ready to be printed to PDF. */
  printableHtml: string;
  /** How many assets were found and embedded, so the UI can say what it did. */
  inlinedAssets: number;
}

/**
 * Turns a `.htm`/`.html` file and whatever sibling files came with it into extracted text plus
 * a self-contained, print-ready HTML document.
 */
export async function prepareHtmlDocument(
  file: File,
  siblings: File[] = []
): Promise<PreparedHtmlDocument> {
  const raw = decodeHtmlBytes(await file.arrayBuffer());
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  if (!doc.body) {
    throw new Error('That HTML file could not be parsed as a document.');
  }

  stripScripting(doc);

  const inlinable = siblings.filter((f) => f !== file && isInlinableAsset(f));
  await inlineAssets(doc, inlinable);

  const fallbackTitle = file.name.replace(/\.[^/.]+$/, '');
  const title = resolveTitle(doc, fallbackTitle);
  const text = extractHtmlText(doc);
  if (!text.trim()) {
    throw new Error('No readable text was found in that HTML file.');
  }

  // How much the document's own type has to grow to read comfortably. A document that already
  // sets a sensible size, or that sets none at all, is left alone.
  const sourcePt = dominantBodyPointSize(raw);
  const scale = sourcePt ? Math.min(Math.max(TARGET_BODY_PT / sourcePt, 1), 2) : 1;
  if (scale > 1.01) {
    doc.querySelectorAll('style').forEach((el) => {
      el.textContent = scaleTypography(el.textContent || '', scale);
    });
    doc.querySelectorAll('[style]').forEach((el) => {
      el.setAttribute('style', scaleTypography(el.getAttribute('style') || '', scale));
    });
  }

  // The body's children move into a wrapper so the reading column can be constrained without
  // overriding whatever the document already sets on <body> itself.
  const wrapper = doc.createElement('div');
  wrapper.className = 'marginalia-import-body';
  while (doc.body.firstChild) wrapper.appendChild(doc.body.firstChild);
  doc.body.appendChild(wrapper);

  const style = doc.createElement('style');
  style.textContent = printStylesheet(sourcePt ? sourcePt * scale : TARGET_BODY_PT);
  doc.head.appendChild(style);

  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  doc.head.prepend(charset);

  // The Electron renderer waits for this flag before printing, so that images finish decoding
  // and lay out at their real size first. Without it the render either prints early or stalls
  // for the renderer's full timeout on every import.
  const ready = doc.createElement('script');
  ready.textContent =
    'if (document.readyState === "complete") { window.__marginaliaLayoutReady = true; } ' +
    'else { window.addEventListener("load", function () { window.__marginaliaLayoutReady = true; }); }';
  doc.body.appendChild(ready);

  return {
    title,
    text,
    printableHtml: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
    inlinedAssets: inlinable.length
  };
}
