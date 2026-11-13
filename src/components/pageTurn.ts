/**
 * The page turn shared by the reader's and the PDF workspace's two-page spread.
 *
 * A turn is the desk book's cover swing applied to one leaf: a sheet hinged at the gutter rotates
 * 180°, eased in and out, with the page it leaves on its front and the page it lands as on its back.
 * Both faces are visual copies (`snapshotPage`), never the live pages, so ids, selection and the
 * annotation layers stay single. The real next spread is already rendered underneath; the copies
 * hide the parts of it that a real book would still be covering, and are removed when the leaf lands.
 *
 * Reduced motion: no leaf, the old spread's copies cross-fade away over the new one.
 */

export type TurnDirection = 1 | -1;

/** One page's box inside the layer, in px. */
export interface PageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TurnOptions {
  /** Positioned element (the book) the overlay is drawn in. */
  layer: HTMLElement;
  left: PageBox;
  right: PageBox;
  dir: TurnDirection;
  /** The old page that turns: the right page going forward, the left going back. */
  front: HTMLElement | null;
  /** The old page that stays put until the leaf lands on it. */
  cover: HTMLElement | null;
  /** The new page the leaf lands as. Read at the half-way point, so a PDF canvas has had time to draw. */
  back: () => HTMLElement | null;
  reduced: boolean;
  duration?: number;
}

/** Same ease the desk book's cover opens with (`inOut` in Bookshelf): no overshoot. */
export const TURN_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
export const TURN_MS = 760;
export const FADE_MS = 220;
/**
 * The overlay is gone this long after a turn starts, whatever happens. It used to wait for the
 * animation's `onfinish`, which a busy main thread (a scanned page painting) delayed to 3.5 s,
 * leaving the old page's marks over the new spread.
 */
export const TURN_FAILSAFE_MS = TURN_MS + 40;

/** Clamps a requested spread index into range. */
export function clampSpread(index: number, count: number): number {
  return Math.max(0, Math.min(Math.max(0, count - 1), Math.floor(index)));
}

/** The direction a move from `from` to `to` turns, or null when it does not move. */
export function turnDirection(from: number, to: number): TurnDirection | null {
  return to > from ? 1 : to < from ? -1 : null;
}

/** Whole pages a column flow of `scrollWidth` holds, given each page's stride (column + gap). */
export function pageCountFor(scrollWidth: number, stride: number, gap: number): number {
  if (stride <= 0) return 1;
  return Math.max(1, Math.round((scrollWidth + gap) / stride));
}

/**
 * Which column (page) a box sits in, from its centre `x`, for a flow whose first column starts at
 * `origin`. The centre, not the left edge: a paragraph's hover tint reaches a few px into the gap.
 */
export function columnAt(x: number, origin: number, stride: number): number {
  return stride > 0 ? Math.max(0, Math.floor((x - origin) / stride)) : 0;
}

/**
 * A visual copy of a live page: no ids, not focusable, not read out.
 *
 * Kept cheap, since it runs on the click that starts a turn: a PDF page's text layer (invisible
 * text, often thousands of spans) is not copied, and canvases are copied at their on-screen size
 * rather than at full device resolution (a quarter of the pixels on a 2x screen), which no one
 * sees during a 0.76 s turn.
 */
export function snapshotPage(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(false) as HTMLElement;
  for (const child of Array.from(el.childNodes)) {
    const skipInside = child instanceof HTMLElement && child.classList.contains('marginalia-text-layer');
    copy.appendChild(child.cloneNode(!skipInside));
  }
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  const from = el.querySelectorAll('canvas');
  copy.querySelectorAll('canvas').forEach((c, i) => {
    const src = from[i];
    if (!src) return;
    const w = Math.max(1, Math.round(src.clientWidth || src.width));
    const h = Math.max(1, Math.round(src.clientHeight || src.height));
    c.width = Math.min(w, src.width || w);
    c.height = Math.min(h, src.height || h);
    try {
      if (src.width && src.height) c.getContext('2d')?.drawImage(src, 0, 0, c.width, c.height);
    } catch {
      // A tainted or lost canvas just turns blank paper.
    }
  });
  return copy;
}

const place = (el: HTMLElement, box: PageBox) => {
  el.style.cssText += `;position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;`;
};

/** Wraps a copy in a page-sized face: clipped, with a shade that darkens as it turns edge-on. */
const face = (content: HTMLElement | null, cls: string) => {
  const f = document.createElement('div');
  f.className = `page-turn-face ${cls}`;
  if (content) f.appendChild(content);
  const shade = document.createElement('div');
  shade.className = 'page-turn-shade';
  f.appendChild(shade);
  return { face: f, shade };
};

/**
 * Plays one turn. `done` resolves when the overlay is gone; `finish()` jumps to the end at once
 * (a second turn requested mid-flight finishes the first).
 */
export function playTurn(o: TurnOptions): { done: Promise<void>; finish: () => void } {
  const root = document.createElement('div');
  root.className = 'page-turn';
  root.setAttribute('aria-hidden', 'true');
  root.inert = true;
  o.layer.appendChild(root);
  const anims: Animation[] = [];
  let timer = 0;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(timer);
    window.clearTimeout(failsafe);
    anims.forEach((a) => a.cancel());
    root.remove();
    resolve();
  };
  // Gone by TURN_FAILSAFE_MS (or just after a fade) whether or not `onfinish` has fired.
  const failsafe = window.setTimeout(end, o.reduced ? FADE_MS + 40 : Math.min(TURN_FAILSAFE_MS, (o.duration ?? TURN_MS) + 40));

  if (o.reduced) {
    // The old spread's two pages, over the new one, fading away.
    const turning = o.dir === 1 ? o.right : o.left;
    const staying = o.dir === 1 ? o.left : o.right;
    for (const [el, box] of [
      [o.front, turning],
      [o.cover, staying]
    ] as const) {
      if (!el) continue;
      const f = face(el, '').face;
      place(f, box);
      root.appendChild(f);
    }
    const a = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' });
    anims.push(a);
    a.onfinish = end;
    return { done, finish: end };
  }

  const ms = o.duration ?? TURN_MS;
  const forward = o.dir === 1;
  const from = forward ? o.right : o.left;
  const to = forward ? o.left : o.right;

  // What the leaf has not reached yet still shows the old page there.
  if (o.cover) {
    const c = face(o.cover, 'page-turn-cover').face;
    place(c, to);
    root.appendChild(c);
  }

  const leaf = document.createElement('div');
  leaf.className = 'page-turn-leaf';
  place(leaf, from);
  leaf.style.transformOrigin = forward ? 'left center' : 'right center';
  leaf.dataset.hinge = forward ? 'left' : 'right';
  const front = face(o.front, 'page-turn-front');
  const back = face(null, 'page-turn-back');
  leaf.append(front.face, back.face);
  root.appendChild(leaf);

  // The page being uncovered sits in the leaf's shadow, which lifts as the leaf goes over.
  const cast = document.createElement('div');
  cast.className = 'page-turn-cast';
  place(cast, from);
  cast.dataset.side = forward ? 'left' : 'right';
  root.insertBefore(cast, leaf);

  const angle = forward ? -180 : 180;
  const timing = { duration: ms, easing: TURN_EASE, fill: 'forwards' as const };
  anims.push(
    leaf.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${angle}deg)` }], timing),
    front.shade.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, duration: ms / 2, easing: 'ease-in' }),
    back.shade.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], timing),
    cast.animate([{ opacity: 0.55 }, { opacity: 0 }], timing)
  );
  // Half way the leaf is edge-on: the right moment to read the new page (its canvas has drawn by now).
  timer = window.setTimeout(() => {
    const content = o.back();
    if (content) back.face.insertBefore(content, back.shade);
  }, ms * 0.45);
  anims[0].onfinish = end;
  return { done, finish: end };
}

/** The longest a turn waits for its new pages to paint before it turns anyway. */
export const TURN_WAIT_MAX_MS = 1500;

/**
 * Calls `then` once `ready()` is true (checked now, then whenever an attribute under `root`
 * changes, such as a page's `data-painted`), or after `maxMs` at the latest. Returns a cancel.
 */
export function waitFor(root: HTMLElement, ready: () => boolean, maxMs: number, then: () => void): () => void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    then();
  };
  const observer = new MutationObserver(() => {
    if (ready()) finish();
  });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-painted'] });
  const timer = window.setTimeout(finish, maxMs);
  if (ready()) finish();
  return () => {
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
  };
}
