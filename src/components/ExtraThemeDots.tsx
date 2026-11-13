/**
 * The small dots before a mark filed under several themes: the mark is drawn in its main theme's
 * colour, and each other theme shows as a dot (up to three, then "+n"). Hovering names them.
 *
 * No text nodes inside, the "+n" included (it is CSS content): the reader counts character offsets
 * through its paragraphs' text, and these dots sit inside a paragraph.
 */

import React from 'react';
import { extraThemeDots } from '../utils/markThemes';

export const ExtraThemeDots: React.FC<{
  themeIds: readonly string[] | undefined;
  themes: readonly { id: string; name: string; color: string }[];
  className?: string;
  style?: React.CSSProperties;
}> = ({ themeIds, themes, className = '', style }) => {
  const { dots, more, label } = extraThemeDots(themeIds, themes);
  if (!dots.length) return null;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-mark-ui
      data-more={more ? `+${more}` : undefined}
      className={`inline-flex items-center gap-[2px] select-none whitespace-nowrap leading-none after:text-[9px] after:font-semibold after:text-muted after:content-[attr(data-more)] ${className}`}
      style={style}
    >
      {dots.map((d) => (
        <span key={d.id} className="block w-[6px] h-[6px] rounded-full ring-1 ring-black/15 dark:ring-white/30" style={{ backgroundColor: d.color }} />
      ))}
    </span>
  );
};
