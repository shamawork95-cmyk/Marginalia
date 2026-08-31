export interface DownloadPayload {
  title: string;
  text?: string;
  themes?: Array<{
    id: string;
    title: string;
    color: string;
    excerpts: string[];
    keyQuote?: string;
    mentionsCount?: number;
    confidenceLabel?: string;
    matchedParagraphIndices?: number[];
  }>;
  annotations?: Array<{
    id?: string;
    paragraphIndex: number;
    start?: number;
    end?: number;
    noteText: string;
    timestamp: string;
    color?: string;
  }>;
  customFormats?: Array<{
    paragraphIndex: number;
    start: number;
    end: number;
    type: 'bold' | 'highlight' | 'underline' | 'circle';
    color?: string;
    thickness?: number;
  }>;
  executiveSummary?: string;
  symbols?: Array<{ name: string; description: string }>;
  favoriteQuotes?: string[];
  vocabulary?: Array<{ term: string; definition: string }>;
  /** True when the source upload was a real PDF, whose paragraph chunks are native PDF pages rather than prose paragraphs. */
  isPdfSource?: boolean;
  format: 'pdf' | 'txt' | 'html' | 'docx';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a case-insensitive regex for `phrase` that tolerates whitespace differences between
 * it and the document text — real PDF text extraction routinely inserts irregular whitespace
 * an AI-generated excerpt never has, not just between words but even mid-word from
 * letter-spacing/kerning artifacts ("execu  tives"). Allowing an optional run of whitespace
 * between every character (not just at real word boundaries) makes the match robust to both,
 * matching directly against the ORIGINAL text so found offsets still line up exactly with what
 * gets highlighted.
 */
function buildFuzzyPhraseRegex(phrase: string): RegExp | null {
  const collapsed = phrase.trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;
  const tokens = Array.from(collapsed).map((ch) => (ch === ' ' ? '\\s+' : escapeRegExp(ch)));
  const pattern = tokens.join('\\s*');
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}

/**
 * Runs inside the exported page itself (embedded as a plain <script>, executed by Puppeteer
 * before it prints the PDF) to draw the same doodle arrows the interactive inspection panel
 * draws, using the exact same stacking and cubic-bezier math: it measures each note's real
 * anchor position and card size, pushes overlapping cards apart, and pins each arrow's second
 * control point to the note's own Y so it always arrives perfectly horizontal at the card's
 * left edge. Kept as vanilla JS (not shared TS source) since it has to run standalone in the
 * printed page with no bundler — server.ts waits on `window.__marginaliaLayoutReady` before
 * calling page.pdf() so this always finishes before the page is captured.
 */
const MARGINALIA_LAYOUT_SCRIPT = `
(function () {
  function layout() {
    var rows = document.querySelectorAll('[id^="inspection-paragraph-row-"]');
    rows.forEach(function (row) {
      var pIdx = row.id.replace('inspection-paragraph-row-', '');
      var paraEl = document.getElementById('inspection-paragraph-text-' + pIdx);
      var marginCol = row.querySelector('.marginalia-column');
      var svg = document.getElementById('pdf-arrows-' + pIdx);
      if (!paraEl || !marginCol) return;

      var noteCards = Array.prototype.slice.call(marginCol.querySelectorAll('[id^="note-card-"]'));
      if (noteCards.length === 0) return;

      var paraRect = paraEl.getBoundingClientRect();
      var rowRect = row.getBoundingClientRect();

      var items = noteCards.map(function (card) {
        var noteId = card.id.replace('note-card-', '');
        var markEl = document.getElementById('anno-span-' + noteId);
        var idealTop = 0;
        if (markEl) {
          var rects = markEl.getClientRects();
          var markRect = rects.length > 0 ? rects[0] : markEl.getBoundingClientRect();
          idealTop = Math.max(0, markRect.top - paraRect.top - 10);
        }
        return { id: noteId, card: card, markEl: markEl, idealTop: idealTop, height: card.getBoundingClientRect().height };
      });

      // Stack top-to-bottom: a card can never start above the previous one's bottom edge
      // (plus a 12px gap), so two notes anchored close together never overlap.
      items.sort(function (a, b) { return a.idealTop - b.idealTop; });
      var previousBottom = -Infinity;
      items.forEach(function (item) {
        var top = Math.max(item.idealTop, previousBottom + 12);
        item.top = top;
        item.card.style.top = top + 'px';
        previousBottom = top + item.height;
      });

      var stackedHeight = previousBottom === -Infinity ? 40 : Math.max(40, previousBottom);
      marginCol.style.minHeight = stackedHeight + 'px';
      row.style.minHeight = stackedHeight + 'px';

      if (svg) {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        var svgNS = 'http://www.w3.org/2000/svg';
        items.forEach(function (item) {
          if (!item.markEl) return;
          var markRects = item.markEl.getClientRects();
          var markRect = markRects.length > 0 ? markRects[0] : item.markEl.getBoundingClientRect();
          var cardRect = item.card.getBoundingClientRect();

          var startX = markRect.right - rowRect.left;
          var startY = markRect.top + markRect.height / 2 - rowRect.top;
          var endX = cardRect.left - rowRect.left;
          var endY = cardRect.top + cardRect.height / 2 - rowRect.top;

          // Cubic curve: the first control point dips for an organic hand-drawn arc, the
          // second is pinned to the SAME Y as the end point so the curve's tangent there is
          // perfectly horizontal — the arrowhead marker (orient="auto") follows that tangent,
          // so it always sits straight against the note's left edge.
          var dx = endX - startX;
          var dipY = (startY + endY) / 2 + Math.abs(dx) * 0.08 + 10;
          var c1x = startX + dx * 0.35;
          var c1y = dipY;
          var c2x = startX + dx * 0.75;
          var c2y = endY;

          var color = item.card.getAttribute('data-arrow-color') || '#8b5cf6';
          var markerId = 'pdf-arrowhead-' + item.id;

          var marker = document.createElementNS(svgNS, 'marker');
          marker.setAttribute('id', markerId);
          marker.setAttribute('markerWidth', '6');
          marker.setAttribute('markerHeight', '6');
          marker.setAttribute('refX', '4');
          marker.setAttribute('refY', '3');
          marker.setAttribute('orient', 'auto');
          var markerPath = document.createElementNS(svgNS, 'path');
          markerPath.setAttribute('d', 'M0,0 L6,3 L0,6 Z');
          markerPath.setAttribute('fill', color);
          marker.appendChild(markerPath);
          var defs = document.createElementNS(svgNS, 'defs');
          defs.appendChild(marker);
          svg.appendChild(defs);

          var path = document.createElementNS(svgNS, 'path');
          path.setAttribute('d', 'M ' + startX + ' ' + startY + ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + endX + ' ' + endY);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', color);
          path.setAttribute('stroke-width', '1.5');
          path.setAttribute('stroke-dasharray', '4 3');
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('opacity', '0.6');
          path.setAttribute('marker-end', 'url(#' + markerId + ')');
          svg.appendChild(path);
        });
      }
    });
    window.__marginaliaLayoutReady = true;
  }

  function runWhenPainted() {
    requestAnimationFrame(function () { requestAnimationFrame(layout); });
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(runWhenPainted).catch(layout);
  } else {
    window.addEventListener('load', runWhenPainted);
  }
  // Safety net in case fonts.ready never resolves in the print environment.
  setTimeout(function () { if (!window.__marginaliaLayoutReady) layout(); }, 1500);
})();
`;

export function generateDownloadContent(payload: DownloadPayload): { content: string, contentType: string, extension: string } {
  const { title, text, themes = [], annotations = [], customFormats = [], executiveSummary = '', symbols = [], favoriteQuotes = [], vocabulary = [], isPdfSource = false, format = 'pdf' } = payload;
  const documentTitle = title || 'Document Analysis';
  const cleanText = text || '';
  const paragraphs = cleanText.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const unitLabel = (pIdx: number) => (isPdfSource ? `Page ${pIdx + 1}` : `Paragraph ${pIdx + 1}`);

  if (format === 'txt') {
    let content = `========================================================================\n`;
    content += `MARGINALIA ANNOTATED DOCUMENT EXPORT\n`;
    content += `Title: ${documentTitle}\n`;
    content += `Export Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
    content += `========================================================================\n\n`;

    if (executiveSummary) {
      content += `--- AI OVERVIEW ---\n${executiveSummary}\n\n`;
    }

    content += `--- KEY THEMES ---\n`;
    themes.forEach((theme, idx) => {
      content += `${idx + 1}. ${theme.title}\n`;
    });
    content += `\n========================================================================\n`;
    content += `FULL DOCUMENT TEXT & STICKY NOTES\n`;
    content += `========================================================================\n\n`;

    paragraphs.forEach((para, pIdx) => {
      content += `[${unitLabel(pIdx)}]\n${para}\n`;

      const paraNotes = annotations.filter((a) => a.paragraphIndex === pIdx);
      if (paraNotes.length > 0) {
        paraNotes.forEach((n) => {
          content += `  [📌 STICKY NOTE - ${n.timestamp}]: "${n.noteText}"\n`;
        });
      }
      content += `\n`;
    });

    return { content, contentType: 'text/plain;charset=utf-8', extension: 'txt' };
  }

  // Generate HTML for PDF/HTML/DOCX
  const buildHighlightedParaText = (paraStr: string, pIdx: number, paraNotes: Array<{ id: string; start?: number }> = []) => {
    const lowerPara = paraStr.toLowerCase();
    const intervals: { start: number; end: number; color?: string }[] = [];

    themes.forEach(theme => {
      if (theme.matchedParagraphIndices?.includes(pIdx)) {
        intervals.push({ start: 0, end: paraStr.length, color: theme.color });
      } else {
        const rawPhrases = [...(theme.excerpts || [])];
        if (theme.keyQuote) rawPhrases.push(theme.keyQuote);
        if (theme.title) rawPhrases.push(theme.title);

      const phrasesToFind: string[] = [];
      rawPhrases.forEach((phrase) => {
        if (!phrase) return;
        const clean = phrase.replace(/["'“”‘’]/g, '').trim();
        if (clean.length >= 3) phrasesToFind.push(clean);
        const matches = phrase.match(/['"“]([^'"”]+)['"”]/g);
        if (matches) {
          matches.forEach((m) => {
            const sub = m.replace(/["'“”‘’]/g, '').trim();
            if (sub.length >= 3) phrasesToFind.push(sub);
          });
        }
      });

      const uniquePhrases = Array.from(new Set(phrasesToFind))
        .filter((p) => p.length >= 3)
        .sort((a, b) => b.length - a.length);

      let foundAny = false;
      uniquePhrases.forEach((phrase) => {
        const regex = buildFuzzyPhraseRegex(phrase);
        if (!regex) return;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(paraStr)) !== null) {
          intervals.push({ start: match.index, end: match.index + match[0].length, color: theme.color });
          foundAny = true;
          if (match[0].length === 0) regex.lastIndex += 1;
        }
      });

      if (!foundAny && theme.title) {
        const words = theme.title.split(/\s+/).filter((w) => w.length >= 4);
        words.forEach((w) => {
          const lowerW = w.toLowerCase();
          let pos = 0;
          while ((pos = lowerPara.indexOf(lowerW, pos)) !== -1) {
            intervals.push({ start: pos, end: pos + w.length, color: theme.color });
            pos += Math.max(1, w.length);
          }
        });
      }
      }
    });

    // Note: no early-return for a paragraph with zero AI theme matches — this text can still
    // carry custom formats and note anchors of its own, and skipping straight to plain
    // `escapeHtml` here used to silently drop both.
    const customFs = (customFormats || []).filter(cf => cf.paragraphIndex === pIdx);

    const charStyles = new Array(paraStr.length).fill(null).map(() => ({
      bg: '',
      fw: 'normal',
      bb: 'none',
      ai: false,
      userFormats: [] as string[],
      color: '',
      circleColor: '',
      circleThickness: 2,
      removeUnderline: false,
      anchorId: ''
    }));

    // Write each theme's raw (unmerged) intervals directly, first claim wins per character —
    // mirroring the interactive panel's own resolution — instead of pre-merging overlapping
    // intervals by start position first. That merge used to silently discard whichever theme's
    // color lost the sort/tie-break, so a paragraph could render in a completely different
    // theme's color than what the reader actually sees highlighted on screen. It also never
    // forces bold weight on AI-matched text: the panel only tints the background, so the export
    // matching it means no more spurious bold text throughout the document.
    intervals.forEach((inter) => {
      for (let i = inter.start; i < inter.end && i < paraStr.length; i++) {
        if (charStyles[i].ai) continue;
        const themeColor = inter.color || '#8b5cf6';
        charStyles[i].bg = `${themeColor}20`;
        charStyles[i].bb = `none`;
        charStyles[i].ai = true;
        charStyles[i].color = themeColor;
      }
    });

    customFs.forEach(cf => {
      for (let i = cf.start; i < cf.end && i < paraStr.length; i++) {
        if (cf.type === 'bold') {
          charStyles[i].fw = 'bold';
          charStyles[i].userFormats.push('bold');
        } else if (cf.type === 'highlight') {
          charStyles[i].bg = `${cf.color || '#fef08a'}35`;
          charStyles[i].userFormats.push('highlight');
        } else if (cf.type === 'underline') {
          charStyles[i].userFormats.push('underline');
          charStyles[i].color = cf.color || '#10b981';
        } else if (cf.type === 'circle') {
          charStyles[i].userFormats.push('circle');
          charStyles[i].circleColor = cf.color || '#ef4444';
          charStyles[i].circleThickness = cf.thickness || 2;
        } else if (cf.type === 'remove-bold') {
          // Legacy negation from older saved documents, from back when the AI forced bold on
          // its own matches — a no-op now since AI matches never carry forced bold weight.
          charStyles[i].fw = 'normal';
        } else if (cf.type === 'remove-underline') {
          charStyles[i].removeUnderline = true;
        } else if (cf.type === 'remove-highlight') {
          charStyles[i].bg = '';
        }
      }
    });

    // Tags the exact character where each note's selection begins, so the arrow-layout
    // script (run once the PDF page has rendered) can locate it via `getElementById` and
    // draw a doodle arrow to that note's card — the same `anno-span-{id}` convention the
    // interactive inspection panel uses. Deliberately included in `getStyleStr` below so it
    // forces its own tiny group boundary right there, without touching any visible styling.
    paraNotes.forEach((note) => {
      if (typeof note.start === 'number' && note.start >= 0 && note.start < charStyles.length) {
        charStyles[note.start].anchorId = note.id;
      }
    });

    const getStyleStr = (s: typeof charStyles[0]) =>
      `${s.bg}|${s.fw}|${s.bb}|${s.ai}|${s.userFormats.join(',')}|${s.color}|${s.circleColor}|${s.circleThickness}|${s.removeUnderline}|${s.anchorId}`;

    let currentGroup = '';
    let currentStyleStr = charStyles.length > 0 ? getStyleStr(charStyles[0]) : '';
    let groupStart = 0;
    let nodes: string[] = [];

    const renderNode = (text: string, style: typeof charStyles[0], anchorId: string) => {
      let styleAttr = '';
      if (style.bg && style.bg !== 'transparent') styleAttr += `background-color: ${style.bg}; `;
      if (style.fw !== 'normal') styleAttr += `font-weight: ${style.fw}; `;
      if (style.userFormats.includes('underline')) {
        styleAttr += `text-decoration: underline; text-decoration-color: ${style.color || '#10b981'}; text-decoration-thickness: 2px; text-underline-offset: 4px; `;
      }

      const isCircled = style.userFormats.includes('circle');
      if (isCircled) {
        // Mirrors the reader's own circle-format CSS so the PDF looks identical: an elliptical
        // border looped tightly around the word without pushing surrounding line-height apart.
        styleAttr += `border: ${style.circleThickness}px solid ${style.circleColor}; border-radius: 50% / 30%; padding: 0.1em 0.4em; margin: 0 -0.1em; display: inline-block; `;
      } else {
        styleAttr += `padding: 0; border-radius: 2px; `;
      }

      const idAttr = anchorId ? ` id="anno-span-${anchorId}"` : '';
      if (styleAttr) {
        return `<mark${idAttr} style="${styleAttr} color: inherit;">${escapeHtml(text)}</mark>`;
      }
      return anchorId ? `<span${idAttr}>${escapeHtml(text)}</span>` : escapeHtml(text);
    };

    charStyles.forEach((cs, i) => {
      const sStr = getStyleStr(cs);
      if (i === 0) {
        currentGroup += paraStr[i];
      } else {
        if (sStr === currentStyleStr) {
          currentGroup += paraStr[i];
        } else {
          nodes.push(renderNode(currentGroup, charStyles[i - 1], charStyles[groupStart].anchorId));
          currentGroup = paraStr[i];
          currentStyleStr = sStr;
          groupStart = i;
        }
      }
    });

    if (currentGroup.length > 0) {
      nodes.push(renderNode(currentGroup, charStyles[charStyles.length - 1], charStyles[groupStart].anchorId));
    }

    return nodes.join('');
  };

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(documentTitle)} - Marginalia Analysis</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&display=swap" rel="stylesheet">
  <style>
    @page { margin: 20mm; size: auto; }
    body { 
      font-family: 'Georgia', serif; 
      line-height: 1.7; 
      color: #1c1917; 
      max-width: 1200px; 
      margin: 40px auto; 
      padding: 0 40px; 
      background: #fafaf9; 
    }
    mark { background-color: transparent; }
    h1 { font-size: 32px; border-bottom: 2px solid #e7e5e4; padding-bottom: 12px; margin-bottom: 30px; font-weight: normal; }
    
    .theme-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 40px; }
    .badge { display: inline-block; padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: bold; color: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }

    .ai-overview {
      font-family: 'Georgia', serif;
      font-style: italic;
      font-size: 16px;
      line-height: 1.6;
      color: #44403c;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 4px solid #16a34a;
      border-radius: 8px;
      padding: 20px 24px;
      margin-bottom: 32px;
    }
    .ai-overview .label { font-family: sans-serif; font-style: normal; font-size: 11px; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase; color: #16a34a; display: block; margin-bottom: 8px; }

    .analysis-appendix { margin-top: 60px; padding-top: 32px; border-top: 2px solid #e7e5e4; page-break-before: always; }
    .appendix-title { font-size: 24px; font-weight: normal; margin-bottom: 24px; }
    .appendix-section { margin-bottom: 32px; }
    .appendix-heading { font-family: sans-serif; font-size: 12px; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase; color: #78716c; margin-bottom: 12px; }
    .appendix-theme-row { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
    .appendix-swatch { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
    .appendix-theme-title { font-weight: bold; }
    .appendix-theme-desc { font-size: 13px; color: #57534e; margin-top: 2px; }
    .appendix-quote { font-style: italic; font-size: 15px; padding: 10px 0 10px 16px; border-left: 2px solid #d6d3d1; margin-bottom: 8px; }
    .appendix-vocab-term { font-weight: bold; }
    .appendix-vocab-def { font-size: 13px; color: #57534e; }

    .document-grid {
      display: grid;
      grid-template-columns: 3fr 1fr;
      gap: 40px;
      align-items: start;
      page-break-inside: avoid;
      position: relative;
    }

    .pdf-arrow-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 5; }

    .para-container { position: relative; z-index: 2; }
    .meta { font-size: 12px; color: #a8a29e; margin-bottom: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; font-family: sans-serif; }
    .para-text { font-size: 16px; margin: 0; background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); border: 1px solid #f5f5f4; }

    .marginalia-column {
      position: relative;
      padding-top: 24px;
    }

    .sticky-note-box {
      position: absolute;
      left: 0.5rem;
      right: 0.5rem;
      top: 0;
      border-radius: 12px;
      padding: 10px;
      color: #1c1917;
      transform: rotate(-1.5deg);
      border: 1px solid;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1);
      z-index: 10;
    }
    .sticky-note-header { font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #b45309; margin-bottom: 6px; font-family: sans-serif; opacity: 0.8; }
    .sticky-note-text { font-family: 'Caveat', cursive; font-size: 22px; font-weight: 700; margin: 0; line-height: 1.3; color: #1c1917; }

    @media print {
      body { background: white; margin: 0; padding: 0; max-width: 100%; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .document-grid { grid-template-columns: 3fr 1fr; gap: 20px; page-break-inside: avoid; }
      .para-container, .sticky-note-box { page-break-inside: avoid; }
      .para-text { border: none; padding: 0; box-shadow: none; margin-bottom: 20px; }
    }

    @media (max-width: 768px) {
      .document-grid { grid-template-columns: 1fr; gap: 16px; }
      .marginalia-column { padding-top: 0; padding-left: 20px; }
      .pdf-arrow-svg { display: none; }
      .sticky-note-box { position: static; transform: none; margin-bottom: 16px; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(documentTitle)}</h1>

  ${executiveSummary ? `
  <div class="ai-overview">
    <span class="label">AI Overview</span>
    &ldquo;${escapeHtml(executiveSummary)}&rdquo;
  </div>` : ''}

  <div class="theme-badges">
    ${themes.map(t => `<div class="badge" style="background-color: ${t.color}">${escapeHtml(t.title)}</div>`).join('')}
  </div>

  <div class="document-container">
    ${paragraphs.map((para, pIdx) => {
      const rawParaNotes = annotations.filter((a) => a.paragraphIndex === pIdx);
      const themeColor = themes.length > 0 ? themes[0].color : '#8b5cf6';
      // Every note needs a stable id shared between its `anno-span-{id}` text anchor and its
      // `note-card-{id}` margin card so the layout script can pair them up — annotations always
      // carry a real one in practice, this is just a safety net for the rare one that doesn't.
      const paraNotes = rawParaNotes.map((n, aIdx) => ({ ...n, id: n.id || `note-${pIdx}-${aIdx}` }));

      return `
        <div class="document-grid" id="inspection-paragraph-row-${pIdx}">
          ${paraNotes.length > 0 ? `<svg id="pdf-arrows-${pIdx}" class="pdf-arrow-svg"></svg>` : ''}
          <div class="main-column">
            <div class="para-container">
              <div class="meta">${escapeHtml(unitLabel(pIdx))}</div>
              <p class="para-text" id="inspection-paragraph-text-${pIdx}">${buildHighlightedParaText(para, pIdx, paraNotes)}</p>
            </div>
          </div>

          <div class="marginalia-column" style="min-height: ${Math.max(40, paraNotes.length * 100)}px;">
            ${paraNotes.map((n, aIdx) => {
              const noteColor = n.color || themeColor;
              return `
              <div class="sticky-note-box" id="note-card-${n.id}" data-arrow-color="${noteColor}" style="top: ${aIdx * 100}px; background-color: color-mix(in srgb, ${noteColor} 35%, white); border-color: ${noteColor}60;">
                <div class="sticky-note-header">${escapeHtml(n.timestamp)}</div>
                <p class="sticky-note-text">&ldquo;${escapeHtml(n.noteText)}&rdquo;</p>
              </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('')}
  </div>

  ${(themes.length > 0 || symbols.length > 0 || favoriteQuotes.length > 0 || vocabulary.length > 0) ? `
  <div class="analysis-appendix">
    <h2 class="appendix-title">Analysis Appendix</h2>

    ${themes.length > 0 ? `
    <div class="appendix-section">
      <div class="appendix-heading">Extracted Themes</div>
      ${themes.map(t => `
        <div class="appendix-theme-row">
          <span class="appendix-swatch" style="background-color: ${t.color};"></span>
          <div>
            <div class="appendix-theme-title">${escapeHtml(t.title)}</div>
            ${t.keyQuote ? `<div class="appendix-theme-desc">&ldquo;${escapeHtml(t.keyQuote)}&rdquo;</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    ${symbols.length > 0 ? `
    <div class="appendix-section">
      <div class="appendix-heading">Symbols &amp; Metaphors</div>
      ${symbols.map(s => `
        <div class="appendix-theme-row">
          <div>
            <div class="appendix-theme-title">${escapeHtml(s.name)}</div>
            <div class="appendix-theme-desc">${escapeHtml(s.description)}</div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    ${favoriteQuotes.length > 0 ? `
    <div class="appendix-section">
      <div class="appendix-heading">Favorite Quotes</div>
      ${favoriteQuotes.map(q => `<div class="appendix-quote">&ldquo;${escapeHtml(q)}&rdquo;</div>`).join('')}
    </div>` : ''}

    ${vocabulary.length > 0 ? `
    <div class="appendix-section">
      <div class="appendix-heading">Vocabulary &amp; Terminology</div>
      ${vocabulary.map(v => `
        <div class="appendix-theme-row">
          <div>
            <div class="appendix-vocab-term">${escapeHtml(v.term)}</div>
            <div class="appendix-vocab-def">${escapeHtml(v.definition)}</div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}
  </div>` : ''}

  <script>${MARGINALIA_LAYOUT_SCRIPT}</script>
</body>
</html>`;

  const ext = format === 'docx' ? 'doc' : 'html';
  return { content: html, contentType: 'text/html;charset=utf-8', extension: ext };
}
