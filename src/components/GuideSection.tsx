/**
 * "Getting the most from Marginalia" at the foot of My Collections: one collapsible group per area
 * (Reading, Marking, Notes, Themes, Finding, Exporting), each feature a real screenshot with a
 * caption (`data/guide.ts`, pictures made by `scripts/capture-guide.cjs`). The first-launch tour
 * links here. Which groups are open is not kept: the section starts folded, out of the way.
 */

import React, { useState } from 'react';
import { ChevronDown, Lightbulb } from './icons';
import { GUIDE_GROUPS, type GuideGroupId } from '../data/guide';

/** The screenshots, found by file name; a missing one leaves its caption standing alone. */
const IMAGES = import.meta.glob('../assets/guide/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const imageFor = (id: string) => IMAGES[`../assets/guide/${id}.jpg`];

export const GUIDE_SECTION_ID = 'getting-the-most';

/** Scrolls My Collections to the guide (the tour's "See the full guide"). */
export function showGuide(): void {
  const el = document.getElementById(GUIDE_SECTION_ID);
  if (!el) return;
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
}

export const GuideSection: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const [open, setOpen] = useState<Set<GuideGroupId>>(new Set());
  const toggle = (id: GuideGroupId) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      id={GUIDE_SECTION_ID}
      aria-labelledby="guide-title"
      className={`scroll-mt-6 rounded-2xl border overflow-hidden ${isDark ? 'border-stone-800/80 bg-night-4' : 'border-stone-200/70 bg-[#f7f5f0]'}`}
    >
      <div className="px-5 pt-5 pb-3 flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-gold/10 dark:bg-gold/15 flex items-center justify-center text-gold">
          <Lightbulb className="w-4 h-4" />
        </div>
        <div>
          <h2 id="guide-title" className="title-hand text-[26px] text-stone-900 dark:text-stone-100 leading-none">
            Getting the most from Marginalia
          </h2>
          <p className="text-[12.5px] text-muted mt-1">Each feature, as it looks in the app. Open a group to see it.</p>
        </div>
      </div>
      <div className={`divide-y ${isDark ? 'divide-stone-800/80' : 'divide-stone-200/70'}`}>
        {GUIDE_GROUPS.map((group) => {
          const isOpen = open.has(group.id);
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={isOpen}
                aria-controls={`guide-${group.id}`}
                className={`w-full flex items-center justify-between gap-3 px-5 py-3 text-left cursor-pointer transition-colors ${
                  isDark ? 'hover:bg-white/3' : 'hover:bg-black/3'
                }`}
              >
                <span className="caps font-spine text-stone-800 dark:text-stone-200">{group.title}</span>
                <span className="flex items-center gap-2 text-[11.5px] text-muted font-spine">
                  {group.features.length}
                  <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`} />
                </span>
              </button>
              {isOpen && (
                <ul id={`guide-${group.id}`} className="px-5 pb-5 pt-1 grid gap-5 sm:grid-cols-2">
                  {group.features.map((f) => {
                    const src = imageFor(f.id);
                    return (
                      <li key={f.id}>
                        <figure className="space-y-2">
                          {src && (
                            <img
                              src={src}
                              alt={`${f.title}: ${f.caption}`}
                              loading="lazy"
                              decoding="async"
                              className={`w-full rounded-xl border shadow-xs ${isDark ? 'border-stone-800' : 'border-stone-200'}`}
                            />
                          )}
                          <figcaption>
                            <h3 className="font-semibold text-[13.5px] text-stone-900 dark:text-paper">{f.title}</h3>
                            <p className="text-[12.5px] text-muted leading-snug">{f.caption}</p>
                          </figcaption>
                        </figure>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
