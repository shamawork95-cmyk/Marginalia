import React, { useState, useRef } from 'react';
import { Upload, FileText, Sparkles, Clock, MoreVertical, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { Screen, TransitionType } from '../types';
import type { LibraryDocument } from '../App';
import { parseFile } from '../utils/fileParser';
import { filesFromDrop, pickDocumentAndSiblings } from '../utils/fileDrop';
import { isAnnotatableFormat } from '../utils/annotatableFormats';
import { storeUploadedDocument, storePastedDocument, storeHtmlDocument } from '../utils/documentStorage';

interface UploadDocumentScreenProps {
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  onSelectDocumentForAnalysis?: (title: string, text: string, format?: string, docId?: string) => void;
  /** Reopens a library document, re-fetching its text from the local store when needed. */
  onOpenLibraryDocument?: (doc: LibraryDocument) => void;
  uploadedLibrary?: LibraryDocument[];
  /** Signals that something new was written to disk, so the library panel can refresh. */
  onDocumentStored?: () => void;
  onOpenLibrary?: () => void;
}

export const UploadDocumentScreen: React.FC<UploadDocumentScreenProps> = ({
  onNavigate,
  isDark = false,
  onSelectDocumentForAnalysis,
  onOpenLibraryDocument,
  uploadedLibrary = [],
  onDocumentStored,
  onOpenLibrary
}) => {
  const [pastedText, setPastedText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedText, setParsedText] = useState<string | null>(null);
  const [parsedFormat, setParsedFormat] = useState<string | null>(null);
  const [parsedTitle, setParsedTitle] = useState<string | null>(null);
  /** HTML imports only: the self-contained page the server converts to a PDF. */
  const [printableHtml, setPrintableHtml] = useState<string | null>(null);
  const [inlinedAssets, setInlinedAssets] = useState(0);
  /** True for a scanned PDF: it opens and annotates, but has no text to select, search or analyse. */
  const [textLayerMissing, setTextLayerMissing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isStoring, setIsStoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Stores the document on this device, then opens it.
   *
   * Where it opens depends on whether the format has pages to mark up. PDFs — and HTML books,
   * which are paginated into a PDF during the import — go to the annotating workspace, where
   * the reader sees the real document and decides for themselves whether to spend an AI call.
   * DOCX, EPUB and TXT are kept as their original bytes, have no page geometry to draw on, and
   * so continue to the analysis screen, which is likewise inert until its button is pressed.
   *
   * Storing is required rather than best-effort here: the workspace renders the stored original
   * by id, so there is nothing to show if the write failed. The error is surfaced instead.
   */
  const handleStartAnalysis = async () => {
    const fallbackTitle = selectedFile
      ? selectedFile.name.replace(/\.[^/.]+$/, "")
      : "Custom Document Analysis";
    const finalTitle = parsedTitle || fallbackTitle;
    const finalText = parsedText || pastedText || '';
    const finalFormat = parsedFormat || 'TXT';

    if (!finalText.trim()) {
      setParseError('Please upload a file or paste some text before continuing.');
      return;
    }

    setIsStoring(true);
    setParseError(null);
    try {
      let meta;
      if (finalFormat === 'HTML' && printableHtml && selectedFile) {
        meta = await storeHtmlDocument({
          title: finalTitle,
          text: finalText,
          html: printableHtml,
          filename: selectedFile.name
        });
      } else if (selectedFile) {
        meta = await storeUploadedDocument({
          file: selectedFile,
          title: finalTitle,
          text: finalText,
          format: finalFormat
        });
      } else {
        meta = await storePastedDocument({ title: finalTitle, text: finalText, format: finalFormat });
      }

      onDocumentStored?.();
      onSelectDocumentForAnalysis?.(finalTitle, finalText, finalFormat, meta.id);
      onNavigate(isAnnotatableFormat(finalFormat) ? 'workspace' : 'analysis', 'push');
    } catch (err: any) {
      console.error('Could not store the document.', err);
      setParseError(
        err?.message || 'The document could not be saved to this device. Check available disk space and try again.'
      );
    } finally {
      setIsStoring(false);
    }
  };

  /**
   * Parses one batch of files: the document itself, plus any assets that came alongside it.
   *
   * The batch matters for HTML. A book saved as a page keeps its images in a sibling folder,
   * and those files have to be embedded before the page is printed or the PDF comes out with
   * the cover missing — so the picker takes several files and a drop descends into folders.
   */
  const ingestFiles = async (files: File[]) => {
    const picked = pickDocumentAndSiblings(files);
    if (!picked) {
      setParseError('No readable document was found there. Drop a PDF, HTML, DOCX, EPUB or TXT file.');
      return;
    }

    setSelectedFile(picked.document);
    setPrintableHtml(null);
    setInlinedAssets(0);
    setTextLayerMissing(false);
    setParsedTitle(null);
    setIsParsing(true);
    setParseError(null);

    try {
      const parsed = await parseFile(picked.document, picked.siblings);
      setParsedText(parsed.text);
      setParsedFormat(parsed.format);
      setParsedTitle(parsed.title);
      setPrintableHtml(parsed.printableHtml ?? null);
      setInlinedAssets(parsed.inlinedAssets ?? 0);
      setTextLayerMissing(Boolean(parsed.textLayerMissing));
    } catch (err: any) {
      console.error('File parsing error:', err);
      setParsedText(null);
      setParsedFormat(null);
      setParseError(err.message || 'Failed to read file contents.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await ingestFiles(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = await filesFromDrop(e.dataTransfer);
    if (files.length === 0) return;
    await ingestFiles(files);
  };

  return (
    <main className="flex-1 px-5 py-4 pb-24 md:pb-8 max-w-md md:max-w-2xl mx-auto w-full space-y-6">
      {/* Upload Header */}
      <div className="space-y-1">
        <h2 className="font-serif text-[24px] font-bold text-stone-900 dark:text-white">
          Add a Document
        </h2>
        <p className="text-[13px] text-stone-500 dark:text-stone-400">
          Files open in the annotating workspace. AI analysis runs only when you ask for it.
        </p>
      </div>

      {/* Dropzone Container */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`p-6 rounded-3xl border-2 border-dashed transition-all cursor-pointer text-center space-y-3 ${
          isDragging
            ? 'border-emerald-500 bg-emerald-500/10'
            : isDark
              ? 'border-stone-700 bg-[#1b201d] hover:border-stone-600'
              : 'border-stone-300 bg-stone-50/70 hover:border-stone-400'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.pdf,.docx,.epub,.htm,.html,.xhtml,.css,image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mx-auto">
          {isParsing ? (
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          ) : selectedFile ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          ) : (
            <Upload className="w-6 h-6" />
          )}
        </div>

        <div>
          <h3 className="font-serif text-[16px] font-semibold text-stone-900 dark:text-white">
            {isParsing
              ? 'Reading document…'
              : selectedFile
                ? selectedFile.name
                : 'Choose a file or drag one here'}
          </h3>
          <p className="text-[12px] text-stone-500 dark:text-stone-400 mt-1">
            {selectedFile && typeof parsedText === 'string'
              ? textLayerMissing
                ? 'No text layer — opens for reading and hand annotation'
                : `${parsedText.split(/\s+/).filter(Boolean).length} words extracted cleanly` +
                  (parsedFormat === 'HTML'
                    ? inlinedAssets > 0
                      ? ` • ${inlinedAssets} image${inlinedAssets === 1 ? '' : 's'} embedded`
                      : ' • no images found beside it'
                    : '')
              : 'PDF, HTML, TXT, DOCX and EPUB — drop the whole folder for an HTML book'}
          </p>
        </div>

        {!selectedFile && (
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-stone-200 dark:bg-stone-800 text-stone-800 dark:text-stone-200 text-[12px] font-semibold inline-block cursor-pointer"
          >
            Choose File
          </button>
        )}
      </div>

      {/* A scanned PDF is not an error — it opens and annotates; it just has no words to read. */}
      {textLayerMissing && !parseError && (
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 flex items-start gap-2.5 text-amber-900 dark:text-amber-200 text-[12px]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>
            This PDF is made of page images, with no text layer. It will open in the viewer and
            every annotation tool works on it — but text selection, search and AI analysis need
            machine-readable words, so those stay unavailable until the file is run through OCR.
          </span>
        </div>
      )}

      {/* Parse Error Alert */}
      {parseError && (
        <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 flex items-center gap-2.5 text-red-800 dark:text-red-300 text-[12px]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{parseError}</span>
        </div>
      )}

      {/* Manual Paste Text Box */}
      <div className="space-y-2">
        <label className="text-[12px] font-semibold text-stone-700 dark:text-stone-300 block">
          Or paste text directly
        </label>
        <textarea
          rows={4}
          placeholder="Paste document contents, an excerpt, or notes…"
          value={pastedText}
          onChange={(e) => {
            setPastedText(e.target.value);
            if (parseError) setParseError(null);
          }}
          className={`w-full p-3.5 rounded-2xl border text-[13px] font-serif leading-relaxed transition-all resize-none focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
            isDark
              ? 'bg-[#181c19] border-stone-800 text-stone-100 placeholder-stone-600'
              : 'bg-white border-stone-300/80 text-stone-900 placeholder-stone-400'
          }`}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => { void handleStartAnalysis(); }}
            disabled={isParsing || isStoring || (!selectedFile && !parsedText && !pastedText.trim())}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#435c52] hover:bg-[#374c43] text-white font-semibold text-[13px] transition-all shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isStoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>
              {isStoring
                ? parsedFormat === 'HTML'
                  ? 'Paginating Book…'
                  : 'Saving Document…'
                : isAnnotatableFormat(parsedFormat)
                  ? 'Open & Annotate'
                  : 'Start Analysis'}
            </span>
          </button>
        </div>
      </div>

      {/* Recent Documents Section */}
      <section id="recent-documents-section" className="space-y-3">
        <div className="flex items-center gap-2 text-stone-700 dark:text-stone-300">
          <Clock className="w-4 h-4 text-stone-500" />
          <h3 className="text-[13px] font-semibold tracking-wide text-stone-800 dark:text-stone-200">
            Recent
          </h3>
          {onOpenLibrary && (
            <button
              type="button"
              onClick={onOpenLibrary}
              className="ml-auto text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              Open library
            </button>
          )}
        </div>

        {uploadedLibrary.length > 0 ? (
          <div className="space-y-2.5">
            {uploadedLibrary.map((doc) => (
              <div
                key={doc.id}
                onClick={() => {
                  onOpenLibraryDocument?.(doc);
                  onNavigate(isAnnotatableFormat(doc.format) ? 'workspace' : 'analysis', 'push');
                }}
                className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer hover:shadow-xs ${
                  isDark
                    ? 'bg-[#1b201d] border-stone-800 hover:bg-[#232a26]'
                    : 'bg-white border-stone-200/70 hover:bg-stone-50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-medium text-[13px] text-stone-900 dark:text-stone-100 truncate">
                      {doc.title}
                    </h4>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400">
                      {doc.wordCount} words • Added {doc.date}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); }}
                  className="p-1 text-stone-400 hover:text-stone-600 cursor-pointer"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-2xl border border-dashed border-stone-300 dark:border-stone-800 text-center bg-stone-50/50 dark:bg-stone-900/30">
            <p className="text-[12px] text-stone-500 dark:text-stone-400">
              Nothing here yet. Add a file or paste text above.
            </p>
          </div>
        )}
      </section>
    </main>
  );
};
