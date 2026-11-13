/**
 * The PDF workspace's tool state: the armed tool, the theme new marks are filed under, and each
 * tool's own colour, weight, dash, note fill, bracket side and text-box type (moved verbatim from
 * PdfWorkspace).
 */

import { useState, useCallback } from 'react';
import { UserSettings } from '../../../types';
import {
  BracketSide,
  NoteStyle,
  DEFAULT_TEXT_SIZE,
  PdfTool,
  StrokeStyle,
  TextAlign,
  TextFont
} from '../annotationModel';
import { NEUTRAL_COLORS } from '../PdfToolbar';
import { useKnownTheme } from '../../../hooks/knownTheme';

export interface UsePdfToolStylesDeps {
  settings: UserSettings;
}

export function usePdfToolStyles(deps: UsePdfToolStylesDeps) {
  const { settings } = deps;

  const [tool, setTool] = useState<PdfTool>('select');
  const [activeThemeId, setActiveThemeId] = useState<string | null>(settings.activeThemes[0]?.id ?? null);
  // Never a theme that is not in the list (see knownTheme.ts).
  useKnownTheme(activeThemeId, setActiveThemeId, settings.activeThemes);

  /**
   * A colour per tool, rather than one shared colour.
   *
   * Highlighting in yellow while underlining in red is the normal way people mark up a document,
   * and a single active colour forced a trip to the palette on every switch. Each tool remembers
   * its own, seeded from the themes so the defaults are already meaningful.
   */
  const [toolColors, setToolColors] = useState<Record<string, string>>(() => {
    const themes = settings.activeThemes;
    const pick = (index: number) => themes[index % Math.max(themes.length, 1)]?.color ?? NEUTRAL_COLORS[0];
    return {
      highlight: pick(0),
      area: pick(0),
      underline: pick(1),
      strikeout: pick(2),
      question: pick(3),
      star: pick(4),
      exclamation: pick(5),
      ink: pick(0),
      // Redaction reads as black by convention, independent of whatever theme colours are active.
      mask: '#000000',
      note: pick(0),
      rect: pick(1),
      ellipse: pick(1),
      arrow: pick(2),
      line: pick(2),
      text: pick(0)
    };
  });
  /** Stroke weight per tool, so a heavy pen and a fine box can coexist. */
  const [toolWeights, setToolWeights] = useState<Record<string, number>>({
    ink: 0.0028,
    // Much thicker than the pen by default — a mask needs to fully cover a line of text, not
    // trace it.
    mask: 0.02,
    rect: 0.0028,
    ellipse: 0.0028,
    arrow: 0.0028,
    line: 0.0028,
    underline: 0.0028,
    strikeout: 0.0028,
    // Stroked like the shapes, and without an entry its weight picker opened with no step
    // selected until the reader picked one.
    bracket: 0.0028
  });
  const setToolWeight = useCallback(
    (which: string, weight: number) => setToolWeights((prev) => ({ ...prev, [which]: weight })),
    []
  );

  /**
   * Dash pattern per tool, note fill and bracket direction.
   *
   * Per tool for the same reason colour is: a reader who rules solid boxes and dotted brackets
   * should not have to reset the dash pattern every time they switch between them.
   */
  const [toolStrokeStyles, setToolStrokeStyles] = useState<Record<string, StrokeStyle>>({});
  const setToolStrokeStyle = useCallback(
    (which: string, style: StrokeStyle) => setToolStrokeStyles((prev) => ({ ...prev, [which]: style })),
    []
  );
  const [noteStyle, setNoteStyle] = useState<NoteStyle>('outline');
  const [bracketSide, setBracketSide] = useState<BracketSide>('left');
  const [textSize, setTextSize] = useState<number>(DEFAULT_TEXT_SIZE);
  const [textAlign, setTextAlign] = useState<TextAlign>('left');
  const [textFont, setTextFont] = useState<TextFont>('sans');
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);

  const activeColor = toolColors[tool] ?? NEUTRAL_COLORS[0];
  const setToolColor = useCallback(
    (which: string, color: string) => setToolColors((prev) => ({ ...prev, [which]: color })),
    []
  );

  return { activeColor, activeThemeId, bracketSide, noteStyle, setActiveThemeId, setBracketSide, setNoteStyle, setTextAlign, setTextBold, setTextFont, setTextItalic, setTextSize, setTool, setToolColor, setToolStrokeStyle, setToolWeight, textAlign, textBold, textFont, textItalic, textSize, tool, toolColors, toolStrokeStyles, toolWeights };
}
