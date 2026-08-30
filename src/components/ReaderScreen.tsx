import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { 
  ArrowLeft, 
  Sparkles, 
  Settings as SettingsIcon, 
  BookOpen, 
  StickyNote as StickyNoteIcon, 
  Plus, 
  Trash2, 
  Edit3, 
  Check, 
  Highlighter, 
  MessageSquare,
  Bot,
  Zap,
  Lightbulb,
  CheckCircle2,
  RefreshCw,
  Sliders,
  Filter,
  Copy,
  Info,
  Download,
  X
} from 'lucide-react';
import { Screen, TransitionType, StickyNote, AISuggestion, UserSettings } from '../types';

import {
  exportToPDF,
  generateMarkdown,
  generatePlainText,
  downloadTextFile,
  getFilteredAnnotations,
  ExportOptions
} from '../utils/exportAnnotations';

interface ReaderScreenProps {
  settings: UserSettings;
  onNavigate: (screen: Screen, transition?: TransitionType) => void;
  isDark?: boolean;
  documentText?: string;
  documentTitle?: string;
  /** Notes for the active document, lifted to App so they survive navigating away and back. */
  notes: StickyNote[];
  onNotesChange: (updater: (prev: StickyNote[]) => StickyNote[]) => void;
}

const NAMED_NOTE_COLORS = ['yellow', 'purple', 'teal', 'rose'];

export const ReaderScreen: React.FC<ReaderScreenProps> = ({
  settings,
  onNavigate,
  isDark = false,
  documentText,
  documentTitle,
  notes,
  onNotesChange
}) => {
  // Derive paragraphs strictly from custom document text
  const displayParagraphs = React.useMemo(() => {
    if (documentText && documentText.trim()) {
      return documentText
        .split(/\n\n+/)
        .map((text, i) => text.trim())
        .filter(text => text.length > 0)
        .map((text, i) => ({ id: `custom-p${i}`, text }));
    }
    return [];
  }, [documentText]);

  const displayTitle = documentTitle || (documentText ? 'Uploaded Document' : 'No Document Selected');
  const displayAuthor = documentText ? 'User Uploaded Text' : '';
  const [activeParagraphIndex, setActiveParagraphIndex] = useState<number | null>(null);
  const [showNotesDrawer, setShowNotesDrawer] = useState<boolean>(true);
  const [selectedThemeFilter, setSelectedThemeFilter] = useState<string>('All');
  const [exportTypeFilter, setExportTypeFilter] = useState<'all' | 'manual' | 'ai'>('all');
  
  const TAB_INDEXES: Record<'notes' | 'add' | 'ai' | 'export', number> = {
    notes: 0,
    add: 1,
    ai: 2,
    export: 3,
  };

  const [activeControlTab, setActiveControlTab] = useState<'notes' | 'add' | 'ai' | 'export'>('notes');
  const [slideDirection, setSlideDirection] = useState<number>(1);

  const handleSwitchTab = (newTab: 'notes' | 'add' | 'ai' | 'export') => {
    if (newTab === activeControlTab) return;
    const currentIdx = TAB_INDEXES[activeControlTab];
    const newIdx = TAB_INDEXES[newTab];
    setSlideDirection(newIdx > currentIdx ? 1 : -1);
    setActiveControlTab(newTab);
  };

  const tabVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 80 : -80,
      opacity: 0,
      scale: 0.98,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -80 : 80,
      opacity: 0,
      scale: 0.98,
    }),
  };
  const [highlightedParagraphs, setHighlightedParagraphs] = useState<number[]>([]);
  
  // Selection Popover State
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectionRange, setSelectionRange] = useState<{ x: number; y: number } | null>(null);
  const readerContentRef = useRef<HTMLDivElement>(null);

  // Note Modal state (for both creating & editing)
  const [isNoteModalOpen, setIsNoteModalOpen] = useState<boolean>(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteFormTitle, setNoteFormTitle] = useState<string>('');
  const [noteFormText, setNoteFormText] = useState<string>('');
  const [noteFormQuote, setNoteFormQuote] = useState<string>('');
  // `string`, not the four palette names: StickyNote.color is documented as a palette name OR an
  // arbitrary hex, and AI-generated notes carry a theme's hex. Narrowing it here silently
  // rejected those when they were opened for editing.
  const [noteFormColor, setNoteFormColor] = useState<string>('yellow');
  const [noteFormTheme, setNoteFormTheme] = useState<string>('Hierarchical Systems');
  const [targetParagraph, setTargetParagraph] = useState<number>(0);
  const [isNoteAiGenerated, setIsNoteAiGenerated] = useState<boolean>(false);

  // AI-Assisted Suggestions Drawer / Panel
  const [isAiPanelOpen, setIsAiPanelOpen] = useState<boolean>(false);
  const [aiFocusMode, setAiFocusMode] = useState<'thematic' | 'metaphor' | 'critique' | 'summary'>('thematic');
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [aiTargetParagraph, setAiTargetParagraph] = useState<number>(0);
  const [aiSource, setAiSource] = useState<string>('');

  // Handle Text Selection for floating toolbar
  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectedText('');
        setSelectionRange(null);
        return;
      }

      const text = selection.toString().trim();
      if (text.length > 3) {
        setSelectedText(text);
        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setSelectionRange({
            x: Math.max(16, rect.left + rect.width / 2),
            y: Math.max(10, rect.top - 10 + window.scrollY)
          });
        } catch {
          setSelectionRange(null);
        }
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Request AI Suggestions from Gemini Flash
  const fetchAiSuggestions = async (paraIdx: number, customText?: string, mode: 'thematic' | 'metaphor' | 'critique' | 'summary' = aiFocusMode, forceRefresh = false) => {
    const textToAnalyze = customText || displayParagraphs[paraIdx]?.text || displayParagraphs.map(p => p.text).join('\n\n');
    
    setIsAiPanelOpen(true);
    setAiTargetParagraph(paraIdx);

    if (!textToAnalyze.trim()) {
      setAiSuggestions([]);
      return;
    }

    const cacheKey = `marginalia_suggs_${documentTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${paraIdx}_${mode}`;
    
    if (!forceRefresh) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.suggestions && parsed.suggestions.length > 0) {
            setAiSuggestions(parsed.suggestions);
            setAiSource(parsed.source || 'gemini-flash');
            return;
          }
        } catch (e) {
          console.warn('Failed to parse cached suggestions', e);
        }
      }
    }

    setIsLoadingAi(true);
    
    const surroundingContext = displayParagraphs.map((p, i) => `[Para ${i+1}] ${p.text}`).join('\n\n');

    try {
      const res = await fetch('/api/gemini/suggest-annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToAnalyze,
          context: surroundingContext,
          mode,
          activeThemes: settings.activeThemes.map(t => t.name)
        })
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      
      if (data && data.suggestions) {
        localStorage.setItem(cacheKey, JSON.stringify(data));
      }
      
      setAiSuggestions(data.suggestions || []);
      setAiSource(data.source || 'gemini-flash');
    } catch (err) {
      console.warn('AI suggestions call fallback:', err);
      // Removed dummy data fallback; set empty array on error
      setAiSuggestions([]);
      setAiSource('error');
    } finally {
      setIsLoadingAi(false);
    }
  };

  // Open modal to create manual note
  const handleOpenManualNote = (paraIndex: number = 0, quote: string = '') => {
    setEditingNoteId(null);
    setTargetParagraph(paraIndex);
    setNoteFormTitle('');
    setNoteFormText('');
    setNoteFormQuote(quote || selectedText);
    setNoteFormColor('yellow');
    setNoteFormTheme(settings.activeThemes[0]?.name || 'Hierarchical Systems');
    setIsNoteAiGenerated(false);
    setIsNoteModalOpen(true);
    setSelectedText('');
    setSelectionRange(null);
  };

  // Open modal to edit existing note
  const handleEditNote = (note: StickyNote) => {
    setEditingNoteId(note.id);
    setTargetParagraph(note.paragraphIndex);
    setNoteFormTitle(note.title);
    setNoteFormText(note.content);
    setNoteFormQuote(note.quote || '');
    setNoteFormColor(note.color);
    setNoteFormTheme(note.themeTag || 'Hierarchical Systems');
    setIsNoteAiGenerated(Boolean(note.isAiGenerated));
    setIsNoteModalOpen(true);
  };

  // Accept and Pin an AI suggestion directly to margin notes
  const handlePinAiSuggestion = (suggestion: AISuggestion) => {
    const newNote: StickyNote = {
      id: `ai-note-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      paragraphIndex: aiTargetParagraph,
      color: suggestion.color,
      title: suggestion.title,
      content: suggestion.content,
      author: 'AI Assistant',
      timestamp: 'Just now',
      themeTag: suggestion.themeTag,
      quote: suggestion.quote,
      isAiGenerated: true,
      confidence: suggestion.confidence,
      rationale: suggestion.rationale
    };

    onNotesChange((prev) => [newNote, ...prev]);
    // Remove from unpinned suggestions
    setAiSuggestions((prev) => prev.filter((s) => s.title !== suggestion.title));
  };

  // Customize an AI suggestion before pinning
  const handleCustomizeAiSuggestion = (suggestion: AISuggestion) => {
    setEditingNoteId(null);
    setTargetParagraph(aiTargetParagraph);
    setNoteFormTitle(suggestion.title);
    setNoteFormText(suggestion.content);
    setNoteFormQuote(suggestion.quote || '');
    setNoteFormColor(suggestion.color);
    setNoteFormTheme(suggestion.themeTag);
    setIsNoteAiGenerated(true);
    setIsNoteModalOpen(true);
  };

  // Save (Create or Update) note form
  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteFormText.trim()) return;

    if (editingNoteId) {
      // Update existing
      onNotesChange((prev) =>
        prev.map((n) =>
          n.id === editingNoteId
            ? {
                ...n,
                paragraphIndex: targetParagraph,
                title: noteFormTitle.trim() || 'Reader Note',
                content: noteFormText.trim(),
                quote: noteFormQuote.trim() || undefined,
                color: noteFormColor,
                themeTag: noteFormTheme,
              }
            : n
        )
      );
    } else {
      // Create new manual note
      const newNote: StickyNote = {
        id: `note-${Date.now()}`,
        paragraphIndex: targetParagraph,
        color: noteFormColor,
        title: noteFormTitle.trim() || 'Reader Note',
        content: noteFormText.trim(),
        quote: noteFormQuote.trim() || undefined,
        author: isNoteAiGenerated ? 'AI Assistant (Edited)' : settings.name,
        timestamp: 'Just now',
        themeTag: noteFormTheme,
        isAiGenerated: isNoteAiGenerated
      };
      onNotesChange((prev) => [newNote, ...prev]);
    }

    setIsNoteModalOpen(false);
  };

  const handleDeleteNote = (id: string) => {
    onNotesChange((prev) => prev.filter((n) => n.id !== id));
  };

  const toggleHighlight = (idx: number) => {
    setHighlightedParagraphs((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  // Notes as scoped by the Export tab's filter controls (type + theme).
  const exportableNotes = getFilteredAnnotations(notes, exportTypeFilter, selectedThemeFilter);

  // Named palette colors map to Tailwind classes; arbitrary hex colors (e.g. notes pinned
  // from the Analysis Inspection Panel's color picker) fall back to an inline style instead.
  const getNoteColorClass = (color: string) => {
    switch (color) {
      case 'yellow':
        return 'bg-[#fef9c3] dark:bg-[#3d381e] border-amber-300 dark:border-amber-700/60 text-amber-950 dark:text-amber-100';
      case 'purple':
        return 'bg-[#f3e8ff] dark:bg-[#341d4c] border-purple-300 dark:border-purple-700/60 text-purple-950 dark:text-purple-100';
      case 'teal':
        return 'bg-[#ccfbf1] dark:bg-[#133d37] border-teal-300 dark:border-teal-700/60 text-teal-950 dark:text-teal-100';
      case 'rose':
        return 'bg-[#ffe4e6] dark:bg-[#431823] border-rose-300 dark:border-rose-700/60 text-rose-950 dark:text-rose-100';
      default:
        return '';
    }
  };

  const getNoteColorStyle = (color: string): React.CSSProperties | undefined => {
    if (NAMED_NOTE_COLORS.includes(color)) return undefined;
    return { backgroundColor: `${color}26`, borderColor: `${color}90`, color: 'inherit' };
  };

  return (
    <div
      ref={readerContentRef}
      className={`min-h-screen flex flex-col transition-colors ${
        isDark ? 'bg-[#121514] text-stone-100' : 'bg-[#f9f9f7] text-[#1c2321]'
      }`}
    >
      {/* Redesigned Floating Selection Glass Tooltip */}
      {selectedText && selectionRange && (
        <div
          className="absolute z-50 transform -translate-x-1/2 -translate-y-full mb-3 flex items-center gap-1 p-1 rounded-full bg-stone-900/95 text-white shadow-2xl backdrop-blur-xl border border-stone-700/80 text-[12px] animate-in fade-in zoom-in-95 duration-150 active:scale-[0.99]"
          style={{ left: `${selectionRange.x}px`, top: `${selectionRange.y}px` }}
        >
          <button
            type="button"
            onClick={() => {
              handleSwitchTab('add');
              handleOpenManualNote(activeParagraphIndex || 0, selectedText);
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full hover:bg-stone-800 text-stone-200 hover:text-white font-medium transition-all cursor-pointer"
          >
            <StickyNoteIcon className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span>Note</span>
          </button>

          <span className="w-px h-3.5 bg-stone-700 mx-0.5" />

          <button
            type="button"
            onClick={() => {
              handleSwitchTab('ai');
              fetchAiSuggestions(activeParagraphIndex || 0, selectedText, 'thematic');
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all cursor-pointer shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-200 shrink-0 animate-pulse" />
            <span>AI Suggest</span>
          </button>

          <span className="w-px h-3.5 bg-stone-700 mx-0.5" />

          <button
            type="button"
            onClick={() => {
              if (activeParagraphIndex !== null) toggleHighlight(activeParagraphIndex);
              setSelectedText('');
              setSelectionRange(null);
            }}
            className="p-1.5 rounded-full hover:bg-stone-800 text-stone-300 hover:text-white transition-all cursor-pointer"
            title="Highlight selection"
          >
            <Highlighter className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              handleSwitchTab('export');
              setSelectedText('');
              setSelectionRange(null);
            }}
            className="p-1.5 rounded-full hover:bg-stone-800 text-stone-300 hover:text-white transition-all cursor-pointer"
            title="Export selection"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Reader Navigation Bar */}
      <header className={`sticky top-0 z-40 px-3 sm:px-6 h-18 border-b flex items-center justify-between gap-2 backdrop-blur-md transition-colors w-full max-w-full overflow-hidden ${
        isDark ? 'bg-[#121514]/90 border-stone-800' : 'bg-[#f9f9f7]/90 border-stone-200/80'
      }`}>
        {/* Left: Back button and Title tightly grouped */}
        <div className="flex items-center gap-2 min-w-0 max-w-[65%] sm:max-w-md">
          <button
            id="reader-back-library-btn"
            type="button"
            onClick={() => onNavigate('home', 'push_back')}
            className="p-1.5 rounded-xl text-stone-700 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            title="Back to Library"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="min-w-0 truncate">
            <h1 className="font-serif text-[16px] sm:text-[18px] font-bold truncate text-stone-900 dark:text-white leading-tight">
              {displayTitle}
            </h1>
            <p className="text-[11px] sm:text-[12px] text-stone-500 truncate leading-tight">
              {displayAuthor || 'Active Reading Session'}
            </p>
          </div>
        </div>

        {/* Top Right Quick Actions */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">

          {/* Settings Button */}
          <button
            id="reader-top-settings-btn"
            type="button"
            onClick={() => onNavigate('settings', 'push')}
            className="p-1.5 sm:p-2 rounded-xl text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            aria-label="Settings"
          >
            <span className="sr-only">Settings</span>
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Reader Control Bar: Icons First, Active Tab Expands to Pill */}
      <div className={`px-3 sm:px-6 py-2 border-b flex items-center justify-between gap-2 text-[12px] w-full max-w-full overflow-x-auto hide-scrollbar ${
        isDark ? 'bg-[#181c1a] border-stone-800/80' : 'bg-[#f2efe9] border-stone-200'
      }`}>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Notes Toggle Pill */}
          <button
            type="button"
            onClick={() => {
              handleSwitchTab('notes');
              setShowNotesDrawer(!showNotesDrawer);
            }}
            className={`flex items-center gap-1.5 transition-all duration-200 cursor-pointer shrink-0 ${
              activeControlTab === 'notes'
                ? 'bg-[#435c52] text-white px-3 py-1.5 rounded-xl font-semibold shadow-xs animate-in fade-in zoom-in-95'
                : 'p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 text-stone-700 dark:text-stone-300'
            }`}
            title={`Sticky Notes (${notes.length})`}
          >
            <StickyNoteIcon className="w-4 h-4" />
            {activeControlTab === 'notes' && (
              <span className="whitespace-nowrap animate-in fade-in duration-150">
                Notes ({notes.length})
              </span>
            )}
          </button>

          {/* Add Manual Note Pill */}
          <button
            type="button"
            onClick={() => {
              handleSwitchTab('add');
              handleOpenManualNote(activeParagraphIndex || 0);
            }}
            className={`flex items-center gap-1.5 transition-all duration-200 cursor-pointer shrink-0 ${
              activeControlTab === 'add'
                ? 'bg-[#435c52] text-white px-3 py-1.5 rounded-xl font-semibold shadow-xs animate-in fade-in zoom-in-95'
                : 'p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 text-stone-700 dark:text-stone-300'
            }`}
            title="Add Manual Note"
          >
            <Plus className="w-4 h-4" />
            {activeControlTab === 'add' && (
              <span className="whitespace-nowrap animate-in fade-in duration-150">
                Add Note
              </span>
            )}
          </button>

          {/* AI Suggestions Pill */}
          <button
            type="button"
            onClick={() => {
              handleSwitchTab('ai');
              fetchAiSuggestions(activeParagraphIndex || 0);
            }}
            className={`flex items-center gap-1.5 transition-all duration-200 cursor-pointer shrink-0 ${
              activeControlTab === 'ai'
                ? 'bg-emerald-600 text-white px-3 py-1.5 rounded-xl font-semibold shadow-xs animate-in fade-in zoom-in-95'
                : 'p-2 rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600/20'
            }`}
            title="AI Suggestions"
          >
            <Bot className="w-4 h-4" />
            {activeControlTab === 'ai' && (
              <span className="whitespace-nowrap animate-in fade-in duration-150">
                AI Suggestions
              </span>
            )}
          </button>

          {/* Export Notes Pill */}
          <button
            id="reader-bar-export-btn"
            type="button"
            onClick={() => {
              handleSwitchTab('export');
            }}
            className={`flex items-center gap-1.5 transition-all duration-200 cursor-pointer shrink-0 ${
              activeControlTab === 'export'
                ? 'bg-[#435c52] text-white px-3 py-1.5 rounded-xl font-semibold shadow-xs animate-in fade-in zoom-in-95'
                : 'p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 text-stone-700 dark:text-stone-300'
            }`}
            title="Export Notes"
          >
            <Download className="w-4 h-4" />
            {activeControlTab === 'export' && (
              <span className="whitespace-nowrap animate-in fade-in duration-150">
                Export Notes
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Reader View Body */}
      <div className="flex-1 flex max-w-6xl mx-auto w-full overflow-hidden">
        {/* Main Reading Text Column */}
        <main className="flex-1 max-w-2xl mx-auto w-full px-5 py-6 space-y-6 pb-8">
          <AnimatePresence mode="wait" custom={slideDirection}>
            {/* TAB 1: READING PASSAGES & MARGIN NOTES */}
            {activeControlTab === 'notes' && (
              <motion.div
                key="notes-tab"
                custom={slideDirection}
                variants={tabVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-6"
              >
                {/* Centered Document / Book Heading */}
                <div 
                  className={`text-center flex flex-col items-center justify-center space-y-2 ${
                    displayParagraphs.length === 0 
                      ? 'min-h-[60vh]' 
                      : 'border-b pb-6 border-stone-200 dark:border-stone-800'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2 flex-wrap text-[11px]">
                    <span className="font-mono font-bold text-[#435c52] dark:text-[#8baaa0] tracking-widest uppercase">
                      {'DOCUMENT'}
                    </span>
                    <span className="text-stone-300 dark:text-stone-700">•</span>
                    <span className="text-stone-500 dark:text-stone-400 italic">
                      Select text to annotate manually or with AI
                    </span>
                  </div>
                  <h2 className="font-serif text-[26px] sm:text-[32px] font-bold leading-tight text-stone-900 dark:text-white">
                    {displayTitle}
                  </h2>
                  {displayAuthor && (
                    <p className="text-[13px] text-stone-500 dark:text-stone-400">
                      {displayAuthor}
                    </p>
                  )}
                </div>

                {displayParagraphs.map((para, idx) => {
                  const notesForThisPara = notes.filter((n) => n.paragraphIndex === idx);
                  const isHighlighted = highlightedParagraphs.includes(idx);

                  return (
                    <div
                      key={para.id}
                      id={`reader-para-${idx}`}
                      onClick={() => setActiveParagraphIndex(idx)}
                      className={`relative group rounded-xl p-2.5 -mx-2.5 transition-all ${
                        activeParagraphIndex === idx
                          ? 'bg-amber-500/5 ring-1 ring-amber-500/30'
                          : 'hover:bg-black/2 dark:hover:bg-white/2'
                      }`}
                    >
                      {/* Paragraph Text */}
                      <p
                        className={`leading-relaxed text-stone-800 dark:text-stone-200 transition-all ${
                          isHighlighted ? 'bg-amber-100/60 dark:bg-amber-950/40 rounded-md px-1.5 py-0.5' : ''
                        }`}
                        style={{
                          fontFamily: settings.typography.includes('Newsreader')
                            ? 'Newsreader, Georgia, serif'
                            : settings.typography.includes('Sans')
                              ? 'Plus Jakarta Sans, sans-serif'
                              : 'Literata, Georgia, serif',
                          fontSize: `${settings.fontSize}px`,
                          lineHeight: '1.75'
                        }}
                      >
                        {para.text}
                      </p>

                      {/* Paragraph Action Toolbar (Manual & AI Triggers) */}
                      <div className="mt-2 flex items-center justify-between opacity-75 group-hover:opacity-100 transition-opacity">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSwitchTab('add');
                              handleOpenManualNote(idx);
                            }}
                            className="text-[11px] font-medium text-stone-600 dark:text-stone-400 hover:text-[#435c52] dark:hover:text-[#98bbae] flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-[#435c52]" />
                            <span>Manual Note</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSwitchTab('ai');
                              fetchAiSuggestions(idx, para.text);
                            }}
                            className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 flex items-center gap-1 cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                            <span>AI Suggestion</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleHighlight(idx);
                            }}
                            className="text-[11px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-300 flex items-center gap-1 cursor-pointer"
                          >
                            <Highlighter className="w-3.5 h-3.5" />
                            <span>{isHighlighted ? 'Unhighlight' : 'Highlight'}</span>
                          </button>
                        </div>

                        {notesForThisPara.length > 0 && (
                          <span className="text-[10px] font-semibold text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/60 px-2 py-0.5 rounded-full">
                            {notesForThisPara.length} {notesForThisPara.length === 1 ? 'annotation' : 'annotations'}
                          </span>
                        )}
                      </div>

                      {/* Inline Sticky Notes pinned to this paragraph */}
                      {showNotesDrawer && notesForThisPara.length > 0 && (
                        <div className="mt-3 space-y-2.5 pl-3 border-l-2 border-[#435c52]/40">
                          {notesForThisPara.map((note) => (
                            <div
                              key={note.id}
                              id={`sticky-note-${note.id}`}
                              className={`p-3.5 rounded-xl border shadow-xs transition-all ${getNoteColorClass(note.color) || 'text-stone-900 dark:text-stone-100'}`}
                              style={getNoteColorStyle(note.color)}
                            >
                              <div className="flex items-start justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  {note.isAiGenerated ? (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0">
                                      <Sparkles className="w-2.5 h-2.5" /> AI
                                    </span>
                                  ) : (
                                    <StickyNoteIcon className="w-3.5 h-3.5 shrink-0 opacity-80" />
                                  )}
                                  <h4 className="font-semibold text-[13px] tracking-tight">
                                    {note.title}
                                  </h4>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {note.themeTag && (
                                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-black/10 dark:bg-white/10">
                                      {note.themeTag}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleEditNote(note);
                                      handleSwitchTab('add');
                                    }}
                                    className="p-0.5 text-stone-500 hover:text-stone-900 dark:hover:text-white transition-colors cursor-pointer"
                                    title="Edit note"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteNote(note.id)}
                                    className="p-0.5 text-stone-500 hover:text-red-600 transition-colors cursor-pointer"
                                    title="Delete note"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              {note.quote && (
                                <div className="text-[11px] italic opacity-80 border-l-2 border-current pl-2 my-1.5 leading-snug">
                                  &ldquo;{note.quote}&rdquo;
                                </div>
                              )}

                              <p className="text-[12px] leading-relaxed mb-2 font-normal">
                                {note.content}
                              </p>

                              <div className="flex items-center justify-between text-[10px] opacity-75 pt-1 border-t border-black/10 dark:border-white/10">
                                <span className="font-medium flex items-center gap-1">
                                  {note.isAiGenerated && <Bot className="w-3 h-3 text-emerald-600" />}
                                  {note.author}
                                </span>
                                <span>{note.timestamp}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </motion.div>
            )}

            {/* TAB 2: INLINE ADD / EDIT STICKY NOTE WORKSPACE */}
            {activeControlTab === 'add' && (
              <motion.div
                key="add-tab"
                custom={slideDirection}
                variants={tabVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="py-2 space-y-4"
              >
                <div className="flex items-center justify-between border-b pb-3 border-stone-200 dark:border-stone-800">
                  <div className="flex items-center gap-2">
                    <StickyNoteIcon className="w-5 h-5 text-[#435c52]" />
                    <h3 className="font-serif font-bold text-[17px] text-stone-900 dark:text-white">
                      {editingNoteId ? 'Edit Sticky Note' : 'Add Manual Sticky Note'}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSwitchTab('notes')}
                    className="text-[12px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Reading</span>
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    handleSaveNote(e);
                    handleSwitchTab('notes');
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="text-[12px] font-semibold text-stone-500 dark:text-stone-400 block mb-1">
                      Note Title
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Hierarchical Modularity or Key Reflection"
                      value={noteFormTitle}
                      onChange={(e) => setNoteFormTitle(e.target.value)}
                      className={`w-full px-3.5 py-2.5 rounded-xl text-[13px] border focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
                        isDark ? 'bg-[#151917] border-stone-700 text-white' : 'bg-stone-50 border-stone-300 text-stone-900'
                      }`}
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="text-[12px] font-semibold text-stone-500 dark:text-stone-400 block mb-1">
                      Theme Tag
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {settings.activeThemes.map((theme) => (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => setNoteFormTheme(theme.name)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                            noteFormTheme === theme.name
                              ? 'bg-[#435c52] text-white shadow-xs'
                              : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
                          }`}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: theme.color }}
                          />
                          <span>{theme.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[12px] font-semibold text-stone-500 dark:text-stone-400 block mb-1">
                      Sticky Color
                    </label>
                    <div className="flex items-center gap-3">
                      {(['yellow', 'purple', 'teal', 'rose'] as const).map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNoteFormColor(color)}
                          className={`w-7 h-7 rounded-full transition-transform border cursor-pointer ${
                            color === 'yellow'
                              ? 'bg-amber-200 border-amber-400'
                              : color === 'purple'
                                ? 'bg-purple-200 border-purple-400'
                                : color === 'teal'
                                  ? 'bg-teal-200 border-teal-400'
                                  : 'bg-rose-200 border-rose-400'
                          } ${noteFormColor === color ? 'scale-125 ring-2 ring-stone-900 dark:ring-white' : 'opacity-70'}`}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[12px] font-semibold text-stone-500 dark:text-stone-400 block mb-1">
                      Quoted Excerpt (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Selected or reference quote..."
                      value={noteFormQuote}
                      onChange={(e) => setNoteFormQuote(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl text-[12px] border italic focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
                        isDark ? 'bg-[#151917] border-stone-700 text-stone-300' : 'bg-stone-50 border-stone-300 text-stone-700'
                      }`}
                    />
                  </div>

                  <div>
                    <label className="text-[12px] font-semibold text-stone-500 dark:text-stone-400 block mb-1">
                      Annotation / Reflection
                    </label>
                    <textarea
                      rows={4}
                      placeholder="Write your note, critique, or synthesis..."
                      value={noteFormText}
                      onChange={(e) => setNoteFormText(e.target.value)}
                      className={`w-full p-3 rounded-xl text-[13px] leading-relaxed resize-none border focus:outline-none focus:ring-1 focus:ring-[#435c52] ${
                        isDark ? 'bg-[#151917] border-stone-700 text-white' : 'bg-stone-50 border-stone-300 text-stone-900'
                      }`}
                      required
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => handleSwitchTab('notes')}
                      className="px-4 py-2 rounded-xl text-[13px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl bg-[#435c52] hover:bg-[#374c43] text-white font-medium text-[13px] transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>{editingNoteId ? 'Update Note' : 'Pin Note to Margin'}</span>
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* TAB 3: INLINE AI SUGGESTIONS WORKSPACE */}
            {activeControlTab === 'ai' && (
              <motion.div
                key="ai-tab"
                custom={slideDirection}
                variants={tabVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="py-2 space-y-4"
              >
                <div className="flex items-center justify-between border-b pb-3 border-stone-200 dark:border-stone-800">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-emerald-600" />
                    <h3 className="font-serif font-bold text-[17px] text-stone-900 dark:text-white">
                      AI Suggestions Workspace
                    </h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fetchAiSuggestions(activeParagraphIndex || 0, undefined, aiFocusMode, true)}
                      disabled={isLoadingAi}
                      className="text-[12px] font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-500 dark:hover:text-emerald-400 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAi ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSwitchTab('notes')}
                      className="text-[12px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Reading</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5 p-1.5 bg-stone-100 dark:bg-stone-800/70 rounded-2xl text-[12px]">
                  {(['thematic', 'metaphor', 'critique', 'summary'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setAiFocusMode(m);
                        fetchAiSuggestions(activeParagraphIndex || 0, undefined, m);
                      }}
                      className={`py-2 rounded-xl capitalize text-center font-medium transition-all cursor-pointer ${
                        aiFocusMode === m
                          ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                          : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-700/50'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {isLoadingAi ? (
                  <div className="py-12 text-center space-y-3">
                    <RefreshCw className="w-7 h-7 animate-spin mx-auto text-[#435c52]" />
                    <p className="text-[13px] text-stone-500 font-medium">Generating AI annotations...</p>
                  </div>
                ) : aiSuggestions.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <Bot className="w-8 h-8 mx-auto text-stone-400" />
                    <p className="text-[13px] text-stone-500">
                      No suggestions generated yet. Click below to analyze passage.
                    </p>
                    <button
                      type="button"
                      onClick={() => fetchAiSuggestions(activeParagraphIndex || 0)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-[12px] font-semibold transition-all cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Generate AI Suggestions</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {aiSuggestions.map((sug, i) => (
                      <div
                        key={i}
                        className={`p-4 rounded-2xl border space-y-2.5 transition-all ${getNoteColorClass(sug.color)}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-[14px]">{sug.title}</h4>
                          <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-black/10 dark:bg-white/10 shrink-0">
                            {sug.themeTag}
                          </span>
                        </div>
                        {sug.quote && (
                          <p className="text-[12px] italic opacity-80 border-l-2 border-current pl-2">
                            &ldquo;{sug.quote}&rdquo;
                          </p>
                        )}
                        <p className="text-[13px] leading-relaxed">{sug.content}</p>
                        {sug.rationale && (
                          <p className="text-[11px] opacity-80 bg-black/5 dark:bg-white/5 p-2 rounded-xl">
                            💡 {sug.rationale}
                          </p>
                        )}
                        <div className="pt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              handleCustomizeAiSuggestion(sug);
                              handleSwitchTab('add');
                            }}
                            className="text-[12px] font-medium px-3 py-1.5 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 cursor-pointer"
                          >
                            Customize
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handlePinAiSuggestion(sug);
                              handleSwitchTab('notes');
                            }}
                            className="text-[12px] font-semibold px-4 py-1.5 rounded-xl bg-[#435c52] hover:bg-[#374c43] text-white flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Pin Note to Margin</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* TAB 4: INLINE EXPORT WORKSPACE */}
            {activeControlTab === 'export' && (
              <motion.div
                key="export-tab"
                custom={slideDirection}
                variants={tabVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="py-2 space-y-5"
              >
                <div className="flex items-center justify-between border-b pb-3 border-stone-200 dark:border-stone-800">
                  <div className="flex items-center gap-2">
                    <Download className="w-5 h-5 text-[#435c52]" />
                    <h3 className="font-serif font-bold text-[17px] text-stone-900 dark:text-white">
                      Export Annotations
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSwitchTab('notes')}
                    className="text-[12px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Reading</span>
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-stone-100 dark:bg-stone-800/60 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-[14px] text-stone-900 dark:text-white">
                        {displayTitle}
                      </h4>
                      <p className="text-[12px] text-stone-500">
                        {exportableNotes.length} of {notes.length} annotations match the filters below
                      </p>
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-[#435c52] text-white">
                      {exportableNotes.length} Notes
                    </span>
                  </div>

                  {/* Filter Controls */}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-1.5 p-1 bg-stone-100 dark:bg-stone-800/70 rounded-xl text-[12px]">
                      {([
                        { key: 'all', label: 'All' },
                        { key: 'manual', label: 'Manual' },
                        { key: 'ai', label: 'AI-Assisted' }
                      ] as const).map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setExportTypeFilter(opt.key)}
                          className={`flex-1 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                            exportTypeFilter === opt.key
                              ? 'bg-[#435c52] text-white shadow-xs'
                              : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-700/50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {['All', ...settings.activeThemes.map((t) => t.name)].map((themeName) => (
                        <button
                          key={themeName}
                          type="button"
                          onClick={() => setSelectedThemeFilter(themeName)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                            selectedThemeFilter === themeName
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
                          }`}
                        >
                          {themeName}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      disabled={exportableNotes.length === 0}
                      onClick={() => {
                        const opts: ExportOptions = {
                          bookTitle: displayTitle,
                          bookAuthor: displayAuthor,
                          filterType: exportTypeFilter,
                          themeFilter: selectedThemeFilter,
                          format: 'pdf',
                          includeQuotes: true,
                          includeAiDetails: true
                        };
                        exportToPDF(exportableNotes, opts);
                      }}
                      className="p-4 rounded-2xl border border-stone-200 dark:border-stone-700 hover:border-[#435c52] dark:hover:border-emerald-500 text-left space-y-2 transition-all cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-stone-200 dark:disabled:hover:border-stone-700"
                    >
                      <Download className="w-5 h-5 text-[#435c52] group-hover:scale-110 transition-transform" />
                      <div>
                        <div className="font-bold text-[13px]">Download PDF</div>
                        <div className="text-[11px] text-stone-500">Printable document</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={exportableNotes.length === 0}
                      onClick={() => {
                        const opts: ExportOptions = {
                          bookTitle: displayTitle,
                          bookAuthor: displayAuthor,
                          filterType: exportTypeFilter,
                          themeFilter: selectedThemeFilter,
                          format: 'markdown',
                          includeQuotes: true,
                          includeAiDetails: true
                        };
                        const content = generateMarkdown(exportableNotes, opts);
                        downloadTextFile(content, `${displayTitle}-annotations.md`, 'text/markdown');
                      }}
                      className="p-4 rounded-2xl border border-stone-200 dark:border-stone-700 hover:border-[#435c52] dark:hover:border-emerald-500 text-left space-y-2 transition-all cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-stone-200 dark:disabled:hover:border-stone-700"
                    >
                      <Download className="w-5 h-5 text-[#435c52] group-hover:scale-110 transition-transform" />
                      <div>
                        <div className="font-bold text-[13px]">Markdown (.md)</div>
                        <div className="text-[11px] text-stone-500">For Obsidian / Notion</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={exportableNotes.length === 0}
                      onClick={() => {
                        const opts: ExportOptions = {
                          bookTitle: displayTitle,
                          bookAuthor: displayAuthor,
                          filterType: exportTypeFilter,
                          themeFilter: selectedThemeFilter,
                          format: 'txt',
                          includeQuotes: true,
                          includeAiDetails: true
                        };
                        const content = generatePlainText(exportableNotes, opts);
                        downloadTextFile(content, `${displayTitle}-annotations.txt`, 'text/plain');
                      }}
                      className="p-4 rounded-2xl border border-stone-200 dark:border-stone-700 hover:border-[#435c52] dark:hover:border-emerald-500 text-left space-y-2 transition-all cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-stone-200 dark:disabled:hover:border-stone-700"
                    >
                      <Download className="w-5 h-5 text-[#435c52] group-hover:scale-110 transition-transform" />
                      <div>
                        <div className="font-bold text-[13px]">Plain Text (.txt)</div>
                        <div className="text-[11px] text-stone-500">Universal text file</div>
                      </div>
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};
