/**
 * The bookshelf's motion: a book's flight between the shelf and the desk (poses, phases, the flying
 * book) and the zoom from the desk into the reader (moved verbatim from Bookshelf).
 */

import React, { useLayoutEffect, useRef } from 'react';
import { animate } from 'motion/react';
import { type StoredDocumentMeta } from '../../utils/documentStorage';
import { clothVars, DocumentCover, monogram, SpineFace, type Look } from './shelfLook';

/* ── The flight between shelf and desk ─────────────────────────────────────
   A book is a CSS box: its spine faces out on the shelf, its front cover (hinged
   at the spine) and first page sit on the right-hand side. One eased clock drives
   a pose per frame, transform only. Each way takes about 1.4s from click to settle:
   to the desk, pull 300ms + arc 550ms (ease-in-out cubic) + land 150ms (ease-out
   cubic), then the cover opens, 400ms; back to the shelf, the cover closes 300ms,
   then 1100ms: 78% arc and 22% push into the slot. Previous/Next sends the old
   book back at 800ms and the new one after 400ms at 600/1000 speed (1.4s in all).
   Every curve is monotonic: no spring, no overshoot. */

export type Pose = { x: number; y: number; s: number; ry: number; rz: number; leaf: number };
export type Flight = { key: number; id: string; to: 'desk' | 'shelf'; from: Pose; fromSlot: boolean; fast: boolean; delay: number };

export const DESK_TILT = -3;
export const SWAP_DELAY = 400;
/** Keys that scroll the page; pressing one hands the scroll back to the reader. */
export const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Home', 'End']);
export const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const out = (t: number) => 1 - Math.pow(1 - t, 3);
export const mix = (a: number, b: number, e: number) => a + (b - a) * e;
export const mixPose = (a: Pose, b: Pose, e: number): Pose => ({
  x: mix(a.x, b.x, e),
  y: mix(a.y, b.y, e),
  s: mix(a.s, b.s, e),
  ry: mix(a.ry, b.ry, e),
  rz: mix(a.rz, b.rz, e),
  leaf: mix(a.leaf, b.leaf, e)
});
export const bezier = (a: number, c: number, b: number, e: number) => (1 - e) * (1 - e) * a + 2 * e * (1 - e) * c + e * e * b;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Keyboard focus only: Chromium flags a clicked button `:focus-visible` after any later key (even
    Cmd alone), so the app's last input mode on <html> (set in App.tsx) has the final say. */
export const keyboardFocus = (el: Element) => el.matches(':focus-visible') && document.documentElement.dataset.input !== 'pointer';

/** The element that scrolls the page around `el`: its nearest scrolling ancestor, else the document. */
export function pageScroller(el: Element): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

export function phases(f: Flight) {
  if (f.to === 'desk') {
    const k = f.fast ? 600 / 1000 : 1;
    const pull = f.fromSlot ? 300 * k : 0;
    const arc = 550 * k;
    const land = 150 * k;
    const open = 400;
    return { pull, arc, land, open, total: pull + arc + land + open };
  }
  const trip = f.fast ? 600 : 1100;
  const close = (f.fast ? 200 : 300) * (-f.from.leaf / 180);
  return { close, arc: trip * 0.78, push: trip * 0.22, total: close + trip };
}

/** Where a flight is `ms` into it, given where it is headed now. */
export function poseAt(f: Flight, ms: number, target: Pose): Pose {
  const p = phases(f);
  if (f.to === 'desk') {
    const pulled = f.fromSlot ? { ...f.from, y: f.from.y - 14, s: f.from.s * 1.08 } : f.from;
    const preLand = { ...target, y: target.y - 16 };
    if (ms < p.pull) return mixPose(f.from, pulled, inOut(ms / p.pull));
    const a = ms - p.pull;
    if (a < p.arc) {
      // Out and across first, then down onto the desk: the control point sits level with the pulled book.
      const e = inOut(a / p.arc);
      const turn = mixPose(pulled, { ...preLand, leaf: 0 }, e);
      return { ...turn, x: bezier(pulled.x, preLand.x, preLand.x, e), y: bezier(pulled.y, pulled.y - 24, preLand.y, e) };
    }
    const l = a - p.arc;
    if (l < p.land) return mixPose(preLand, target, out(l / p.land));
    return { ...target, leaf: -180 * inOut(clamp01((l - p.land) / p.open)) };
  }
  // Back to the shelf: close the cover where it lies, lift up and over, push into the slot.
  const pre = { ...target, y: target.y - 24, s: 1.08 };
  if (ms < p.close) return { ...f.from, leaf: f.from.leaf * (1 - inOut(ms / p.close)) };
  const shut = { ...f.from, leaf: 0 };
  const a = ms - p.close;
  if (a < p.arc) {
    const e = inOut(a / p.arc);
    const turn = mixPose(shut, pre, e);
    return { ...turn, x: bezier(shut.x, shut.x, pre.x, e), y: bezier(shut.y, pre.y - 24, pre.y, e) };
  }
  return mixPose(pre, target, out(clamp01((a - p.arc) / p.push)));
}

export const FlyingBook: React.FC<{
  flight: Flight;
  doc: StoredDocumentMeta;
  look: Look;
  target: (f: Flight) => Pose | null;
  poses: Map<string, Pose>;
  /** Bumped when the shelf scrolls or the stage resizes: the only times the cached target moves. */
  layout: React.RefObject<number>;
  onDone: (f: Flight) => void;
}> = ({ flight, doc, look, target, poses, layout, onDone }) => {
  const bookRef = useRef<HTMLDivElement>(null);
  const leafRef = useRef<HTMLDivElement>(null);
  const t = look.width;
  const h = look.height;
  const c = Math.round(h * 0.75);

  // Latest callbacks without restarting the flight on every parent render.
  const live = useRef({ target, onDone });
  live.current = { target, onDone };

  useLayoutEffect(() => {
    const book = bookRef.current;
    const leaf = leafRef.current;
    if (!book || !leaf) return;
    let last = flight.from;
    // The target is measured once and again only after a shelf scroll or a stage resize, not every frame.
    let goal: Pose | null = null;
    let seen = -1;
    const aim = () => {
      if (!goal || seen !== layout.current) {
        goal = live.current.target(flight);
        seen = layout.current;
      }
      return goal ?? last;
    };
    const draw = (p: Pose) => {
      last = p;
      poses.set(flight.id, p);
      const ry = (p.ry * Math.PI) / 180;
      // Keep the face nearest the reader on the page plane, so the start and end frames match the
      // spine and the desk exactly and the book never swells toward the viewer mid-turn.
      const depth = (t / 2) * Math.abs(Math.sin(ry)) + (c / 2) * Math.cos(ry);
      book.style.transform = `translate3d(${p.x - t / 2}px, ${p.y - h / 2}px, 0) perspective(1600px) rotateZ(${p.rz}deg) scale3d(${p.s}, ${p.s}, ${p.s}) translateZ(${-depth}px) rotateY(${p.ry}deg)`;
      leaf.style.transform = `rotateY(${p.leaf}deg)`;
    };
    draw(flight.from);
    // A compositor layer for the flight only; the flyer unmounts when it lands.
    book.style.willChange = 'transform';
    const { total } = phases(flight);
    const controls = animate(0, total, {
      duration: total / 1000,
      delay: flight.delay / 1000,
      ease: 'linear',
      onUpdate: (ms) => draw(poseAt(flight, ms, aim())),
      onComplete: () => {
        book.style.willChange = '';
        live.current.onDone(flight);
      }
    });
    return () => {
      controls.stop();
      book.style.willChange = '';
      if (poses.get(flight.id) === last) poses.delete(flight.id);
    };
  }, [flight, poses, layout, t, h, c]);

  return (
    <div ref={bookRef} className="shelf-flyer" aria-hidden="true" style={{ width: t, height: h, ...clothVars(look) }}>
      <div className="shelf-spine shelf-fly-spine" style={{ width: t, height: h, transform: `translateZ(${c / 2}px)` }}>
        <SpineFace doc={doc} look={look} />
      </div>
      <div className="shelf-fly-side" style={{ width: c, height: h, left: (t - c) / 2, transform: `rotateY(90deg) translateZ(${t / 2}px)` }}>
        <div className="shelf-fly-page">
          <DocumentCover doc={doc} className="rounded-[3px]" />
        </div>
        <div ref={leafRef} className="shelf-fly-leaf">
          <div className="shelf-cover">
            <span className="shelf-label shelf-cover-format">{doc.format}</span>
            <span className="shelf-cover-title">{doc.title}</span>
            <span className="shelf-spine-badge">{monogram(doc.title)}</span>
          </div>
          <span className="shelf-endpaper shelf-fly-back" />
        </div>
      </div>
    </div>
  );
};

/* ── Read: the camera pushes in on the desk's open book until page one is the reader's page ── */

/** Seconds: the room fades back, the page pushes in, the reader shows through. Total ~1.35 s. */
export const ZOOM_FADE_BACK = 0.5;
export const ZOOM_PUSH = 1.0;
export const ZOOM_HANDOFF = 0.35;
/** Give up waiting for the reader's first page after this long and show whatever is there. */
export const ZOOM_PATIENCE = 3;
export let zooming = false;

export type Box = { x: number; y: number; w: number };

/**
 * Where the reader's first page will be, and whether it has painted. The PDF viewer's page 1 counts
 * once pdf.js has finished it (its text layer closes with `.endOfContent`); the text reader marks its
 * reading column `data-zoom-target`. Either is null until the reader has mounted.
 */
export function readerPage(): { box: Box; painted: boolean } | null {
  const pdfPage = document.querySelector<HTMLElement>('[data-page-number="1"][data-page-sized="true"]');
  if (pdfPage) {
    const r = pdfPage.getBoundingClientRect();
    return { box: { x: r.left + r.width / 2, y: r.top, w: r.width }, painted: Boolean(pdfPage.querySelector('.endOfContent')) };
  }
  const column = document.querySelector<HTMLElement>('[data-zoom-target]');
  if (!column) return null;
  const r = column.getBoundingClientRect();
  return { box: { x: r.left + r.width / 2, y: r.top, w: r.width }, painted: true };
}

/**
 * Lifts the desk's page into a fixed overlay and pushes in on it while the room fades to the reader's
 * ground; `open` swaps the screen behind once nothing of Home shows. The page then settles exactly on
 * the reader's own first page and the overlay fades, so the two cross-dissolve. Imperative, on
 * document.body, because Home (and this shelf) unmounts halfway through. Transform, clip and opacity
 * only.
 */
export function zoomIntoReader(deskBook: HTMLElement, reduced: boolean, open: () => unknown) {
  if (zooming) return;
  const page = deskBook.querySelector<HTMLElement>('.shelf-page');
  if (!page) return void open();
  zooming = true;
  // Nothing on Home should take keys (a repeated Enter, Escape to shelve) while it fades away.
  (document.activeElement as HTMLElement | null)?.blur();

  const stage = deskBook.closest('.shelf-stage');
  const stageStyle = stage ? getComputedStyle(stage) : null;
  const ground = getComputedStyle(document.getElementById('app-container') ?? document.body).backgroundColor;

  const root = document.createElement('div');
  root.className = 'shelf-zoom';
  root.setAttribute('aria-hidden', 'true');
  for (const v of ['--shelf-tooth', '--shelf-cast', '--shelf-cast-edge']) root.style.setProperty(v, stageStyle?.getPropertyValue(v) ?? '');
  const backdrop = document.createElement('div');
  backdrop.className = 'shelf-zoom-ground';
  backdrop.style.background = ground;
  backdrop.style.opacity = '0';
  root.append(backdrop);

  // Desk geometry: the page's laid-out size and centre (its rect is the bounding box of a tilted page).
  const w0 = deskBook.offsetWidth;
  const h0 = deskBook.offsetHeight;
  const dr = deskBook.getBoundingClientRect();
  const desk = { x: dr.left + dr.width / 2, y: dr.top + dr.height / 2 };

  // The whole page as it is printed. A PDF's first page is shown on the desk cropped to 3:4 (cover, top);
  // here it is set uncropped at its own proportions and clipped back to the desk's crop, which opens out.
  const img = page.querySelector('img');
  const ratio = img?.naturalWidth ? img.naturalHeight / img.naturalWidth : h0 / w0;
  const cover = img?.naturalWidth ? Math.max(w0, h0 / ratio) : w0;
  const full = { w: cover, h: cover * ratio };
  const crop = { x: (full.w - w0) / 2, bottom: full.h - h0 };

  // Where the reader will put page one, until it can be measured. The PDF viewer opens a page at
  // 125% (A4 is 595pt wide) unless that is under half or over 2.5x its column, then fits it; the text
  // reader's column is at most 672px. Both sit centred in the content area, under their bars.
  const aside = document.querySelector('#app-container > aside');
  const left = aside && aside.getClientRects().length ? aside.getBoundingClientRect().right : 0;
  const area = window.innerWidth - left;
  const column = area - 32;
  const atZoom = 1.25 * 595;
  const guessW = img ? (atZoom < column * 0.5 || atZoom > column * 2.5 ? column - 48 : atZoom) : Math.min(672, area);
  const guess: Box = { x: left + Math.max(area / 2, 16 + guessW / 2), y: img ? 168 : 158, w: guessW };

  // Built at its likely final size so text and image are drawn sharp, then scaled down to the desk.
  const bw = Math.max(w0, guessW);
  const bh = bw * ratio;
  const s0 = full.w / bw;

  const sheet = document.createElement('div');
  sheet.className = 'shelf-zoom-page';
  sheet.style.width = `${bw}px`;
  sheet.style.height = `${bh}px`;
  const shadow = document.createElement('div');
  shadow.className = 'shelf-zoom-shadow';
  // The desk's own cast, in the sheet's units, so the first frame matches; it fades as the page lifts.
  shadow.style.boxShadow = `${14 / s0}px ${22 / s0}px ${36 / s0}px var(--shelf-cast), ${2 / s0}px ${3 / s0}px 0 var(--shelf-cast-edge)`;
  const leaf = page.cloneNode(true) as HTMLElement;
  sheet.append(shadow, leaf);
  // A text page is set larger than the reader sets its lines, so the two would double-expose: it fades
  // into the reader's ground (the veil) while the reader's own page shows through.
  const textPage = !img;
  const veil = document.createElement('div');
  veil.className = 'shelf-zoom-veil';
  veil.style.background = ground;
  if (textPage) sheet.append(veil);
  if (!reduced) root.append(sheet);
  document.body.append(root);

  // The page's centre at the desk pose: the crop's centre sits (full.h - h0)/2 above the full page's.
  const tilt = (DESK_TILT * Math.PI) / 180;
  const off = (full.h - h0) / 2;
  const from = { x: desk.x - off * Math.sin(tilt), y: desk.y + off * Math.cos(tilt) };

  deskBook.style.visibility = 'hidden';
  const started = performance.now();
  let opened = false;
  /** When the overlay starts to fade (s): a text page hands over as its veil closes, a PDF page once it has landed. */
  const handAt = textPage ? ZOOM_PUSH - 0.2 : ZOOM_PUSH;
  /** When the reader's page was first measured (s). */
  let metAt = -1;
  let readyAt = 0;
  let stable = 0;
  let prev: Box | null = null;
  let raf = 0;

  // The full page's box moves on straight lines (centre and width mixed linearly), so every edge,
  // the scale and the tilt each travel one way only.
  const draw = (e: number, a: Box) => {
    const w = mix(full.w, a.w, e);
    const s = w / bw;
    const x = mix(from.x, a.x, e);
    const y = mix(from.y, a.y + (a.w * ratio) / 2, e);
    const k = (1 - e) / s0;
    sheet.style.transform = `translate3d(${x - bw / 2}px, ${y - bh / 2}px, 0) rotate(${mix(DESK_TILT, 0, e)}deg) scale(${s})`;
    sheet.style.clipPath = `inset(0 ${crop.x * k}px ${crop.bottom * k}px round ${3 / s}px)`;
    shadow.style.opacity = String(1 - clamp01(e / 0.5));
    // The binding's curve belongs to the book on the desk, not to the reader's page.
    sheet.style.setProperty('--gutter', String(1 - e));
  };

  const finish = () => {
    cancelAnimationFrame(raf);
    root.remove();
    deskBook.style.visibility = '';
    zooming = false;
    const t = document.querySelector<HTMLElement>('[data-zoom-target]');
    if (t) t.focus({ preventScroll: true });
  };

  const tick = (now: number) => {
    try {
      const t = (now - started) / 1000;
      const fadeBack = reduced ? 0.2 : ZOOM_FADE_BACK;
      backdrop.style.opacity = String(inOut(clamp01(t / fadeBack)));
      if (!opened && t >= fadeBack) {
        opened = true;
        void open();
      }

      // Once the reader's page is measured, the aim eases from the guess onto it, done as the push ends
      // (or in 0.3 s if it came late), and tracks it from then on.
      const seen = opened ? readerPage() : null;
      let aim = guess;
      let q = 0;
      if (seen) {
        if (metAt < 0) metAt = t;
        q = inOut(clamp01((t - metAt) / Math.max(0.3, handAt - metAt)));
        aim = { x: mix(guess.x, seen.box.x, q), y: mix(guess.y, seen.box.y, q), w: mix(guess.w, seen.box.w, q) };
        const still = prev && Math.abs(prev.x - seen.box.x) + Math.abs(prev.y - seen.box.y) + Math.abs(prev.w - seen.box.w) < 0.5;
        stable = still ? stable + 1 : 0;
        prev = seen.box;
      }
      const e = reduced ? 1 : inOut(clamp01(t / ZOOM_PUSH));
      if (!reduced) draw(e, aim);
      // ...and are already half gone as the push slows, before the reader shows.
      if (textPage && !readyAt) veil.style.opacity = String(0.5 * inOut(clamp01((e - 0.7) / 0.3)));

      // Hand over once the push is (all but) done and on the reader's page, which has painted and holds still.
      const due = reduced ? opened : t >= handAt;
      if (!readyAt && due && ((seen?.painted && (q === 1 || reduced) && stable >= 2) || t > ZOOM_PATIENCE)) readyAt = now;
      if (readyAt) {
        const f = clamp01((now - readyAt) / 1000 / (reduced ? 0.25 : ZOOM_HANDOFF));
        root.style.opacity = String(1 - inOut(f));
        // A text page's lines go to the ground at 1.6x the fade, so they sink under the reader's rising
        // lines instead of stacking on them, and some text is on screen in every frame.
        if (textPage) veil.style.opacity = String(Math.max(+veil.style.opacity, inOut(clamp01(f * 1.6))));
        if (f >= 1) return finish();
      }
      raf = requestAnimationFrame(tick);
    } catch {
      finish();
    }
  };
  if (!reduced) draw(0, guess);
  raf = requestAnimationFrame(tick);
}
