/**
 * The library as a bookshelf.
 *
 * Every stored document stands on one shelf as a spine: thickness follows its length, colour and
 * height are fixed per book (hashed from its id, so a book keeps its look between visits), and a
 * ribbon peeks out of any book that carries marks. Pointing at a spine, or tabbing to it, lifts
 * it and writes its name above the shelf. Choosing it pulls it out of its slot (the gap stays), carries
 * it down to the desk and opens it at its first page; there it can be read, renamed, deleted, or put
 * back, and it travels back into its slot.
 *
 * When sorted by recency, gold bookends divide the shelf by month.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { type StoredDocumentMeta } from '../utils/documentStorage';
import { plural } from '../utils/plural';
import {
  Pose,
  Flight,
  DESK_TILT,
  SWAP_DELAY,
  SCROLL_KEYS,
  keyboardFocus,
  pageScroller,
  FlyingBook,
  zoomIntoReader
} from './shelf/shelfMotion';
import {
  formatBytes,
  DocumentCover,
  spineLook,
  stageScale,
  progressLabel,
  clothVars,
  monthLabel,
  ShelfItem,
  SpineFace,
  Doodle
} from './shelf/shelfLook';


interface BookshelfProps {
  docs: StoredDocumentMeta[];
  groupByMonth: boolean;
  themes: { id: string; name: string; color: string }[];
  busyId: string | null;
  onOpen: (doc: StoredDocumentMeta) => void;
  onRename: (id: string, title: string) => Promise<void>;
  /** Resolves true once the document is gone. */
  onDelete: (id: string) => Promise<boolean>;
}

const EXPO = [0.16, 1, 0.3, 1] as const;
/** Ease-in-out cubic, the flight's own curve: no overshoot. */
const IN_OUT = [0.65, 0, 0.35, 1] as const;
/** Seconds the desk takes to open: it is fully open as the book lands (pull + arc + land). */
const DESK_OPEN = 1.0;

export const Bookshelf: React.FC<BookshelfProps> = ({ docs, groupByMonth, themes, busyId, onOpen, onRename, onDelete }) => {
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const deskBookRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<HTMLButtonElement>(null);
  const spineRefs = useRef(new Map<string, HTMLButtonElement>());
  /** Where each book in the air was last drawn, so a new flight can start from there. */
  const poses = useRef(new Map<string, Pose>());
  const flightKey = useRef(0);
  /** Counts shelf scrolls and stage resizes, so a book in the air knows when to re-measure its target. */
  const layoutEpoch = useRef(0);
  const restTimer = useRef(0);
  /** Which desk button Previous/Next was pressed with, to focus again once the card remounts. */
  const refocus = useRef<'prev' | 'next' | null>(null);
  /** Stops the page scroll that follows a book, if one is running. */
  const stopPageScroll = useRef<(() => void) | null>(null);

  const [pointed, setPointed] = useState<string | null>(null);
  const [captionX, setCaptionX] = useState(0);
  /** Where the pointer arrow sits: just above the lifted book's top edge, never inside the caption band. */
  const [pointerTop, setPointerTop] = useState(0);
  /** The book whose details are on the desk. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The book lying open on the desk (it has finished its flight). */
  const [landedId, setLandedId] = useState<string | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  /** 'swap' when Previous/Next changed the book on an open desk. */
  const [entry, setEntry] = useState<'enter' | 'swap'>('enter');
  const [stopId, setStopId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [k, setK] = useState(1);
  const look = useCallback((doc: StoredDocumentMeta) => spineLook(doc, k), [k]);

  const items = useMemo<ShelfItem[]>(() => {
    const out: ShelfItem[] = [];
    let lastMonth = '';
    for (const doc of docs) {
      if (groupByMonth) {
        const month = monthLabel(doc.updatedAt);
        if (month !== lastMonth) {
          out.push({ kind: 'bookend', key: `end-${month}`, label: month });
          lastMonth = month;
        }
      }
      out.push({ kind: 'book', doc });
    }
    return out;
  }, [docs, groupByMonth]);

  // The shelf's width at scale 1: spines, 2px gaps, bookends (30px + 3px margins).
  const span = useMemo(
    () => items.reduce((sum, it) => sum + (it.kind === 'book' ? spineLook(it.doc).width : 36) + 2, -2),
    [items]
  );

  /** Fade whichever end of the shelf has more books beyond it (set directly: it changes on every scroll). */
  const markEdges = useCallback(() => {
    const row = scrollerRef.current;
    if (!row) return;
    row.toggleAttribute('data-more-l', row.scrollLeft > 1);
    row.toggleAttribute('data-more-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const row = scrollerRef.current;
    if (!stage || !row) return;
    const fit = () => {
      layoutEpoch.current++;
      const pad = parseFloat(getComputedStyle(row).paddingLeft) * 2;
      setK(stageScale(stage.clientWidth, pad, span));
      markEdges();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    ro.observe(row);
    return () => ro.disconnect();
  }, [markEdges, span]);

  const byId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const selectedIndex = selected ? docs.findIndex((d) => d.id === selected.id) : -1;
  const flying = new Set(flights.map((f) => f.id));
  const isOut = (id: string) => id === selectedId || flying.has(id);
  const pointedDoc = pointed && !isOut(pointed) ? byId.get(pointed) ?? null : null;

  // A book that leaves the library (deleted, filtered out) leaves the desk too.
  useEffect(() => {
    if (selectedId && !byId.has(selectedId)) setSelectedId(null);
    if (pointed && !byId.has(pointed)) setPointed(null);
    if (landedId && !byId.has(landedId)) setLandedId(null);
    // A book deleted mid-flight takes its flight (and its last drawn pose) with it.
    setFlights((fs) => (fs.some((f) => !byId.has(f.id)) ? fs.filter((f) => byId.has(f.id)) : fs));
    for (const id of poses.current.keys()) if (!byId.has(id)) poses.current.delete(id);
  }, [byId, selectedId, pointed, landedId]);

  // A rename closes its field once the new title lands; a failed rename keeps the field and draft.
  const selectedTitle = selected?.title;
  useEffect(() => setRenaming(false), [selectedTitle]);

  // The one spine that takes Tab; the arrow keys move along the shelf from there.
  const tabStop = stopId && byId.has(stopId) ? stopId : docs[0]?.id ?? null;

  const placeCaption = useCallback((id: string) => {
    const el = spineRefs.current.get(id);
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    // `.shelf-row` is positioned, so a spine's offsets are relative to the row's unscrolled content;
    // the row's own offsets bring them into the stage, where the caption and arrow live.
    setCaptionX(scroller.offsetLeft + el.offsetLeft - scroller.scrollLeft + el.offsetWidth / 2);
    // 20px lift, 26px of arrow, a little air; never up into the caption band (it ends ~64px down).
    setPointerTop(Math.max(68, scroller.offsetTop + el.offsetTop - 20 - 30));
  }, []);

  const point = (id: string) => {
    window.clearTimeout(restTimer.current);
    setPointed(id);
    placeCaption(id);
  };

  /** Nothing under the pointer: back to rest, unless a spine holds visible keyboard focus. */
  const rest = () => {
    window.clearTimeout(restTimer.current);
    const el = document.activeElement;
    const id = [...spineRefs.current].find(([, s]) => s === el)?.[0];
    if (id && el && keyboardFocus(el)) point(id);
    else setPointed(null);
  };
  // The 2px gaps between spines would flicker the caption; a short grace lets the next spine take over.
  const restSoon = () => {
    window.clearTimeout(restTimer.current);
    restTimer.current = window.setTimeout(rest, 90);
  };
  useEffect(() => () => window.clearTimeout(restTimer.current), []);

  /* Poses in stage coordinates, so page scroll during a flight moves both ends together. */
  const centreOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = stageRef.current!.getBoundingClientRect();
    return { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top };
  };
  const slotPose = (id: string): Pose | null => {
    const el = spineRefs.current.get(id);
    return el && stageRef.current ? { ...centreOf(el), s: 1, ry: 0, rz: 0, leaf: 0 } : null;
  };
  const deskPose = (id: string): Pose | null => {
    const el = deskBookRef.current;
    const doc = byId.get(id);
    if (!el || !doc || !stageRef.current) return null;
    return { ...centreOf(el), s: el.offsetHeight / look(doc).height, ry: -90, rz: DESK_TILT, leaf: 0 };
  };
  const target = (f: Flight) => (f.to === 'desk' ? deskPose(f.id) : slotPose(f.id));

  const fly = (id: string, to: Flight['to'], fast: boolean, delay = 0) => {
    const inAir = flying.has(id) ? poses.current.get(id) : undefined;
    const atDesk = to === 'shelf' && !inAir ? deskPose(id) : null;
    const from = inAir ?? (atDesk ? { ...atDesk, leaf: -180 } : slotPose(id));
    if (!from) return;
    const flight: Flight = { key: ++flightKey.current, id, to, from, fromSlot: !inAir && to === 'desk', fast, delay };
    setFlights((fs) => [...fs.filter((f) => f.id !== id), flight]);
  };

  const landed = (f: Flight) => {
    setFlights((fs) => fs.filter((x) => x.key !== f.key));
    if (f.to === 'desk') setLandedId(f.id);
  };

  const resetDesk = () => {
    setRenaming(false);
    setConfirmingDelete(false);
  };

  /** Take a book off the shelf and lay it open on the desk. */
  const take = (id: string) => {
    if (id === selectedId) return;
    const prev = selectedId;
    resetDesk();
    setEntry(prev ? 'swap' : 'enter');
    if (!reduced) {
      // The static book hands over to the flight at the same pose; hide it now, since an exiting desk
      // keeps rendering its last props.
      if (prev) {
        fly(prev, 'shelf', true);
        if (deskBookRef.current) deskBookRef.current.style.visibility = 'hidden';
      }
      fly(id, 'desk', Boolean(prev), prev ? SWAP_DELAY : 0);
    }
    setSelectedId(id);
    setLandedId(reduced ? id : null);
  };

  /** Put the desk's book back in its slot. */
  const shelve = () => {
    const id = selectedId;
    if (!id) return;
    if (!reduced) {
      fly(id, 'shelf', false);
      if (deskBookRef.current) deskBookRef.current.style.visibility = 'hidden';
    }
    // Back up to the shelf while the book travels, so it is seen going into its slot.
    const slot = spineRefs.current.get(id);
    bringIntoView(slot?.closest('.shelf-unit') ?? slot, 1.1);
    resetDesk();
    setSelectedId(null);
    setLandedId(null);
    spineRefs.current.get(id)?.focus({ preventScroll: true });
  };

  /**
   * Ease the page so `el` sits in view with a 24px margin, below the phone's sticky header; an element
   * taller than the view aligns its top. Nothing happens if it is already in view. It runs on motion's
   * clock with the desk's own curve, so the scroll and the desk's height move as one; the reader's
   * wheel, touch, a scrolling key or a pointer press (scrollbar included) stops it.
   */
  const bringIntoView = (el: Element | null | undefined, seconds: number) => {
    stopPageScroll.current?.();
    if (!el) return;
    const scroller = pageScroller(el);
    const view = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
    const bar = document.querySelector('header');
    const barH = bar && bar.getClientRects().length && getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0;
    const top = view.top + barH + 24;
    const bottom = view.bottom - 24;
    const r = el.getBoundingClientRect();
    const by = r.height > bottom - top || r.top < top ? r.top - top : Math.max(0, r.bottom - bottom);
    if (Math.abs(by) < 1) return;
    const from = scroller.scrollTop;
    if (reduced) {
      scroller.scrollTop = from + by;
      return;
    }
    // Only input that arrives after the tween starts may stop it: the keydown or click that started it
    // is still bubbling to window when these listeners go on.
    const started = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.timeStamp >= started && SCROLL_KEYS.has(e.key)) stop();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.timeStamp >= started) stop();
    };
    const stop = () => {
      controls.stop();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      stopPageScroll.current = null;
    };
    const controls = animate(from, from + by, {
      duration: seconds,
      ease: IN_OUT,
      onUpdate: (v) => {
        scroller.scrollTop = v;
      },
      onComplete: stop
    });
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    stopPageScroll.current = stop;
  };
  useEffect(() => () => stopPageScroll.current?.(), []);

  // Opening the desk: focus its Read button (the spine it came from is now a gap) and scroll with the
  // opening desk, so the book lands on screen. Previous/Next keeps the desk in view the same way.
  useEffect(() => {
    if (!selectedId) return;
    if (entry === 'enter') readRef.current?.focus({ preventScroll: true });
    bringIntoView(deskRef.current?.querySelector('.shelf-desk'), entry === 'enter' ? DESK_OPEN : 0.6);
    // Runs once per book and entry, not on every render (bringIntoView is recreated each render).
  }, [selectedId, entry]);

  const focusSpine = (id: string) => {
    setStopId(id);
    const el = spineRefs.current.get(id);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  };

  const onShelfKey = (e: React.KeyboardEvent, id: string) => {
    const at = docs.findIndex((d) => d.id === id);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(docs.length - 1, at + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = docs.length - 1;
    else if (e.key === 'Escape' && selectedId) {
      e.preventDefault();
      shelve();
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      // A click or Escape-to-shelve leaves pointer mode on; arrow keys are keyboard use, so show the ring and caption.
      document.documentElement.dataset.input = 'keyboard';
      focusSpine(docs[next].id);
    }
  };

  const step = (by: 1 | -1) => {
    if (selectedIndex < 0 || docs.length === 0) return;
    const next = docs[(selectedIndex + by + docs.length) % docs.length];
    // Scroll the shelf sideways to its slot before measuring it, but never the page: the reader stays at the desk.
    const el = spineRefs.current.get(next.id);
    const row = scrollerRef.current;
    if (el && row) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
    refocus.current = by === 1 ? 'next' : 'prev';
    take(next.id);
    setStopId(next.id);
  };

  // The desk card remounts per book (its fade is keyed on the id), which drops focus to the body;
  // put it back on the button that was pressed so Escape and the arrows keep working.
  useEffect(() => {
    const which = refocus.current;
    refocus.current = null;
    if (which) deskRef.current?.querySelector<HTMLButtonElement>(`[data-step="${which}"]`)?.focus({ preventScroll: true });
  }, [selectedId]);

  const stageWidth = stageRef.current?.clientWidth ?? 0;
  // Half the caption's width (`min(30rem, 100% - 2rem)`), so the whole line stays inside the stage.
  const half = Math.min(240, stageWidth / 2 - 16);
  const clampedX = Math.max(half, Math.min(captionX, stageWidth - half));
  const selectedLook = selected ? look(selected) : null;

  return (
    <div ref={stageRef} className="shelf-stage" style={{ '--shelf-k': k } as React.CSSProperties}>
      {/* ── The shelf ── */}
      <div className="relative pt-12">
        {/* Hover / focus caption, in its own band above the tallest book; the arrow points down to it. */}
        <div
          aria-hidden="true"
          className="shelf-caption"
          data-show={pointedDoc ? '' : undefined}
          style={{ left: clampedX }}
        >
          {pointedDoc && (
            <>
              <p className="font-handwriting text-[26px] leading-tight truncate">{pointedDoc.title}</p>
              <p className="shelf-label font-spine mt-1 truncate">
                {pointedDoc.format} · {plural(pointedDoc.annotationCount, 'mark')} ·{' '}
                {plural(pointedDoc.wordCount, 'word')}
                {progressLabel(pointedDoc) && ` · ${progressLabel(pointedDoc)}`}
              </p>
            </>
          )}
        </div>
        <Doodle
          viewBox="0 0 15 22"
          d="M7.5 1.5c-.6 5 .5 11 0 18M3.5 15.5c1.6 1.4 2.8 2.8 4 4.3 1.1-1.6 2.3-3 3.9-4.4"
          className="shelf-pointer"
          show={Boolean(pointedDoc)}
          style={{ left: captionX - 7.5, top: pointerTop }}
        />

        {/* The shelf hugs its books (up to the stage width) and hangs centred, plank and all. */}
        <div className="shelf-unit">
        <div
          ref={scrollerRef}
          role="list"
          aria-label={`${plural(docs.length, 'book')} on the shelf. Arrow keys move along it.`}
          className="shelf-row no-scrollbar"
          onScroll={() => {
            layoutEpoch.current++;
            markEdges();
            if (pointed) placeCaption(pointed);
          }}
          onPointerLeave={rest}
        >
          {items.map((item) => {
            if (item.kind === 'bookend') {
              return (
                <span key={item.key} aria-hidden="true" className="shelf-bookend">
                  {item.label}
                </span>
              );
            }
            const { doc } = item;
            const bookLook = look(doc);
            const onDesk = doc.id === selectedId;
            return (
              <div key={doc.id} role="listitem" className="shelf-item">
              <button
                ref={(el) => {
                  if (el) spineRefs.current.set(doc.id, el);
                  else spineRefs.current.delete(doc.id);
                }}
                type="button"
                className="shelf-spine"
                data-out={isOut(doc.id) || undefined}
                data-lifted={pointed === doc.id || undefined}
                tabIndex={doc.id === tabStop ? 0 : -1}
                aria-label={`${doc.title}, ${doc.format}, ${plural(doc.annotationCount, 'mark')}, ${plural(doc.wordCount, 'word')}`}
                aria-expanded={onDesk}
                aria-controls={selectedId ? 'shelf-desk' : undefined}
                onPointerEnter={() => point(doc.id)}
                onPointerLeave={restSoon}
                onFocus={(e) => {
                  setStopId(doc.id);
                  // A mouse click focuses the button too; only keyboard focus keeps a caption up.
                  if (keyboardFocus(e.currentTarget)) point(doc.id);
                }}
                onBlur={() => setPointed((p) => (p === doc.id ? null : p))}
                onKeyDown={(e) => onShelfKey(e, doc.id)}
                onClick={() => (onDesk ? shelve() : take(doc.id))}
                style={{ width: bookLook.width, height: bookLook.height, ...clothVars(bookLook) }}
              >
                <SpineFace doc={doc} look={bookLook} />
              </button>
              </div>
            );
          })}
        </div>

        {/* The plank, with its two brackets. */}
        <div aria-hidden="true" className="shelf-plank">
          <span className="shelf-bracket left-[6%]" />
          <span className="shelf-bracket right-[6%] -scale-x-100" />
        </div>
        </div>
      </div>

      {/* ── Books in the air ── */}
      {flights.map((f) => {
        const doc = byId.get(f.id);
        return doc ? (
          <FlyingBook
            key={f.key}
            flight={f}
            doc={doc}
            look={look(doc)}
            target={target}
            poses={poses.current}
            layout={layoutEpoch}
            onDone={landed}
          />
        ) : null;
      })}

      {/* ── The desk ── */}
      <AnimatePresence initial={false}>
        {selected && selectedLook && (
          <motion.div
            key="desk"
            id="shelf-desk"
            // The desk's space opens with an eased height, so the page below slides rather than jumps
            // (a clip reveal left the page to snap). It finishes opening as the book lands
            // (pull 300 + arc 550 + land 150 = 1.0s); the desk's content is top-aligned and never
            // moves, so the flight's target holds still while the space grows.
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            // Shelving: the desk folds from the moment the cover has shut (0.3s), done at 1.4s with
            // the book; the slow start of the curve lets the book lift clear before the edge rises.
            exit={
              reduced
                ? { opacity: 0, transition: { duration: 0.25, ease: 'easeOut' } }
                : { height: 0, opacity: 0, transition: { duration: 1.1, ease: IN_OUT, delay: 0.3 } }
            }
            transition={
              reduced
                ? { height: { duration: 0 }, opacity: { duration: 0.25, ease: 'easeOut' } }
                : { height: { duration: DESK_OPEN, ease: IN_OUT }, opacity: { duration: 0.5, ease: 'easeOut' } }
            }
            className="overflow-hidden"
          >
            <div ref={deskRef} className="px-3 sm:px-8 pt-12 pb-16">
              <div className="shelf-desk mx-auto max-w-5xl">
                <div className="grid gap-8 grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center">
                  {/* The book, lying open at its first page. */}
                  <div className="flex justify-center py-4" aria-hidden="true">
                    <motion.div
                      key={selected.id}
                      initial={entry === 'swap' || reduced ? { opacity: 0 } : false}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.36, ease: 'easeOut' }}
                      className="shelf-desk-spread"
                      style={{ '--cloth': selectedLook.base } as React.CSSProperties}
                    >
                      <div
                        ref={deskBookRef}
                        className="shelf-desk-book"
                        style={{ visibility: landedId === selected.id ? undefined : 'hidden' }}
                      >
                        <DocumentCover doc={selected} className="rounded-[3px]" />
                        <span className="shelf-endpaper shelf-desk-endpaper" />
                        {/* The bookmark ribbon lies down the gutter as far as the reader has got;
                            mounted on landing so it unrolls once the book is open. */}
                        {landedId === selected.id && (selected.progressPercent ?? 0) > 0 && (
                          <span
                            className="shelf-bookmark"
                            style={{ '--read': `${selected.progressPercent}%` } as React.CSSProperties}
                          />
                        )}
                      </div>
                    </motion.div>
                  </div>

                  <motion.div
                    key={selected.id}
                    initial={reduced || entry === 'swap' ? { opacity: 0 } : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={
                      reduced || entry === 'swap' ? { duration: 0.36, ease: 'easeOut' } : { duration: 0.9, ease: EXPO, delay: 0.26 }
                    }
                  >
                    <DeskCard
                      doc={selected}
                      themes={themes}
                      busy={busyId === selected.id}
                      renaming={renaming}
                      draft={draft}
                      confirmingDelete={confirmingDelete}
                      readRef={readRef}
                      onOpen={() => {
                        const book = deskBookRef.current;
                        if (book && landedId === selected.id) zoomIntoReader(book, Boolean(reduced), () => onOpen(selected));
                        else onOpen(selected);
                      }}
                      onStartRename={() => {
                        setDraft(selected.title);
                        setRenaming(true);
                      }}
                      onDraft={setDraft}
                      onCommitRename={async () => {
                        const title = draft.trim();
                        // A changed title closes the field through the effect above.
                        if (title && title !== selected.title) await onRename(selected.id, title);
                        else setRenaming(false);
                      }}
                      onCancelRename={() => setRenaming(false)}
                      onAskDelete={() => setConfirmingDelete(true)}
                      onCancelDelete={() => setConfirmingDelete(false)}
                      onDelete={async () => {
                        const at = docs.findIndex((d) => d.id === selected.id);
                        const neighbour = docs[at + 1] ?? docs[at - 1];
                        if ((await onDelete(selected.id)) && neighbour) focusSpine(neighbour.id);
                      }}
                      onPrev={() => step(-1)}
                      onNext={() => step(1)}
                      onShelve={shelve}
                      canStep={docs.length > 1}
                    />
                  </motion.div>
                </div>
                <span aria-hidden="true" className="shelf-desk-leg left-[4%]" />
                <span aria-hidden="true" className="shelf-desk-leg right-[4%]" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DeskCard: React.FC<{
  doc: StoredDocumentMeta;
  themes: { id: string; name: string; color: string }[];
  busy: boolean;
  renaming: boolean;
  draft: string;
  confirmingDelete: boolean;
  canStep: boolean;
  readRef: React.Ref<HTMLButtonElement>;
  onOpen: () => void;
  onStartRename: () => void;
  onDraft: (v: string) => void;
  onCommitRename: () => Promise<void>;
  onCancelRename: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => Promise<void>;
  onPrev: () => void;
  onNext: () => void;
  onShelve: () => void;
}> = (p) => {
  const { doc } = p;
  const docThemes = p.themes.filter((t) => doc.themeIds?.includes(t.id));
  const added = new Date(doc.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const chipLabels = docThemes.map((t) => t.name).join('\n');

  // The chip slot is two rows tall and never grows: chips that fall below it are hidden and a "+N"
  // chip takes the last place that still fits. Set imperatively (the `hidden` attribute is not a
  // React prop here) so a resize re-fits without a render loop.
  const chipsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = chipsRef.current;
    if (!box) return;
    const fit = () => {
      const chips = Array.from(box.querySelectorAll<HTMLElement>('[data-chip]'));
      const more = box.querySelector<HTMLElement>('[data-more]')!;
      const fits = (el: HTMLElement) => el.offsetTop + el.offsetHeight <= box.clientHeight;
      chips.forEach((c) => (c.hidden = false));
      more.hidden = true;
      if (!chips.length || fits(chips[chips.length - 1])) return;
      more.hidden = false;
      for (let k = chips.length - 1; k >= 0; k--) {
        chips[k].hidden = true;
        more.textContent = `+${chips.length - k}`;
        if (fits(more)) return;
      }
    };
    fit();
    // Chip widths change once the handwriting font arrives.
    let live = true;
    void document.fonts.ready.then(() => live && fit());
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [doc.id, chipLabels]);

  // The row being swapped out turns invisible, which would drop focus to <body> (and Escape on the
  // card with it): hand focus to "Keep it" when the question opens, and back to "Delete" when it closes.
  const askDeleteRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(p.confirmingDelete);
  useEffect(() => {
    if (wasConfirming.current === p.confirmingDelete) return;
    wasConfirming.current = p.confirmingDelete;
    (p.confirmingDelete ? keepRef : askDeleteRef).current?.focus({ preventScroll: true });
  }, [p.confirmingDelete]);

  const summary =
    doc.annotationCount > 0
      ? `${plural(doc.annotationCount, 'mark')}${
          docThemes.length ? ` filed under ${plural(docThemes.length, 'theme')}` : ''
        }${doc.terminologyCount > 0 ? `, ${plural(doc.terminologyCount, 'term')} defined` : ''}.`
      : 'No marks yet. Open it to start annotating.';

  return (
    <div
      className="shelf-note"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || p.renaming) return;
        // Escape backs out of the delete question first; only then does it shelve the book.
        if (p.confirmingDelete) p.onCancelDelete();
        else p.onShelve();
      }}
    >
      <p className="shelf-label shelf-underline truncate">
        {doc.format} · added {added}
      </p>

      {/* Fixed slot: the title clamps to two lines and the rename field sits in the same space. */}
      <div className="shelf-note-title mt-5">
        {p.renaming ? (
          <div className="flex items-center gap-2 h-full">
            <input
              autoFocus
              maxLength={300}
              value={p.draft}
              onChange={(e) => p.onDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void p.onCommitRename();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  p.onCancelRename();
                }
              }}
              aria-label="New title"
              className="flex-1 min-w-0 bg-transparent border-b-2 border-[var(--shelf-ink)]/50 focus:border-[var(--shelf-ink)] outline-none font-handwriting text-[34px] leading-tight py-1"
            />
            <button type="button" className="shelf-pill" disabled={p.busy} onClick={() => void p.onCommitRename()}>
              {p.busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="shelf-pill" onClick={p.onCancelRename}>
              Cancel
            </button>
          </div>
        ) : (
          <h3 className="shelf-clamp font-handwriting" title={doc.title}>
            {doc.title}
          </h3>
        )}
      </div>

      <p className="shelf-label font-spine shelf-note-words mt-3 truncate">
        {plural(doc.wordCount, 'word')}{doc.originalBytes > 0 ? ` · ${formatBytes(doc.originalBytes)}` : ''}
        {progressLabel(doc) && <span className="shelf-progress"> · {progressLabel(doc)}</span>}
      </p>

      <p className="shelf-note-summary shelf-clamp font-serif text-[var(--shelf-ink)]/90 mt-4">{summary}</p>

      <div ref={chipsRef} className="shelf-chips mt-4">
        {docThemes.map((t) => (
          <span key={t.id} data-chip className="shelf-chip" title={t.name}>
            <span className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="truncate">{t.name}</span>
          </span>
        ))}
        <span data-more hidden className="shelf-chip" />
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button ref={p.readRef} type="button" className="shelf-primary" onClick={p.onOpen}>
          Read <span aria-hidden="true">→</span>
        </button>
        <Doodle viewBox="0 0 40 20" d="M38 3C28 3 18 7 9 15M8 8.5c0 2.5.2 4.6.6 7 2.4-.2 4.6-.3 7-.2" className="w-10 h-5 opacity-80" />
      </div>

      {/* Hidden, not removed, while renaming, so the card keeps its height. */}
      <button type="button" className={`shelf-link mt-4 ${p.renaming ? 'invisible' : ''}`} onClick={p.onStartRename}>
        Rename
      </button>

      {/* Both rows share one grid cell; the cell is as tall as the taller row, so the delete question
          never resizes the card. The inactive row is invisible (and so unfocusable). */}
      <div className="grid mt-6">
        <div className={`shelf-actions ${p.confirmingDelete ? '' : 'invisible'}`}>
          <span className="shelf-label self-center text-[var(--shelf-danger)]">Delete permanently?</span>
          <button type="button" className="shelf-pill shelf-pill-danger" disabled={p.busy} onClick={() => void p.onDelete()}>
            {p.busy ? 'Deleting…' : 'Delete'}
          </button>
          <button ref={keepRef} type="button" className="shelf-pill" onClick={p.onCancelDelete}>
            Keep it
          </button>
        </div>
        <div className={`shelf-actions ${p.confirmingDelete ? 'invisible' : ''}`}>
          <button type="button" className="shelf-pill" data-step="prev" disabled={!p.canStep} onClick={p.onPrev}>
            ← Previous
          </button>
          <button type="button" className="shelf-pill" data-step="next" disabled={!p.canStep} onClick={p.onNext}>
            Next →
          </button>
          <button ref={askDeleteRef} type="button" className="shelf-pill" onClick={p.onAskDelete}>
            Delete
          </button>
          <button type="button" className="shelf-pill" onClick={p.onShelve}>
            Shelve it
          </button>
        </div>
      </div>
    </div>
  );
};

// Used by HomeScreen, Tutorial and the tests, which import them from here.
export { CLOTHS, fitSpineTitle, formatBytes, monogram, pageParagraphs, progressLabel } from './shelf/shelfLook';
