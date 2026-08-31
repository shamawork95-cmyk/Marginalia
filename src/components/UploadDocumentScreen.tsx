import React, { useState, useRef } from 'react';
import { Upload, FileText, Sparkles, Clock, MoreVertical, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { Screen, TransitionType } from '../types';
import type { LibraryDocument } from '../App';
import { parseFile } from '../utils/fileParser';
import { storeUploadedDocument, storePastedDocument } from '../utils/documentStorage';

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
  const [parseError, setParseError] = useState<string | null>(null);
  const [isStoring, setIsStoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Stores the document on this device, then opens it.
   *
   * The destination changed with the new workflow. An uploaded PDF now opens in the workspace,
   * where the reader sees the real document in the PDF viewer/editor and decides for themselves
   * whether to spend an AI call; it no longer runs a thematic analysis on the way in.
   *
   * Only PDFs go there. The workspace renders the original file, and DOCX, EPUB and TXT have no
   * page geometry to render or annotate — for those the extracted text is all there is, so they
   * continue to the analysis screen, which is now also inert until its button is pressed.
   *
   * Storing is required rather than best-effort here: the workspace renders the stored original
   * by id, so there is nothing to show if the write failed. The error is surfaced instead.
   */
  const handleStartAnalysis = async () => {
    const finalTitle = selectedFile
      ? selectedFile.name.replace(/\.[^/.]+$/, "")
      : "Custom Document Analysis";
    const finalText = parsedText || pastedText || '';
    const finalFormat = parsedFormat || 'TXT';

    if (!finalText.trim()) {
      setParseError('Please upload a file or paste some text before continuing.');
      return;
    }

    setIsStoring(true);
    setParseError(null);
    try {
      const meta = selectedFile
        ? await storeUploadedDocument({ file: selectedFile, title: finalTitle, text: finalText, format: finalFormat })
        : await storePastedDocument({ title: finalTitle, text: finalText, format: finalFormat });

      onDocumentStored?.();
      onSelectDocumentForAnalysis?.(finalTitle, finalText, finalFormat, meta.id);
      onNavigate(finalFormat === 'PDF' ? 'workspace' : 'analysis', 'push');
    } catch (err: any) {
      console.error('Could not store the document.', err);
      setParseError(
        err?.message || 'The document could not be saved to this device. Check available disk space and try again.'
      );
    } finally {
      setIsStoring(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setIsParsing(true);
    setParseError(null);

    try {
      const extractedText = await parseFile(file);
      setParsedText(extractedText.text);
      setParsedFormat(extractedText.format);
    } catch (err: any) {
      console.error('File parsing error:', err);
      setParseError(err.message || 'Failed to read file contents.');
    } finally {
      setIsParsing(false);
    }
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
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setIsParsing(true);
    setParseError(null);

    try {
      const extractedText = await parseFile(file);
      setParsedText(extractedText.text);
      setParsedFormat(extractedText.format);
    } catch (err: any) {
      console.error('File parsing error:', err);
      setParseError(err.message || 'Failed to read file contents.');
    } finally {
      setIsParsing(false);
    }
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
          accept=".txt,.pdf,.docx,.epub"
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
              ? `${parsedText.split(/\s+/).filter(Boolean).length} words extracted cleanly`
              : 'PDF, TXT, DOCX and EPUB files'}
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
              {isStoring ? 'Saving Document…' : parsedFormat === 'PDF' ? 'Open & Annotate' : 'Start Analysis'}
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
                  onNavigate(doc.format === 'PDF' ? 'workspace' : 'analysis', 'push');
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
