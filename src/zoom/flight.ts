import { cancelFrame, frame, motionValue, type MotionValue } from "motion/react";
import { clamp } from "./springs";

export type Rect = { x: number; y: number; w: number; h: number };

type Fit = { s: number; cx: number; cy: number; ix: number; iy: number };

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
  /** Point the flight somewhere new from wherever it is now (its springs keep their speed). */
  retarget(next: Rect): void;
  /** Re-apply the extra offset (e.g. after the card's content scrolled). */
  invalidate(): void;
  destroy(): void;
};

export type HeroMetrics = { W0: number; H0: number; radius: number };

/** Far enough outside the copy's box that nothing a hero paints reaches it. */
const OUTSIDE = 10000;

/** Read everything a flight needs from the hero, in one go, before anything is written. */
export function measureHero(hero: HTMLElement): HeroMetrics {
  return { W0: hero.offsetWidth, H0: hero.offsetHeight, radius: readRadius(hero) };
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
  } = {},
): Flight {
  const { W0, H0, radius } = opts.metrics ?? measureHero(hero);
  const fit = (r: Rect): Fit => {
    const s = Math.max(r.w / W0, r.h / H0);
    return {
      s,
      cx: r.x + r.w / 2,
      cy: r.y + r.h / 2,
      ix: Math.max(0, (W0 - r.w / s) / 2),
      iy: Math.max(0, (H0 - r.h / s) / 2),
    };
  };
  let A = fit(from);
  let B = fit(to);

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
  copy.style.width = `${W0}px`;
  copy.style.height = `${H0}px`;
  el.appendChild(copy);
  // Live heroes get a host for their own React content. Until that content has
  // rendered (usually the same frame), the snapshot underneath stands in.
  let liveHost: HTMLElement | null = null;
  if (opts.live) {
    liveHost = document.createElement("div");
    liveHost.className = ["zoom-live", opts.live.className].filter(Boolean).join(" ");
    liveHost.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;margin:0;";
    el.appendChild(liveHost);
  }
  layer.appendChild(el);

  const cx = motionValue(A.cx);
  const cy = motionValue(A.cy);
  const s = motionValue(A.s);

  const crop = (sv: number) => {
    const t = A.s === B.s ? 1 : clamp((sv - A.s) / (B.s - A.s), 0, 1);
    return { ix: A.ix + (B.ix - A.ix) * t, iy: A.iy + (B.iy - A.iy) * t };
  };
  const write = () => {
    scheduled = false;
    const sv = s.get();
    const { ix, iy } = crop(sv);
    const o = opts.offset ? opts.offset() : { x: 0, y: 0 };
    const left = cx.get() + o.x - (W0 * sv) / 2;
    const top = cy.get() + o.y - (H0 * sv) / 2;
    el.style.transform = `translate(${left}px, ${top}px) scale(${sv})`;
    // Clip only the sides that are meant to be clipped. A clip-path also cuts
    // anything the hero paints outside its own box (a shadow, a cover swung open
    // in 3D, a glow), so every side that isn't being cropped is pushed far out
    // (negative inset) instead of sitting on the box edge.
    const cropX = ix > 0.5;
    const cropY = iy > 0.5;
    let it = cropY ? iy : -OUTSIDE;
    let ib = cropY ? iy : -OUTSIDE;
    const band = opts.clip ? opts.clip() : null;
    if (band && sv > 0) {
      it = Math.max(it, (band.top - top) / sv);
      ib = Math.max(ib, (top + H0 * sv - band.bottom) / sv);
    }
    const ixs = cropX ? ix : -OUTSIDE;
    el.style.clipPath =
      cropX || it > -OUTSIDE || ib > -OUTSIDE
        ? `inset(${it}px ${ixs}px ${ib}px ${ixs}px${cropX || cropY ? ` round ${radius}px` : ""})`
        : "";
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
    retarget(next) {
      const sv = s.get();
      A = { s: sv, cx: cx.get(), cy: cy.get(), ...crop(sv) };
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
