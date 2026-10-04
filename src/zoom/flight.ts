import { cancelFrame, frame, motionValue, type MotionValue } from "motion/react";
import { clamp } from "./springs";

export type Rect = { x: number; y: number; w: number; h: number };

/** Where the copy is (centre, scale) and the on-screen size of the part that shows. */
type Fit = { s: number; cx: number; cy: number; vw: number; vh: number };

export type Flight = {
  cx: MotionValue<number>;
  cy: MotionValue<number>;
  s: MotionValue<number>;
  /** Where the flight ends, in the same units as cx/cy/s. */
  to: Fit;
  /** For live heroes: the element the hero's React content renders into. */
  liveHost: HTMLElement | null;
  /** Remove the still snapshot once the live content has rendered over it. */
  dropSnapshot(): void;
  /** Point the flight somewhere new from wherever it is now (its springs keep their speed),
   *  optionally with the corner radius (on-screen px) it should land with. */
  retarget(next: Rect, radius?: number): void;
  /** Re-apply the extra offset (e.g. after the card's content scrolled). */
  invalidate(): void;
  destroy(): void;
};

export type HeroMetrics = {
  W0: number;
  H0: number;
  radius: number;
  /** The hero's own box-shadow ("none" if it has none) and corner radius, for the flight's shadow layer. */
  shadow: string;
  shadowRadius: string;
  /** The hero element's own corner radius (px), for blending corners in flight. */
  ownRadius: number;
  /** The hero's corner-shape (e.g. "superellipse(1.36)"), or "" where unsupported. */
  cornerShape: string;
};

/** Far enough outside the copy's box that nothing a hero paints reaches it. */
const OUTSIDE = 10000;

/** Read everything a flight needs from the hero, in one go, before anything is written. */
export function measureHero(hero: HTMLElement): HeroMetrics {
  const cs = getComputedStyle(hero);
  return {
    W0: hero.offsetWidth,
    H0: hero.offsetHeight,
    radius: readRadius(hero),
    shadow: cs.boxShadow,
    shadowRadius: cs.borderRadius,
    ownRadius: radiusOf(hero, cs),
    cornerShape: cs.getPropertyValue("corner-top-left-shape"),
  };
}

/**
 * An element's corner radius in px: its own, or else its first child's (an image
 * inside a wrapper often carries the rounding). 0 for anything that isn't a plain px
 * value (percentages, elliptical corners): those corners are left to scale as they are.
 */
export function radiusOf(el: HTMLElement, cs: CSSStyleDeclaration = getComputedStyle(el)) {
  const own = pxRadius(cs.borderTopLeftRadius);
  if (own > 0) return own;
  const child = el.firstElementChild as HTMLElement | null;
  return child ? pxRadius(getComputedStyle(child).borderTopLeftRadius) : 0;
}

/** A corner radius in px, or 0 when it isn't a plain px value (percentages, elliptical). */
export function pxRadius(value: string) {
  return /^[\d.]+px$/.test(value.trim()) ? parseFloat(value) : 0;
}

/**
 * The still copy that flies. Live heroes only show it for the frame or so before
 * their real content renders, so a plain clone is enough (their own classes come
 * along). Static heroes fly as this copy the whole way, so their computed styles
 * are frozen onto it: styles that came from where the hero sat in the card would
 * otherwise be lost. Freezing is expensive, so it's cached per hero and can be
 * prepared ahead of time with prepareSnapshot().
 */
const frozenCache = new WeakMap<HTMLElement, { node: HTMLElement; w: number; h: number }>();
export function prepareSnapshot(hero: HTMLElement) {
  const w = hero.offsetWidth;
  const h = hero.offsetHeight;
  const cached = frozenCache.get(hero);
  if (cached && cached.w === w && cached.h === h) return cached.node;
  const node = hero.cloneNode(true) as HTMLElement;
  freezeStyles(hero, node);
  frozenCache.set(hero, { node, w, h });
  return node;
}
export function snapshotOf(hero: HTMLElement, live: boolean) {
  return live ? (hero.cloneNode(true) as HTMLElement) : (prepareSnapshot(hero).cloneNode(true) as HTMLElement);
}

/**
 * Flies a copy of the destination's hero from one rect to another. The copy is
 * scaled uniformly to *cover* each rect and cropped to it, so a square thumbnail
 * can grow into a wide hero (or any other aspect change) without stretching.
 * Pass metrics and snapshot measured up front to keep this free of layout reads.
 */
export function createFlight(
  layer: HTMLElement,
  hero: HTMLElement,
  from: Rect,
  to: Rect,
  opts: {
    id?: string;
    live?: { className?: string };
    metrics?: HeroMetrics;
    snapshot?: HTMLElement;
    /** Added on top of the spring's position every frame (e.g. to follow content scrolled mid-flight). */
    offset?: () => { x: number; y: number };
    /** A vertical band (in the layer's coordinates) to clip the copy to, or null for none. */
    clip?: () => { top: number; bottom: number } | null;
    /**
     * How much of the hero's own shadow to show (0 to 1), read every frame. The
     * source it flies from usually has none, so a shadow carried at full strength
     * pops on at take-off and off at landing; this fades it with the flight instead.
     */
    shadowOpacity?: () => number;
    /**
     * Corner radius (on-screen px) at each end: where it flies from and where it lands.
     * The copy is scaled as a whole, which scales its corners too, so a 14 px corner
     * flying at 70% would read as 10 px and jump to 14 on landing. With radii the
     * corner is blended from one end's to the other's as it flies, in screen pixels.
     */
    radii?: { from: number; to: number };
  } = {},
): Flight {
  const { W0, H0, radius, shadow, shadowRadius, cornerShape } = opts.metrics ?? measureHero(hero);
  const fit = (r: Rect): Fit => {
    const s = Math.max(r.w / W0, r.h / H0);
    return {
      s,
      cx: r.x + r.w / 2,
      cy: r.y + r.h / 2,
      vw: r.w,
      vh: r.h,
    };
  };
  let A = fit(from);
  let B = fit(to);
  const corners = !!opts.radii && (opts.radii.from > 0 || opts.radii.to > 0);
  let rA = opts.radii?.from ?? 0;
  let rB = opts.radii?.to ?? 0;
  /** The on-screen corner radius at scale sv: from one end's to the other's, along the flight. */
  const screenRadius = (sv: number) => {
    const t = A.s === B.s ? 1 : clamp((sv - A.s) / (B.s - A.s), 0, 1);
    return rA + (rB - rA) * t;
  };

  const el = document.createElement("div");
  el.className = "zoom-clone";
  el.setAttribute("aria-hidden", "true");
  if (opts.id) el.dataset.zoomId = opts.id;
  el.style.width = `${W0}px`;
  el.style.height = `${H0}px`;
  const copy = opts.snapshot ?? snapshotOf(hero, !!opts.live);
  copy.removeAttribute("data-zoom-hero");
  copy.style.visibility = "visible";
  copy.style.margin = "0";
  copy.style.position = "absolute";
  copy.style.left = "0";
  copy.style.top = "0";
  copy.style.width = `${W0}px`;
  copy.style.height = `${H0}px`;
  // A window over the copy. Normally it's the whole box and clips nothing (so a cover
  // swung open in 3D, or a glow, can overhang). When the copy is cropped to the
  // source's shape (a square thumbnail opening into a wide image) the window shrinks
  // to the visible part and clips there, with its own rounded (and shaped) corners.
  // The crop used to be a clip-path on the whole flight, which also cut the shadow and
  // left the cropped corners square.
  const win = document.createElement("div");
  win.className = "zoom-clone-window";
  win.style.cssText = "position:absolute;inset:0;";
  if (cornerShape) win.style.setProperty("corner-shape", cornerShape);
  // The hero's own shadow is drawn on a layer of its own, behind the window, so it can
  // fade, and so it wraps the visible (cropped) shape rather than being cut by it.
  let shade: HTMLElement | null = null;
  if (shadow && shadow !== "none") {
    shade = document.createElement("div");
    shade.className = "zoom-clone-shadow";
    shade.style.cssText = `position:absolute;inset:0;border-radius:${shadowRadius};box-shadow:${shadow};pointer-events:none;`;
    if (cornerShape) shade.style.setProperty("corner-shape", cornerShape);
    el.appendChild(shade);
    copy.style.boxShadow = "none";
  }
  el.appendChild(win);
  win.appendChild(copy);
  // Live heroes get a host for their own React content. Until that content has
  // rendered (usually the same frame), the snapshot underneath stands in.
  let liveHost: HTMLElement | null = null;
  if (opts.live) {
    liveHost = document.createElement("div");
    liveHost.className = ["zoom-live", opts.live.className].filter(Boolean).join(" ");
    liveHost.style.cssText = `position:absolute;left:0;top:0;width:${W0}px;height:${H0}px;margin:0;${shade ? "box-shadow:none;" : ""}`;
    win.appendChild(liveHost);
  }
  layer.appendChild(el);

  const cx = motionValue(A.cx);
  const cy = motionValue(A.cy);
  const s = motionValue(A.s);

  // The visible part's on-screen width and height each move evenly from one end's to the
  // other's, as the scale does. (Interpolating the crop insets in the copy's own units
  // instead left most of the widening for the end of the flight, since those insets are
  // multiplied by a scale that's growing: a late, lopsided stretch.)
  const crop = (sv: number) => {
    const t = A.s === B.s ? 1 : clamp((sv - A.s) / (B.s - A.s), 0, 1);
    const vw = A.vw + (B.vw - A.vw) * t;
    const vh = A.vh + (B.vh - A.vh) * t;
    return sv > 0
      ? { ix: Math.max(0, (W0 - vw / sv) / 2), iy: Math.max(0, (H0 - vh / sv) / 2), vw, vh }
      : { ix: 0, iy: 0, vw, vh };
  };
  const write = () => {
    scheduled = false;
    const sv = s.get();
    const { ix, iy } = crop(sv);
    const o = opts.offset ? opts.offset() : { x: 0, y: 0 };
    const left = cx.get() + o.x - (W0 * sv) / 2;
    const top = cy.get() + o.y - (H0 * sv) / 2;
    el.style.transform = `translate(${left}px, ${top}px) scale(${sv})`;
    // Corners in the copy's own (unscaled) units, so they read right on screen.
    const r = corners && sv > 0 ? screenRadius(sv) / sv : radius;
    if (corners) {
      const value = `${r}px`;
      copy.style.borderRadius = value;
      if (liveHost) liveHost.style.borderRadius = value;
    }
    // Crop: shrink the window to the visible part (see above).
    const cropping = ix > 0.5 || iy > 0.5;
    const offX = cropping ? ix : 0;
    const offY = cropping ? iy : 0;
    const inset = `${offY}px ${offX}px`;
    win.style.inset = inset;
    win.style.overflow = cropping ? "hidden" : "";
    win.style.borderRadius = cropping ? `${r}px` : "";
    copy.style.left = `${-offX}px`;
    copy.style.top = `${-offY}px`;
    if (liveHost) {
      liveHost.style.left = `${-offX}px`;
      liveHost.style.top = `${-offY}px`;
    }
    if (shade) {
      shade.style.inset = inset;
      if (corners || cropping) shade.style.borderRadius = `${r}px`;
      shade.style.opacity = String(clamp(opts.shadowOpacity ? opts.shadowOpacity() : 1, 0, 1));
    }
    // Following scrolled content: cut everything (shadow included) at the card's top
    // and bottom edges. The sides are pushed far out so nothing is cut there.
    const band = opts.clip ? opts.clip() : null;
    if (band && sv > 0) {
      const bt = Math.max(-OUTSIDE, (band.top - top) / sv);
      const bb = Math.max(-OUTSIDE, (top + H0 * sv - band.bottom) / sv);
      el.style.clipPath = `inset(${bt}px ${-OUTSIDE}px ${bb}px ${-OUTSIDE}px)`;
    } else el.style.clipPath = "";
  };
  // Three values change each frame; write the style once, in Motion's render step.
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frame.render(write);
  };
  const unsubscribe = [cx, cy, s].map((v) => v.on("change", schedule));
  write();

  const flight: Flight = {
    cx,
    cy,
    s,
    to: B,
    liveHost,
    dropSnapshot() {
      copy.remove();
    },
    invalidate: () => schedule(),
    retarget(next, radius) {
      const sv = s.get();
      rA = screenRadius(sv); // carry on from the corner it has now
      if (radius !== undefined) rB = radius;
      const now = crop(sv);
      A = { s: sv, cx: cx.get(), cy: cy.get(), vw: now.vw, vh: now.vh };
      B = fit(next);
      flight.to = B;
    },
    destroy() {
      unsubscribe.forEach((u) => u());
      cancelFrame(write);
      [cx, cy, s].forEach((v) => v.stop());
      el.remove();
    },
  };
  return flight;
}

function readRadius(hero: HTMLElement) {
  const target = (hero.firstElementChild as HTMLElement | null) ?? hero;
  const value = getComputedStyle(target).borderTopLeftRadius;
  return value.endsWith("px") ? parseFloat(value) : 0;
}

const MAX_FROZEN = 300;
function freezeStyles(source: Element, target: Element) {
  const from = [source, ...source.querySelectorAll("*")];
  const to = [target, ...target.querySelectorAll("*")];
  const n = Math.min(from.length, to.length, MAX_FROZEN);
  for (let i = 0; i < n; i++) {
    const cs = getComputedStyle(from[i]);
    let text = "";
    for (let j = 0; j < cs.length; j++) {
      const prop = cs[j];
      if (prop === "visibility" || prop.startsWith("transition") || prop.startsWith("animation")) continue;
      text += `${prop}:${cs.getPropertyValue(prop)};`;
    }
    (to[i] as HTMLElement).style.cssText = text;
  }
}
