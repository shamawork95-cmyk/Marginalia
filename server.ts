import "dotenv/config";
import express from "express";
import path from "path";
import {
  saveDocument,
  attachOriginal,
  getDocument,
  getOriginal,
  listDocuments,
  updateDocument,
  deleteDocument,
  startDocumentSweeper,
  setStoreDirectory,
  getBackend,
  getSettings,
  saveClientSettings,
  editPdfPages,
  checkpointPendingMarkBackups,
  RETENTION_DAYS
} from "./src/services/documentStore";
import { insertBlankPages, removePdfPage, PageEditError } from "./src/services/pdfPages";
import { sanitizeImportHtml } from "./src/services/htmlSanitize";
import { publicSettings, nextReadingProgress, cleanTitle } from "./src/services/storage/types";
import { documentParamsFromBody } from "./src/services/documentInput";
import geminiConfigRouter from "./src/services/geminiConfig";
import markBackupRouter from "./src/services/markBackupRoutes";
import libraryRouter from "./src/services/libraryRoutes";
import { contentDisposition } from "./src/services/contentDisposition";
import { catchAsyncErrors, jsonErrorHandler } from "./src/services/asyncRoutes";
import { setAiEnabled } from "./src/services/aiGate";
import { wordWindow, markSearchHits } from "./searchSnippet";

/**
 * Re-exported for the desktop shell, which owns the folder picker and calls this to re-point the
 * store after the user chooses a new location. Without the re-export it is not on the bundled
 * module's surface and the change-folder action fails at runtime.
 */
export { setStoreDirectory };

/** The desktop shell calls this after the exit flush: mark backups for changes the 10-minute window skipped. */
export { checkpointPendingMarkBackups };

/** The desktop shell passes the saved AI opt-in here (electron/aiSetting.cjs). Off until it does. */
export { setAiEnabled };

// Every route's thrown error or rejected promise reaches `jsonErrorHandler` (see asyncRoutes).
const app = catchAsyncErrors(express());

/**
 * The desktop build passes PORT=0 so the OS assigns a free port — a fixed one would refuse to
 * start whenever another copy of the app (or a stray dev server) already held 3001.
 */
const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 3001;

/**
 * Rejects API requests that did not come from the app itself.
 *
 * The server listens only on 127.0.0.1, which keeps it off the network, but "local" is not the
 * same as "private": any page open in the user's browser can issue requests to localhost, and a
 * DNS-rebinding attack can make a remote site appear to be one. Neither is hypothetical for an
 * app whose API can list, read and permanently DELETE the user's documents.
 *
 * Two cheap checks close that off without touching the app's own traffic:
 *
 *   - `Origin`: same-origin requests from the app either omit it or send this server's own
 *     origin. Any other value is a cross-site caller and is refused.
 *   - `Host`: rebinding works by resolving an attacker-controlled hostname to 127.0.0.1, so the
 *     request arrives carrying that hostname. Requiring a loopback Host defeats it.
 *
 * What this does NOT defend against is another program already running on the same machine,
 * which can simply speak to the port directly. Guarding that needs a per-launch secret shared
 * with the client, and is worth doing if the threat model ever includes untrusted local software.
 */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

app.use("/api", (req, res, next) => {
  if (!isLoopbackHost(req.headers.host)) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    if (!isLoopbackHost(originHost)) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }
  }

  next();
});

/**
 * One JSON parser, sized for the largest body any route takes.
 *
 * Per-route `express.json()` limits are dead code behind a global one: this middleware runs
 * first, sets `req._body`, and every later parser no-ops. So the 50mb on document creation, the
 * 200mb on HTML import and the 25mb on annotations were all silently capped at 10mb, and
 * importing a large book failed with an unexplained 413. The server listens on loopback only and
 * refuses cross-site callers, so the ceiling is a practical one rather than a security boundary.
 */
app.use(express.json({ limit: "200mb" }));

// Health check endpoint
/** Gemini key settings, refused while the AI opt-in is off. See `src/services/geminiConfig.ts`. */
app.use("/api", geminiConfigRouter);
app.use("/api", markBackupRouter);
app.use("/api", libraryRouter);

/**
 * Notes exported as a PDF through the page renderer, for text jsPDF cannot set: right-to-left
 * scripts and Nastaliq need a real shaping engine. The client builds the page (fonts inlined as
 * data: URIs); it is sanitised like an import and printed by the desktop app's Chromium.
 */
app.post("/api/export/notes-pdf", async (req, res) => {
  const html = req.body?.html;
  if (typeof html !== "string" || !html.trim()) {
    res.status(400).json({ error: "The page to print is required." });
    return;
  }
  if (!htmlToPdfRenderer) {
    res.status(501).json({ error: "Printing this export needs the desktop app." });
    return;
  }
  try {
    const pdf = await htmlToPdfRenderer({
      html: sanitizeImportHtml(html),
      displayHeaderFooter: false,
      headerTemplate: "",
      footerTemplate: "",
      marginsMm: { top: 18, right: 18, bottom: 18, left: 18 }
    });
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (error) {
    console.error("Notes PDF export failed:", error);
    res.status(500).json({ error: "The PDF could not be made." });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Client log forwarding endpoint
app.post("/api/client-log", (req, res) => {
  try {
    const { type, messages = [] } = req.body || {};
    const prefix = `[Browser ${String(type || 'log').toUpperCase()}]`;
    const logList = Array.isArray(messages) ? messages : [messages];
    if (type === 'error') {
      console.error(prefix, ...logList);
    } else if (type === 'warn') {
      console.warn(prefix, ...logList);
    } else {
      console.log(prefix, ...logList);
    }
  } catch (e) {
    // Ignore logging errors
  }
  res.sendStatus(200);
});

// ── Document Store ──────────────────────────────────────────────────────────
// Uploaded documents are held on this machine's own disk rather than in the browser, so a
// document isn't capped by the ~5MB sessionStorage quota and its original file survives being
// parsed. A sweeper deletes anything past the retention window (see documentStore.ts).

/**
 * Attaches the original uploaded file to a document already created by POST /api/documents.
 *
 * Upload is deliberately two requests rather than one. A single request would have to carry
 * both the extracted text and the raw file bytes, and there is no good way to do that here:
 * putting the text in the query string caps it at Node's ~16KB max header size (a ~3,000-word
 * document — far WORSE than the browser quota this store exists to escape), and base64-ing the
 * file into the JSON inflates it by a third. So the text goes up as JSON, the file goes up as
 * raw bytes, and each travels in the shape that suits it.
 */
app.put(
  "/api/documents/:id/original",
  express.raw({ type: "application/octet-stream", limit: "50mb" }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "Original file bytes are required." });
        return;
      }
      const filename = typeof req.query.filename === "string" ? req.query.filename : undefined;
      const attached = await attachOriginal(req.params.id, req.body, filename);
      if (!attached) {
        res.status(404).json({ error: "Document not found." });
        return;
      }
      res.json({ attached: true });
    } catch (error) {
      console.error("Attaching original failed:", error);
      res.status(500).json({ error: "Failed to store the original file." });
    }
  }
);

/**
 * Creates a document from its extracted text. Used for pasted text and as the first step of a
 * file upload, whose original bytes then follow via PUT /api/documents/:id/original.
 */
app.post("/api/documents", express.json({ limit: "50mb" }), async (req, res) => {
  try {
    // Pasted custom text arrives with `layout: 'verbatim'` (and optional clipboard `html`).
    const params = documentParamsFromBody(req.body);
    if ("error" in params) {
      res.status(400).json({ error: params.error });
      return;
    }
    const meta = await saveDocument(params);
    res.json({ ...meta, retentionDays: RETENTION_DAYS });
  } catch (error: any) {
    console.error("Document save failed:", error);
    res.status(500).json({ error: "Failed to store document." });
  }
});

/**
 * Creates a document from an HTML page, converting it to a PDF on the way in.
 *
 * This is what makes an imported `.htm` book annotatable rather than read-only. The annotating
 * workspace positions every mark as a fraction of a page box, which reflowable HTML simply does
 * not have; printing the page once, here, gives the document a fixed pagination that every
 * annotation can then be anchored to and that survives resizing, zooming and reopening. From
 * this point on the stored original is an ordinary PDF and nothing downstream needs to know it
 * began life as HTML — the format is recorded as HTML only so the library can say what it was.
 *
 * Conversion needs a browser engine, which only the desktop build supplies (see
 * `setHtmlToPdfRenderer` and `electron/main.cjs`). Running as a bare dev server there is none,
 * so the import is refused with an explanation rather than silently storing an unopenable file.
 */
app.post("/api/documents/from-html", express.json({ limit: "200mb" }), async (req, res) => {
  try {
    const { title, text, html, filename } = req.body || {};
    if (!html || typeof html !== "string" || !html.trim()) {
      res.status(400).json({ error: "The HTML document is required." });
      return;
    }
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "No readable text was extracted from that HTML file." });
      return;
    }
    if (!htmlToPdfRenderer) {
      res.status(501).json({
        error:
          "Importing HTML needs the desktop app, which supplies the page renderer. Open Marginalia as the desktop app and try again."
      });
      return;
    }

    const pdfBuffer = await htmlToPdfRenderer({
      // The body is untrusted: nothing that could run code or reach the network survives.
      html: sanitizeImportHtml(html),
      displayHeaderFooter: false,
      headerTemplate: "",
      footerTemplate: "",
      // Narrow, because the imported page constrains its own reading column: these only need to
      // keep text off the paper's edge, and every millimetre they take is one the column cannot
      // use for type.
      marginsMm: { top: 15, right: 14, bottom: 15, left: 14 }
    });

    const documentTitle = typeof title === "string" && title.trim() ? title.trim() : "Untitled Document";
    const baseName = (typeof filename === "string" && filename ? filename : documentTitle).replace(
      /\.[^/.]+$/,
      ""
    );

    const meta = await saveDocument({
      title: documentTitle,
      text,
      format: "HTML",
      filename: `${baseName}.pdf`
    });

    // The original is required, not best-effort: the workspace renders the stored PDF by id, so
    // a document whose bytes failed to write would open to an empty viewer. Rather than leave
    // that behind, the half-made record is removed and the failure reported.
    const attached = await attachOriginal(meta.id, pdfBuffer, `${baseName}.pdf`);
    if (!attached) {
      await deleteDocument(meta.id).catch(() => undefined);
      res.status(500).json({ error: "The converted document could not be saved to this device." });
      return;
    }

    res.json({ ...meta, format: "HTML", originalBytes: pdfBuffer.length, retentionDays: RETENTION_DAYS });
  } catch (error) {
    console.error("HTML import failed:", error);
    res.status(500).json({ error: "That HTML file could not be converted into a readable document." });
  }
});

app.get("/api/documents", async (_req, res) => {
  try {
    res.json({ documents: await listDocuments(), retentionDays: RETENTION_DAYS });
  } catch (error) {
    console.error("Document list failed:", error);
    res.status(500).json({ error: "Failed to list documents." });
  }
});

/**
 * Full-text search across every stored document. Search has to run here rather than in the
 * browser now that document bodies live on disk: the client only holds ids and metadata, so a
 * purely local search could only ever match documents already opened this session.
 */
app.get("/api/documents/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) {
    res.json({ results: [] });
    return;
  }

  try {
    const metas = await listDocuments();
    const needle = query.toLowerCase();
    const settings = (await getSettings()) ?? {};
    const themes = Array.isArray(settings.activeThemes)
      ? (settings.activeThemes as Array<{ id: string; name: string; color: string }>)
      : [];
    const themeById = new Map(themes.map((t) => [t.id, t]));

    /**
     * One hit. A document match points at the book; a mark match points at a passage inside it,
     * and carries what the reader needs to recognise it — the words, the theme it is filed under,
     * the page — plus enough for the app to open the book at that mark.
     */
    type Hit = {
      kind: "document" | "mark";
      id: string;
      title: string;
      format: string;
      snippet: string;
      matches: number;
      annotationId?: string;
      page?: number;
      themeId?: string | null;
      themeName?: string;
      themeColor?: string;
      isTerminology?: boolean;
    };
    const results: Hit[] = [];

    for (const meta of metas) {
      const doc = await getDocument(meta.id);
      if (!doc) continue;

      /*
       * Marks are searched as well as text: a reader looking for "mortality" wants the passages
       * they marked about it at least as much as every incidental mention. A mark matches on the
       * words it covers, on a note's own writing, on the theme it is filed under, and on the word
       * "terminology" — so a theme's whole contents can be listed by naming it.
       */
      const themeOf = (a: Record<string, unknown>) => (typeof a.themeId === "string" ? themeById.get(a.themeId) : undefined);
      for (const { mark: a, hit } of markSearchHits(doc.annotations, needle, (a) => themeOf(a)?.name)) {
        const theme = themeOf(a);
        const isTerm = a.isTerminology === true;
        results.push({
          kind: "mark",
          id: meta.id,
          title: meta.title,
          format: meta.format,
          snippet: wordWindow(hit.text, 0, 220, hit.keep),
          matches: 1,
          annotationId: String(a.id),
          page: typeof a.page === "number" ? a.page : undefined,
          themeId: typeof a.themeId === "string" ? a.themeId : null,
          themeName: theme?.name,
          themeColor: theme?.color,
          isTerminology: isTerm
        });
      }

      const haystack = doc.text.toLowerCase();
      const titleHit = meta.title.toLowerCase().includes(needle);
      const firstIdx = haystack.indexOf(needle);
      if (!titleHit && firstIdx === -1) continue;

      let matches = 0;
      let cursor = 0;
      while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
        matches++;
        cursor += needle.length;
      }

      // A window of surrounding text so the reader can see the term in context, not just
      // that some match exists somewhere in the document.
      const snippetStart = firstIdx === -1 ? 0 : Math.max(0, firstIdx - 60);
      const snippet = wordWindow(doc.text, snippetStart, snippetStart + 200,
        firstIdx === -1 ? undefined : [firstIdx, firstIdx + needle.length]);

      results.push({ kind: "document", id: meta.id, title: meta.title, format: meta.format, snippet, matches });
    }

    // Marks first: a passage the reader chose to mark is a better answer than a word the book
    // happens to contain, however many times it contains it.
    results.sort((a, b) => (a.kind === b.kind ? b.matches - a.matches : a.kind === "mark" ? -1 : 1));
    res.json({ results });
  } catch (error) {
    console.error("Document search failed:", error);
    res.status(500).json({ error: "Search failed." });
  }
});

app.get("/api/documents/:id", async (req, res) => {
  const doc = await getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Document not found. It may have passed its retention window." });
    return;
  }
  // A thematic analysis saved before 2.5.0 stays on disk but is no longer sent.
  const { analysis: _analysis, ...sent } = doc;
  res.json(sent);
});

/** Content types for the formats the workspace can render in place rather than download. */
const INLINE_CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".epub": "application/epub+zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

/**
 * Hands back the original uploaded file, byte-for-byte as it was stored.
 *
 * `?disposition=inline` serves it with its real content type instead of forcing a download,
 * which is what the PDF workspace fetches: PDF.js needs the actual bytes of the source file,
 * not the text scraped out of it, to render the real pages.
 */
app.get("/api/documents/:id/original", async (req, res) => {
  const original = await getOriginal(req.params.id);
  if (!original) {
    res.status(404).json({ error: "Original file not found for this document." });
    return;
  }
  const ext = path.extname(original.filename).toLowerCase();
  // Header values cannot contain control characters, nor anything above U+00FF (a curly
  // apostrophe, Urdu) — Node throws ERR_INVALID_CHAR. The filename comes from the client at
  // upload time, so it is stripped here and encoded by `contentDisposition`.
  // Quotes are kept: `contentDisposition` drops them from the ASCII name and encodes them in `filename*`.
  const safeName = original.filename.replace(/[\r\n\u0000-\u001f\u007f]/g, "").trim() || "document";

  if (req.query.disposition === "inline") {
    res.setHeader("Content-Type", INLINE_CONTENT_TYPES[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", contentDisposition("inline", safeName));
  } else {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", contentDisposition("attachment", safeName));
  }
  res.send(original.buffer);
});

/** Renames a stored document (any document, pasted custom text included). Used by the library's edit action. */
app.patch("/api/documents/:id", async (req, res) => {
  const title = cleanTitle(req.body?.title);
  if (!title) {
    res.status(400).json({ error: "A non-empty title is required." });
    return;
  }
  const meta = await updateDocument(req.params.id, { title });
  if (!meta) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json(meta);
});

app.get("/api/documents/:id/annotations", async (req, res) => {
  const doc = await getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json({ annotations: doc.annotations });
});

/**
 * Replaces a document's annotations wholesale. The client owns the full set and sends it after
 * each edit, so a whole-array PUT keeps the two in sync without needing per-annotation
 * add/update/delete routes and the ordering problems they bring.
 */
app.put("/api/documents/:id/annotations", express.json({ limit: "25mb" }), async (req, res) => {
  const { annotations } = req.body || {};
  if (!Array.isArray(annotations)) {
    res.status(400).json({ error: "An annotations array is required." });
    return;
  }
  /**
   * A write that removes marks is worth saying out loud.
   *
   * Deleting one is ordinary; losing thirty to a stale overwrite is not, and the two are
   * indistinguishable at this layer. The store keeps the previous set (see `annotationsBackup`),
   * so this line is how anyone finds out it happened and when.
   */
  const before = await getDocument(req.params.id);
  const had = before?.annotations.length ?? 0;
  if (annotations.length < had) {
    console.warn(
      `[Marginalia] annotations SHRANK ${had} -> ${annotations.length} on ${req.params.id} — previous set kept, restore with POST /api/documents/${req.params.id}/annotations/restore`
    );
  }
  const meta = await updateDocument(req.params.id, { annotations });
  if (!meta) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json(meta);
});

/**
 * Where the reader left off in this document — zoom, page and single/spread view. Stored here
 * rather than in the browser's localStorage because the desktop build's embedded server binds to
 * a fresh random port every launch (see this file's PORT=0 comment), and a different port is a
 * different origin to the browser — so localStorage would reset on every restart and update.
 */
/**
 * Puts back the annotation set from before the last write that removed marks.
 *
 * The escape hatch for the failure this store cannot otherwise survive: a document's marks are
 * hours of reading, there is no history, and a bad overwrite is silent. Kept deliberately blunt —
 * one slot, one step back.
 */
app.post("/api/documents/:id/annotations/restore", async (req, res) => {
  const doc = await getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  if (!doc.annotationsBackup) {
    res.status(404).json({ error: "No previous annotation set is stored for this document." });
    return;
  }
  const restoring = doc.annotationsBackup.annotations.length;
  const meta = await updateDocument(req.params.id, { restoreAnnotationsBackup: true });
  console.log(`[Marginalia] restored ${restoring} annotations on ${req.params.id}`);
  res.json({ restored: restoring, meta });
});

app.get("/api/documents/:id/reading-state", async (req, res) => {
  const doc = await getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json({ readingState: doc.readingState });
});

app.put("/api/documents/:id/reading-state", async (req, res) => {
  const { readingState } = req.body || {};
  if (
    !readingState ||
    typeof readingState.scale !== "number" ||
    typeof readingState.page !== "number" ||
    !["single", "spread", "grid4", "grid6"].includes(readingState.viewMode)
  ) {
    res.status(400).json({ error: "A valid readingState object is required." });
    return;
  }
  const meta = await updateDocument(req.params.id, { readingState });
  if (!meta) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json({ saved: true });
});

/**
 * How far the reader has got: `{ position, total }` in the reader's own unit (PDF page of pages,
 * text paragraph of paragraphs). The store keeps the furthest point; the library list shows it as
 * `progressPercent`. Not library activity, so `updatedAt` is unchanged.
 */
app.put("/api/documents/:id/progress", async (req, res) => {
  const report = { position: req.body?.position, total: req.body?.total };
  if (!nextReadingProgress(null, report)) {
    res.status(400).json({ error: "position and total must be numbers, total > 0, position >= 0." });
    return;
  }
  const meta = await updateDocument(req.params.id, { readingProgress: report });
  if (!meta) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json({ progressPercent: meta.progressPercent });
});

/**
 * Inserts a blank page into the document's own stored PDF file — a REAL page written into the
 * original, not a virtual overlay the app only pretends is there. That is what lets it render
 * through the ordinary page pipeline, be annotated as any other page can, and survive being
 * closed and reopened or exported, all with no separate code path.
 *
 * `placement` is relative to `anchorPage` (the page the reader had open) for 'before'/'after', or
 * ignores it for 'both-ends', which inserts one blank page at the very start of the document and
 * appends another at the very end in the same request. `height` picks the new page's height in
 * points; its width always matches the page it's inserted next to, so it never reads as a
 * foreign size dropped into the document.
 *
 * Every existing annotation's `page` number is shifted to match wherever the new page landed —
 * the whole reason this recomputes rather than trusting the client to know the new numbering.
 */
app.post("/api/documents/:id/pages", express.json(), async (req, res) => {
  const { placement, anchorPage, height } = req.body || {};
  if (placement !== "before" && placement !== "after" && placement !== "both-ends") {
    res.status(400).json({ error: "placement must be 'before', 'after', or 'both-ends'." });
    return;
  }
  if (height !== "full" && height !== "header" && height !== "notes") {
    res.status(400).json({ error: "height must be 'full', 'header', or 'notes'." });
    return;
  }
  if (placement !== "both-ends" && (typeof anchorPage !== "number" || anchorPage < 1)) {
    res.status(400).json({ error: "A valid anchorPage is required for 'before' and 'after'." });
    return;
  }

  try {
    // One locked step in the store: the marks are read inside the lock and written together with
    // the edited PDF, so a mark saved while the PDF was being rewritten cannot be lost and a crash
    // cannot leave new page numbers on the old PDF (see LocalDocumentBackend.editPdfPages).
    const result = await editPdfPages(req.params.id, (input) =>
      insertBlankPages(input, { placement, anchorPage, height })
    );
    if (!result) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json(result);
  } catch (error) {
    if (error instanceof PageEditError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Page insertion failed:", error);
    res.status(500).json({ error: "Could not insert a page into this PDF." });
  }
});

/**
 * Removes one page — inserted or original — from the document's own stored PDF file. Any
 * annotation ON that page is discarded with it; everything after it shifts down by one to close
 * the gap, the mirror image of what inserting a page does to the numbering.
 *
 * Refuses to remove the last remaining page: a PDF with zero pages isn't a smaller document, it's
 * a broken one, and the right way to get rid of a whole document is deleting it, not emptying it.
 */
app.delete("/api/documents/:id/pages/:pageNumber", async (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    res.status(400).json({ error: "pageNumber must be a positive integer." });
    return;
  }

  try {
    const result = await editPdfPages(req.params.id, (input) => removePdfPage(input, pageNumber));
    if (!result) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json(result);
  } catch (error) {
    if (error instanceof PageEditError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Page removal failed:", error);
    res.status(500).json({ error: "Could not remove that page." });
  }
});

/**
 * Deletes a document from this machine's disk permanently — record, original file and
 * annotations. Backs the library panel's delete button, which is the only way documents leave
 * the store now that retention is opt-in.
 */
app.delete("/api/documents/:id", async (req, res) => {
  const deleted = await deleteDocument(req.params.id);
  res.json({ deleted });
});

/** Where documents are being written, so the library panel can show the user the real path. */
app.get("/api/storage", (_req, res) => {
  res.json({
    backend: getBackend().name,
    location: getBackend().location,
    retentionDays: RETENTION_DAYS
  });
});

/**
 * The reader's preferences — name, theme colours, palettes, typography, dark mode. Stored beside
 * the document library (see LocalDocumentBackend.getSettings) rather than left to the browser's
 * localStorage, because the desktop build's embedded server binds to a fresh random port every
 * launch: a different port is a different origin, so localStorage would reset on every restart
 * and every auto-update. This file lives in the OS per-user application-data directory instead,
 * which — like the library itself — survives both.
 */
app.get("/api/settings", async (_req, res) => {
  // No gemini* fields: the key stays server-side (see /api/gemini-config).
  res.json({ settings: publicSettings(await getSettings()) });
});

app.put("/api/settings", async (req, res) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== "object") {
    res.status(400).json({ error: "settings object required" });
    return;
  }
  try {
    // Merged into what is stored; `gemini*` fields only ever change through /api/gemini-config.
    await saveClientSettings(settings);
    res.json({ saved: true });
  } catch (error) {
    console.error("Settings save failed:", error);
    res.status(500).json({ error: "Failed to save settings." });
  }
});

/**
 * How generated HTML becomes a PDF.
 *
 * Kept behind a seam because the two ways this app runs have different browsers available. Run as
 * a plain server it falls back to Puppeteer's headless Chrome; run inside the packaged desktop
 * app, the Electron main process registers a renderer backed by Electron's own bundled Chromium
 * (see `electron/main.cjs`). The desktop path is the one that matters here — it keeps Puppeteer's
 * several-hundred-megabyte Chrome download out of the installer while producing the same output,
 * since Electron's printToPDF accepts the same header/footer templates.
 */
export interface HtmlToPdfOptions {
  html: string;
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
  marginsMm: { top: number; right: number; bottom: number; left: number };
  /** Paper size, defaulting to A4. */
  pageSize?: "A4" | "A5" | "Letter";
}

export type HtmlToPdfRenderer = (options: HtmlToPdfOptions) => Promise<Buffer>;

let htmlToPdfRenderer: HtmlToPdfRenderer | null = null;

/** Lets the Electron main process substitute its own Chromium. */
export function setHtmlToPdfRenderer(renderer: HtmlToPdfRenderer): void {
  htmlToPdfRenderer = renderer;
}

// Start Vite / Static handler
/**
 * Boots the server and resolves with the port it actually bound to.
 *
 * Two things about this shape matter for the desktop build. It returns the port rather than
 * assuming one, because Electron starts the server on PORT=0 and needs to know where to point
 * the window. And it is exported rather than invoked at import time, so the Electron main
 * process can await a ready server before creating that window instead of racing it.
 *
 * `staticRoot` lets the packaged app pass the location of its bundled `dist` directory;
 * outside the package it falls back to `dist` under the working directory as before.
 */
export async function startServer(options: { staticRoot?: string } = {}): Promise<number> {
  if (process.env.NODE_ENV !== "production") {
    // Imported here rather than at the top of the file so the production bundle — including
    // the one inside the packaged desktop app — never has to resolve Vite at all.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = options.staticRoot || path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Last, after the static and SPA fallbacks: a 500 for any route that threw, never a crash.
  app.use(jsonErrorHandler);

  const sweeper = startDocumentSweeper();

  return new Promise<number>((resolve, reject) => {
    const server = app.listen(PORT, "127.0.0.1", () => {
      /**
       * No request timeout.
       *
       * Node's default is 300 seconds, and a thematic analysis can legitimately exceed it: the
       * poll for Gemini's file processing alone allows five minutes, with generation on top. The
       * socket being destroyed underneath a finished analysis is the worst outcome — the result
       * is already saved by then, but the reader is told the app could not be reached and offered
       * a Retry that spends tokens repeating work that succeeded. Nothing here is exposed to a
       * network, so a slow request is a slow request, not an attack.
       */
      server.requestTimeout = 0;
      server.headersTimeout = 0;
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : PORT;
      console.log(`Marginalia server running on http://127.0.0.1:${boundPort}`);
      console.log(`[Marginalia] Document storage: ${getBackend().name}`);
      console.log(
        sweeper
          ? `[Marginalia] Retention: documents swept after ${RETENTION_DAYS} days.`
          : `[Marginalia] Retention: off — documents are kept until deleted from the library.`
      );
      resolve(boundPort);
    });
    server.on("error", reject);
  });
}

// Running the server directly (`npm run dev` / `npm start`) starts it immediately. When the
// Electron main process imports this module instead, it calls startServer() itself so it can
// set the store directory and await the port first.
if (!process.env.MARGINALIA_EMBEDDED) {
  startServer().catch((err) => {
    console.error("[Marginalia] Failed to start server:", err);
    process.exit(1);
  });
}
