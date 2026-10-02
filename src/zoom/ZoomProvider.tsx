import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, motionValue, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import { REST, clamp, defaultTiming, springTo, type ZoomTiming } from "./springs";
import { createFlight, measureHero, prepareSnapshot, snapshotOf, type Flight, type HeroMetrics, type Rect } from "./flight";
import { attachGestures, type ZoomVelocity } from "./gestures";

/* ------------------------------------------------------------------ types */

export type ZoomGeometry = {
  /** Minimum gap between a card and the left/right edges; neighbours peek through it. */
  side: number;
  /** Space between cards. */
  gap: number;
  /** Space above and below the card. */
  top: number;
  bottom: number;
  /** Cards never get wider than this; extra width becomes side margin. */
  maxCardWidth: number;
};

/** How a card sits on its source when it lands (and starts from when it opens). */
export type ZoomLanding = {
  /** Card width as a fraction of the source's width. 1 = exactly as wide as the source. */
  widthRatio: number;
  /** How far above the source's top the card's top sits, as a fraction of the source's width. */
  topOffset: number;
};

/** How the drag-to-dismiss gesture feels. */
export type ZoomDismiss = {
  /** Drag this far down (px) and let go to close. */
  distance: number;
  /** Or flick down at least this fast (px/s)… */
  velocity: number;
  /** …having dragged at least this far (px). */
  minDistance: number;
  /** The card shrinks around this point, as a fraction of its height from the top. */
  pivotY: number;
  /** How much the card shrinks over a full-height drag (0.4 = to 60%). */
  maxShrink: number;
  /** How much of the dim fades out as the card shrinks under the finger. */
  dimFade: number;
  /** Close by dragging (touch or mouse) down from the card's top, up from its bottom, either, or not at all. */
  drag: "top" | "bottom" | "both" | false;
  /** Close by scrolling (mouse wheel or trackpad) past the card's top, bottom, either, or not at all. */
  wheel: "top" | "bottom" | "both" | false;
  /** How far (in px of scrolling) past the edge closes the card. */
  wheelDistance: number;
  /** A swipe that starts with the content within this many px of an edge can close the card. */
  wheelEdgeSlop: number;
};

const defaultLanding: ZoomLanding = { widthRatio: 1, topOffset: 0 };
const defaultDismiss: ZoomDismiss = {
  distance: 130,
  velocity: 650,
  minDistance: 24,
  pivotY: 0.3,
  maxShrink: 0.4,
  dimFade: 0.65,
  drag: "both",
  wheel: "both",
  wheelDistance: 240,
  wheelEdgeSlop: 32,
};

export type ZoomProviderProps = {
  children: ReactNode;
  /** The destination for a source: any React content. Mark its shared element with <ZoomHero>. */
  renderDestination: (id: string) => ReactNode;
  /** Element the overlay is portalled into (must be positioned). Defaults to document.body, as a fixed overlay. */
  container?: () => HTMLElement | null;
  /** Element made inert while a destination is open (the page behind). */
  background?: () => HTMLElement | null;
  timing?: Partial<ZoomTiming>;
  /** Playback speed for every transition; 0.2 is a handy slow motion for tuning. */
  timeScale?: number;
  geometry?: Partial<ZoomGeometry> | ((size: { width: number; height: number }) => Partial<ZoomGeometry>);
  /** Peak opacity of the backdrop dim. */
  dim?: number | (() => number);
  /**
   * Also pick up plain-HTML sources: elements with data-zoom-source="id" (and
   * optionally data-zoom-group). Clicking the element, or the link or button
   * around it, opens it. Lets static Astro markup zoom without being React.
   * Pass a selector to scan something other than [data-zoom-source].
   */
  scan?: boolean | string;
  /** How cards sit on their sources. Defaults to exactly the source's width, top-aligned. */
  landing?: Partial<ZoomLanding>;
  /** Drag-to-dismiss thresholds and feel. */
  dismiss?: Partial<ZoomDismiss>;
  /** Swipe between the items of a group. When false, only the opened item gets a card. Default true. */
  paging?: boolean;
  /** While open, hide every item of the group on the page (not just the visible one), so
   *  nothing shows twice in the gaps between cards. Default true. */
  hideGroupWhileOpen?: boolean;
  /** The close button on each card: true (default), false for none, or render your own.
   *  Your element closes the card if it (or a parent) has data-zoom-close, or calls close(). */
  closeButton?: boolean | ((close: () => void) => ReactNode);
  /**
   * Browser history. Off by default.
   * - mode "session": opening adds one entry; swiping between items only updates the
   *   address; Back closes. For sets people flick through quickly (the books).
   * - mode "item": every item visited adds an entry; Back steps back through them,
   *   then closes. For items that are "places" in their own right (projects).
   * url gives each item's address (default "#id"). Use your real page URLs (e.g.
   * "/writing/slug") so a reload or shared link lands on that item's own page.
   */
  history?: false | { mode: "session" | "item"; url?: (id: string) => string };
  /** Draw tuning aids: the wheel-dismiss edge zones in each card. */
  debug?: boolean;
  /** Accessible name for each destination card. */
  getLabel?: (id: string) => string;
  closeLabel?: string;
};

type Phase = "idle" | "opening" | "open" | "closing";
type Layout = { W: number; H: number; side: number; gap: number; cardW: number; step: number; top: number; cardH: number };
type SourceEntry = { id: string; group: string; el: HTMLElement };
type CardValues = { x: MotionValue<number>; y: MotionValue<number>; s: MotionValue<number>; o: MotionValue<number> };
type HeroContent = { children: ReactNode; className?: string; style?: CSSProperties; live: boolean };
type Item = {
  id: string;
  j: number;
  /** 0 = sitting on its source, 1 = fully open. Overshoots with bounce. */
  progress: MotionValue<number>;
  /** 1 when this item's card is the centred page, falling to 0 one page away. Follows the swipe. */
  focus: MotionValue<number>;
  /** The flight's scale (relative to the hero) when it sits exactly on the source. */
  srcFit: number;
  offFlight: (() => void) | null;
  /** The card's own transform (on top of the shared zoom) and opacity. */
  cv: CardValues;
  /** The hero's flying copy, while it's in the air. */
  flight: Flight | null;
  /** True once this card has landed on its source during a close. */
  landed: boolean;
  /** While the hero flies *to the card*: the card's scroll position when it set off. */
  flightScroll0: number | null;
  /** …and its latest scroll position (read in scroll events, never mid-frame). */
  flightScrollNow: number;
  /** …and the track position its landing spot assumed (paging mid-flight shifts it). */
  flightTrack0: number | null;
  offOpacity: (() => void) | null;
  /** Motion values shared by every rendering of this item (card and flying copy). */
  values: Map<string, { mv: MotionValue<number>; initial: number }>;
  /** useZoomEvent subscribers (only the card's rendering subscribes). */
  listeners: Set<(e: ZoomEvent) => void>;
  api: ItemApi;
  /** The card's scale when sitting on its source. */
  sLand: number;
};

const defaultGeometry: ZoomGeometry = { side: 18, gap: 8, top: 24, bottom: 14, maxCardWidth: 720 };

/* ------------------------------------------------------------------ contexts */

type ZoomContextValue = {
  open(id: string): void;
  close(): void;
  register(entry: SourceEntry): () => void;
  isOpen: boolean;
};
export const ZoomContext = createContext<ZoomContextValue | null>(null);

/** Open or close from anywhere inside a ZoomProvider. */
export function useZoom() {
  const ctx = useContext(ZoomContext);
  if (!ctx) throw new Error("useZoom must be used inside <ZoomProvider>");
  return { open: ctx.open, close: ctx.close, isOpen: ctx.isOpen };
}

type CardContextValue = {
  id: string;
  index: number;
  active: boolean;
  setHero(el: HTMLElement | null): void;
  setHeroContent(content: HeroContent | null): void;
  close(): void;
};
export const ZoomCardContext = createContext<CardContextValue | null>(null);

export type ZoomPhase = Phase;
/**
 * Sent to each item at the start and end of every transition. A transition that
 * turns another around arrives with interrupted: true (e.g. "closing" while the
 * item was still opening), so content can carry on from where it is.
 */
export type ZoomEvent = {
  /**
   * opening / closing: a transition has started. opened / closed: it has settled.
   * activated / deactivated: this item became, or stopped being, the visible card
   * (after a swipe, an arrow key, a tap on a neighbour, or turning a close around
   * onto a different item).
   */
  type: "opening" | "opened" | "closing" | "closed" | "activated" | "deactivated";
  id: string;
  /** This transition turned the previous one around mid-flight. */
  interrupted: boolean;
  /** This item is the visible card (the others are its neighbours in the group). */
  active: boolean;
  reducedMotion: boolean;
  /** The provider's timeScale, so content running its own animations can match slow motion. */
  timeScale: number;
};
type ItemApi = {
  subscribe(fn: (e: ZoomEvent) => void): () => void;
  value(name: string, initial: number): MotionValue<number>;
};
type HeroContextValue = {
  progress: MotionValue<number>;
  focus: MotionValue<number>;
  phase: MotionValue<Phase>;
  inFlight: boolean;
  item?: ItemApi;
};
export const ZoomHeroContext = createContext<HeroContextValue | null>(null);
const restingHero: HeroContextValue = {
  progress: motionValue(1),
  focus: motionValue(1),
  phase: motionValue<Phase>("idle"),
  inFlight: false,
};

/**
 * The transition as seen by one item, for animating content inside it (the hero
 * or anything else in the destination). progress runs from 0 (on its source) to
 * 1 (fully open), continuously through interruptions and drags, and overshoots
 * with bounce. focus is 1 while the item is the centred page and falls to 0 as it
 * slides one page away, following the finger during a swipe. Works both in the
 * card and in the hero's live flying copy, so the two always agree. Outside a
 * zoom both read as 1.
 */
export function useZoomProgress() {
  return useContext(ZoomHeroContext) ?? restingHero;
}

/**
 * Start/interrupt signals for content that animates on its own clock. The handler
 * runs once per item (from the card, never again from the flying copy), at the
 * start of opening and closing, and when each settles. Pair it with useZoomValue
 * so the card and its flying copy show the same animation.
 */
export function useZoomEvent(handler: (e: ZoomEvent) => void) {
  const ctx = useContext(ZoomHeroContext);
  const ref = useRef(handler);
  ref.current = handler;
  const item = ctx?.item;
  const inFlight = ctx?.inFlight;
  useLayoutEffect(() => {
    if (!item || inFlight) return;
    return item.subscribe((e) => ref.current(e));
  }, [item, inFlight]);
}

/**
 * A Motion value shared by every rendering of this item (the card and the hero's
 * flying copy), so an animation started from useZoomEvent shows identically in
 * both. Resets to `initial` each time the item is opened from rest. Outside a zoom
 * it's an ordinary local value.
 */
export function useZoomValue(name: string, initial: number) {
  const ctx = useContext(ZoomHeroContext);
  const local = useMotionValue(initial);
  return ctx?.item ? ctx.item.value(name, initial) : local;
}

/** Inside destination content: which item this is, whether it's the visible card, and a close function. */
export function useZoomItem() {
  const ctx = useContext(ZoomCardContext);
  if (!ctx) throw new Error("useZoomItem must be used inside destination content");
  return { id: ctx.id, index: ctx.index, isActive: ctx.active, close: ctx.close };
}

/* ------------------------------------------------------------------ provider */

const NO_OFFSET = { x: 0, y: 0 };

/** Swaps the flight's snapshot for the live content as soon as it has rendered. */
/** Debug: the bands of content within wheelEdgeSlop of the top and bottom. If any of a
 *  band is on screen, a swipe toward that edge can close the card. */
function EdgeZones({ slop }: { slop: number }) {
  return (
    <>
      <div className="zoom-debug-edge zoom-debug-top" style={{ height: slop }} aria-hidden="true">
        <span>edge zone {slop}px</span>
      </div>
      <div className="zoom-debug-edge zoom-debug-bottom" style={{ height: slop }} aria-hidden="true">
        <span>edge zone {slop}px</span>
      </div>
    </>
  );
}

type LiveEntry = { host: HTMLElement; flight: Flight; key: number };
type LiveFlightsHandle = { add(id: string, entry: LiveEntry): void; remove(id: string, flight: Flight): void };
/**
 * Holds the live flying heroes in its own state, so adding or removing one only
 * re-renders the flights, not the provider and every card's content (which cost
 * a dropped frame each time a book took off or landed).
 */
function LiveFlights({
  handleRef,
  render,
}: {
  handleRef: { current: LiveFlightsHandle | null };
  render: (id: string, entry: LiveEntry) => ReactNode;
}) {
  const [map, setMap] = useState(() => new Map<string, LiveEntry>());
  handleRef.current = {
    add: (id, entry) => setMap((prev) => new Map(prev).set(id, entry)),
    remove: (id, flight) =>
      setMap((prev) => {
        if (prev.get(id)?.flight !== flight) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      }),
  };
  return <>{[...map.entries()].map(([id, entry]) => render(id, entry))}</>;
}

function LiveMount({ onMount, children }: { onMount: () => void; children: ReactNode }) {
  useLayoutEffect(onMount, []);
  return <>{children}</>;
}

export function ZoomProvider(props: ZoomProviderProps) {
  const latest = useRef(props);
  latest.current = props;
  const reduce = useReducedMotion();
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  const sources = useRef(new Map<string, SourceEntry>());
  const heroes = useRef(new Map<string, HTMLElement>());
  const heroContent = useRef(new Map<string, HeroContent>());
  const liveFlights = useRef<LiveFlightsHandle | null>(null);
  const phaseMV = useMotionValue<Phase>("idle");
  const cardEls = useRef(new Map<string, HTMLElement>());
  const items = useRef(new Map<string, Item>());
  const rootRef = useRef<HTMLDivElement>(null);
  const zoomerRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);

  const [host, setHost] = useState<HTMLElement | null>(null);
  const [session, setSession] = useState<{ ids: string[]; key: number } | null>(null);
  const [index, setIndexState] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [announce, setAnnounce] = useState("");

  // Mutable state the animations read every frame; kept out of React on purpose.
  const S = useRef({
    phase: "idle" as Phase,
    /** "zoom": one shared transform on the pager. "cards": each card moves on its own. */
    mode: "zoom" as "zoom" | "cards",
    /** Bumped by every transition; completions from an interrupted transition are ignored. */
    gen: 0,
    ids: [] as string[],
    index: 0,
    L: null as Layout | null,
    reduced: false,
    dimMax: 0.35,
    s0: 1,
    dimAnchor: { p0: 1, d0: 0 },
    offDim: null as (() => void) | null,
    pendingOpen: null as string | null,
    origin: null as HTMLElement | null,
    refocus: false,
    /** History entries this provider has added on top of the page's own. */
    histDepth: 0,
    /** popstate events caused by our own history.go(), to be ignored. */
    ignorePops: 0,
    /** An entry to add once our own pending history.go() has landed. */
    pendingPush: null as string | null,
    /** True while reacting to Back/Forward, so we don't write history back. */
    fromPop: false,
    scrollLock: "",
  }).current;

  // The shared zoom: the whole pager (card, metadata, neighbours) scales together.
  const trackX = useMotionValue(0);
  const zx = useMotionValue(0);
  const zy = useMotionValue(0);
  const zs = useMotionValue(1);
  const zoomOpacity = useMotionValue(1);
  const dimOpacity = useMotionValue(0);
  const fade = useMotionValue(0); // reduced motion only

  const timing = (): ZoomTiming => ({ ...defaultTiming, ...latest.current.timing });
  const landing = (): ZoomLanding => ({ ...defaultLanding, ...latest.current.landing });
  const dismiss = (): ZoomDismiss => ({ ...defaultDismiss, ...latest.current.dismiss });
  const speed = () => latest.current.timeScale ?? 1;

  // Resolved in a passive effect: by then every ref in the tree, including a
  // container that wraps this provider, has been attached.
  useEffect(() => {
    const c = latest.current.container;
    setHost(c ? c() : document.body);
  }, []);
  const fixed = host === document.body;

  const getItem = (id: string, j = 0) => {
    let it = items.current.get(id);
    if (!it) {
      const cv = { x: motionValue(0), y: motionValue(0), s: motionValue(1), o: motionValue(1) };
      it = {
        id,
        j,
        progress: motionValue(1),
        focus: motionValue(j === S.index ? 1 : 0),
        values: new Map(),
        listeners: new Set(),
        api: null as unknown as ItemApi,
        srcFit: NaN,
        offFlight: null,
        flightScroll0: null,
        flightScrollNow: 0,
        flightTrack0: null,
        cv,
        flight: null,
        landed: false,
        offOpacity: null,
        sLand: NaN,
      };
      items.current.set(id, it);
      const self = it;
      it.api = {
        subscribe: (fn) => {
          self.listeners.add(fn);
          return () => {
            self.listeners.delete(fn);
          };
        },
        value: (name, initial) => {
          let v = self.values.get(name);
          if (!v) {
            v = { mv: motionValue(initial), initial };
            self.values.set(name, v);
          }
          return v.mv;
        },
      };
      cv.s.on("change", () => updateProgress(self));
      cv.o.on("change", () => updateProgress(self));
    }
    it.j = j;
    return it;
  };
  const resetItem = (it: Item) => {
    it.values.forEach((v) => v.mv.jump(v.initial));
    endFlight(it);
    it.srcFit = NaN;
    it.offOpacity?.();
    it.offOpacity = null;
    it.landed = false;
    it.sLand = NaN;
    it.cv.x.jump(0);
    it.cv.y.jump(0);
    it.cv.s.jump(1);
    it.cv.o.jump(1);
  };

  const emit = (it: Item, type: ZoomEvent["type"], interrupted = false) => {
    if (!it.listeners.size) return;
    const e: ZoomEvent = {
      type,
      id: it.id,
      interrupted,
      active: it.j === S.index,
      reducedMotion: S.reduced,
      timeScale: speed(),
    };
    it.listeners.forEach((fn) => fn(e));
  };
  const emitAll = (type: ZoomEvent["type"], interrupted = false) =>
    S.ids.forEach((id, j) => emit(getItem(id, j), type, interrupted));

  /* -------------------------------------------------------------- history */

  const historyOption = () => latest.current.history || null;
  const urlFor = (id: string) => (historyOption()?.url ?? ((x: string) => `#${encodeURIComponent(x)}`))(id);
  /** Add an entry for an opened item. */
  const pushEntry = (id: string) => {
    if (!historyOption() || S.fromPop) return;
    if (S.ignorePops > 0) {
      S.pendingPush = id; // our own Back is still landing; add the entry after it
      return;
    }
    S.histDepth += 1;
    window.history.pushState({ zoom: id, depth: S.histDepth }, "", urlFor(id));
  };
  /** The visible item changed: a new entry ("item" mode) or just a new address ("session" mode). */
  const recordPage = (id: string) => {
    const h = historyOption();
    if (!h || S.fromPop || S.histDepth === 0) return;
    if (h.mode === "item") {
      S.histDepth += 1;
      window.history.pushState({ zoom: id, depth: S.histDepth }, "", urlFor(id));
    } else {
      window.history.replaceState({ zoom: id, depth: S.histDepth }, "", urlFor(id));
    }
  };
  /** Closing from the UI: step back past every entry we added. */
  const leaveHistory = () => {
    S.pendingPush = null;
    if (!historyOption()) return;
    if (S.fromPop) {
      S.histDepth = 0;
      return;
    }
    if (S.histDepth > 0) {
      const n = S.histDepth;
      S.histDepth = 0;
      S.ignorePops += 1;
      window.history.go(-n);
    }
  };

  const setPhase = (p: Phase) => {
    S.phase = p;
    phaseMV.set(p);
    if (rootRef.current) rootRef.current.dataset.phase = p;
  };

  const computeLayout = (): Layout => {
    const root = rootRef.current!;
    const W = root.clientWidth;
    const H = root.clientHeight;
    const g = latest.current.geometry;
    const geo = { ...defaultGeometry, ...(typeof g === "function" ? g({ width: W, height: H }) : g) };
    const cardW = Math.min(W - geo.side * 2, geo.maxCardWidth);
    const side = (W - cardW) / 2;
    return { W, H, side, gap: geo.gap, cardW, step: cardW + geo.gap, top: geo.top, cardH: H - geo.top - geo.bottom };
  };
  const targetX = (i: number) => S.L!.side - i * S.L!.step;
  const rel = (r: DOMRect, root: DOMRect = rootRef.current!.getBoundingClientRect()): Rect => ({
    x: r.left - root.left,
    y: r.top - root.top,
    w: r.width,
    h: r.height,
  });
  // The zoom that shrinks a whole card onto a source rect: slightly narrower
  // than the source, centred on it, its top just above the source's top.
  const zoomOnto = (r: Rect, cardX: number, cardY: number) => {
    const { widthRatio, topOffset } = landing();
    const w = r.w * widthRatio;
    const s = w / S.L!.cardW;
    const left = r.x + (r.w - w) / 2;
    const top = r.y - r.w * topOffset;
    return { s, x: left - s * cardX, y: top - s * cardY, left, top };
  };

  const heroFor = (id: string) =>
    heroes.current.get(id) ?? cardEls.current.get(id)?.querySelector<HTMLElement>("[data-zoom-hero]") ?? null;
  /** Where the hero sits inside its card, in the card's own (unscaled) units. */
  const heroOffset = (id: string) => {
    const hero = heroFor(id);
    const card = cardEls.current.get(id);
    if (!hero || !card) return null;
    const hr = hero.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const k = cr.width / card.offsetWidth || 1;
    return { x: (hr.left - cr.left) / k, y: (hr.top - cr.top) / k, w: hero.offsetWidth, h: hero.offsetHeight };
  };

  /* -------------------------------------------------------------- progress & flights */

  // Progress is the card's on-screen scale between "sitting on its source" (0) and
  // full size (1). Measured on the card rather than the flight, so it's identical
  // across the hand-over from the shared zoom to per-card motion: no jumps.
  const progressOf = (it: Item) => {
    if (S.reduced) return 1;
    const scale = S.mode === "zoom" ? zs.get() * it.cv.s.get() : it.cv.s.get();
    const sLand = Number.isFinite(it.sLand) ? it.sLand : S.s0;
    if (sLand >= 1) return it.cv.o.get();
    return (scale - sLand) / (1 - sLand);
  };
  function updateProgress(it: Item) {
    it.progress.set(progressOf(it));
  }
  const updateAllProgress = () => items.current.forEach(updateProgress);

  const updateAllFocus = () => {
    if (!S.L) return;
    const x = trackX.get();
    S.ids.forEach((id, j) => {
      const d = Math.abs(x - targetX(j)) / S.L!.step;
      getItem(id, j).focus.set(clamp(1 - d, 0, 1));
    });
  };

  /** The hero's scale (relative to its own size) when it exactly covers a rect. */
  const fitOf = (m: HeroMetrics, r: Rect) => Math.max(r.w / m.W0, r.h / m.H0);

  const isLive = (id: string) => !!heroContent.current.get(id)?.live;
  /** Everything a flight needs from the DOM, read before anything is written. */
  const prepareFlight = (id: string, hero: HTMLElement) => ({
    metrics: measureHero(hero),
    snapshot: snapshotOf(hero, isLive(id)),
  });

  const liveKey = useRef(0);
  /** The card's scroller, for following content scrolled while the hero is in flight. */
  const scrollerOf = (id: string) => cardEls.current.get(id)?.querySelector<HTMLElement>(".zoom-card-scroll") ?? null;
  function startFlight(
    it: Item,
    hero: HTMLElement,
    from: Rect,
    to: Rect,
    pre: ReturnType<typeof prepareFlight>,
    /** Heading into the card: the track position its landing spot was worked out for. */
    toCardTrack: number | null = null,
  ) {
    const content = heroContent.current.get(it.id);
    const live = !!content?.live;
    const toCard = toCardTrack !== null;
    it.flightScroll0 = toCard ? scrollerOf(it.id)?.scrollTop ?? 0 : null;
    it.flightScrollNow = it.flightScroll0 ?? 0;
    it.flightTrack0 = toCardTrack;
    const flight = createFlight(flightRef.current!, hero, from, to, {
      id: it.id,
      live: live ? { className: content!.className } : undefined,
      metrics: pre.metrics,
      snapshot: pre.snapshot,
      // Heading into the card: if its content is scrolled mid-flight, the hero's
      // landing spot moves with it, so the flight follows 1:1 (at the card's
      // current scale) and lands exactly where the hero is. No pop at the end.
      // Likewise sideways: paging mid-flight slides the cards, and the landing spot
      // slides with them.
      offset: () => {
        if (it.flightScroll0 === null && it.flightTrack0 === null) return NO_OFFSET;
        const x = it.flightTrack0 === null ? 0 : (trackX.get() - it.flightTrack0) * zs.get();
        const y = it.flightScroll0 === null ? 0 : -(it.flightScrollNow - it.flightScroll0) * zs.get() * it.cv.s.get();
        return { x, y };
      },
      // Once it's following scrolled content, the copy is part of that content: hide
      // whatever has scrolled past the card's top or bottom edge, like the rest of it.
      clip: () => {
        if (it.flightScroll0 === null || it.flightScrollNow === it.flightScroll0 || !S.L) return null;
        const top = zy.get() + zs.get() * (S.L.top + it.cv.y.get());
        return { top, bottom: top + zs.get() * it.cv.s.get() * S.L.cardH };
      },
    });
    it.flight = flight;
    hero.style.visibility = "hidden";
    if (live && flight.liveHost) {
      const host = flight.liveHost;
      liveFlights.current?.add(it.id, { host, flight, key: ++liveKey.current });
    }
    updateProgress(it);
    return flight;
  }
  function endFlight(it: Item) {
    if (!it.flight) return;
    it.offFlight?.();
    it.offFlight = null;
    const flight = it.flight;
    it.flight = null;
    it.flightScroll0 = null;
    it.flightTrack0 = null;
    flight.destroy();
    liveFlights.current?.remove(it.id, flight);
    updateProgress(it);
  }

  /* -------------------------------------------------------------- dim & fades */

  const restingDim = () => {
    const d = dismiss();
    return S.dimMax * (1 - clamp((1 - zs.get()) / d.maxShrink, 0, 1) * d.dimFade);
  };
  /** How far the active card is between its source (0) and fully open (1). */
  const activeProgress = () => {
    const it = items.current.get(S.ids[S.index]);
    if (!it) return 1;
    if (!Number.isFinite(it.sLand)) return clamp(it.cv.o.get(), 0, 1);
    return clamp((it.cv.s.get() - it.sLand) / (1 - it.sLand), 0, 1);
  };
  const updateDerived = () => {
    if (S.phase === "idle") return;
    if (S.reduced) {
      const f = clamp(fade.get(), 0, 1);
      zoomOpacity.set(f);
      dimOpacity.set(restingDim() * f);
    } else if (S.mode === "cards") {
      // Continuous from wherever the dim was when this transition started,
      // heading to full dim when open and to none at the sources.
      const p = activeProgress();
      const { p0, d0 } = S.dimAnchor;
      const d =
        p >= p0 ? (p0 >= 0.999 ? S.dimMax : d0 + ((S.dimMax - d0) * (p - p0)) / (1 - p0)) : p0 <= 0.001 ? 0 : (d0 * p) / p0;
      zoomOpacity.set(1);
      dimOpacity.set(d);
    } else if (S.phase === "opening") {
      const t = clamp((zs.get() - S.s0) / (1 - S.s0), 0, 1);
      dimOpacity.set(S.dimMax * t);
      // Only the smallest quarter of the zoom fades, so the card never pops in.
      zoomOpacity.set(clamp(t * 4, 0, 1));
    } else {
      zoomOpacity.set(1);
      dimOpacity.set(restingDim());
    }
  };
  useEffect(() => {
    const off = [
      zs.on("change", updateDerived),
      zs.on("change", updateAllProgress),
      trackX.on("change", () =>
        items.current.forEach((it) => {
          if (it.flight && it.flightTrack0 !== null) it.flight.invalidate();
        }),
      ),
      trackX.on("change", updateAllFocus),
      fade.on("change", updateDerived),
    ];
    return () => off.forEach((u) => u());
  }, []);

  const orderedIds = (group: string) =>
    [...sources.current.values()]
      .filter((e) => e.group === group && e.el.isConnected)
      .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((e) => e.id);

  const register = useCallback((entry: SourceEntry) => {
    sources.current.set(entry.id, entry);
    return () => {
      if (sources.current.get(entry.id)?.el === entry.el) sources.current.delete(entry.id);
    };
  }, []);

  /** While open: hide the group's items on the page, or just the visible one. */
  const hideForOpen = () => {
    if (latest.current.hideGroupWhileOpen === false) {
      S.ids.forEach((id, j) => {
        const el = sources.current.get(id)?.el;
        if (!el) return;
        if (j === S.index) el.dataset.zoomHidden = "";
        else delete el.dataset.zoomHidden;
      });
    } else setGroupHidden(true);
  };
  const setGroupHidden = (hidden: boolean) => {
    S.ids.forEach((id) => {
      const el = sources.current.get(id)?.el;
      if (!el) return;
      if (hidden) el.dataset.zoomHidden = "";
      else delete el.dataset.zoomHidden;
    });
  };

  const setBackgroundInert = (inert: boolean) => {
    const bg = latest.current.background?.();
    if (bg) bg.inert = inert;
  };

  /* -------------------------------------------------------------- open */

  const open = useCallback((id: string) => {
    // Tapping a source while its group is closing turns the close around.
    if (S.phase === "closing") {
      if (S.ids.includes(id)) reopen(id);
      return;
    }
    if (S.phase !== "idle" || !rootRef.current) return;
    const entry = sources.current.get(id);
    if (!entry) return;
    const ids = latest.current.paging === false ? [id] : orderedIds(entry.group);
    S.ids = ids;
    S.index = ids.indexOf(id);
    S.L = computeLayout();
    S.reduced = !!reduceRef.current;
    const d = latest.current.dim;
    S.dimMax = typeof d === "function" ? d() : d ?? 0.35;
    S.pendingOpen = id;
    S.origin = entry.el;
    S.mode = "zoom";
    setPhase("opening");
    ids.forEach((i, j) => resetItem(getItem(i, j)));
    trackX.jump(targetX(S.index)); // so the freshly mounted track renders in place
    updateAllFocus();
    setLayout(S.L);
    setIndexState(S.index);
    setSession({ ids, key: Date.now() });
    pushEntry(id);
  }, []);

  // First open from idle: runs after the cards mount but before they paint.
  useLayoutEffect(() => {
    if (!session || !S.pendingOpen) return;
    const id = S.pendingOpen;
    S.pendingOpen = null;
    const gen = ++S.gen;
    const root = rootRef.current!;
    const zoomer = zoomerRef.current!;
    const L = S.L!;
    const T = timing();
    const sp = speed();

    setBackgroundInert(true);
    if (fixed) {
      S.scrollLock = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
    }
    root.dataset.phase = S.phase;

    if (S.reduced) {
      zx.jump(0);
      zy.jump(0);
      zs.jump(1);
      fade.jump(0);
      zoomer.style.opacity = "0";
      dimRef.current!.style.opacity = "0";
      root.dataset.open = "";
      emitAll("opening");
      // Reduced motion crossfades, so the page's items disappear once the cards cover them.
      springTo(fade, 1, T.fade, { restDelta: REST.opacity, speed: sp }).then(() => {
        if (gen !== S.gen) return;
        hideForOpen();
        openDone();
      });
      return;
    }

    // Each item's landing scale on its own source, for progress.
    S.ids.forEach((other, j) => {
      const el = sources.current.get(other)?.el;
      if (el) getItem(other, j).sLand = zoomOnto(rel(el.getBoundingClientRect()), 0, 0).s;
    });

    // Measure at full size first, before the zoom is applied (and before any writes).
    const card = cardEls.current.get(id)!;
    const hero = heroFor(id);
    const src = rel(S.origin!.getBoundingClientRect());
    let heroTarget: Rect | null = null;
    const pre = hero ? prepareFlight(id, hero) : null;
    if (hero) {
      const hr = hero.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      heroTarget = { x: L.side + (hr.left - cr.left), y: L.top + (hr.top - cr.top), w: hr.width, h: hr.height };
    }

    const z = zoomOnto(src, L.side, L.top);
    S.s0 = z.s;
    zx.jump(z.x);
    zy.jump(z.y);
    zs.jump(z.s);
    // Motion writes on its next frame; write the first frame ourselves so nothing flashes.
    zoomer.style.transform = `translateX(${z.x}px) translateY(${z.y}px) scale(${z.s})`;
    zoomer.style.opacity = "0";
    dimRef.current!.style.opacity = "0";
    // Every item that has a card in the pager is hidden on the page while it's up,
    // so nothing shows twice in the gaps between cards (unless hideGroupWhileOpen is off).
    hideForOpen();
    root.dataset.open = "";

    const anims = [
      springTo(zx, 0, T.open, { speed: sp }),
      springTo(zy, 0, T.open, { speed: sp }),
      springTo(zs, 1, T.open, { restDelta: REST.scale, speed: sp }),
    ];
    const it = getItem(id, S.index);
    it.sLand = z.s;
    if (hero && heroTarget && pre) {
      it.srcFit = fitOf(pre.metrics, src);
      const f = startFlight(it, hero, src, heroTarget, pre, targetX(S.index));
      anims.push(
        springTo(f.cx, f.to.cx, T.open, { speed: sp }),
        springTo(f.cy, f.to.cy, T.open, { speed: sp }),
        springTo(f.s, f.to.s, T.open, { restDelta: REST.scale, speed: sp }),
      );
    }
    updateDerived();
    emitAll("opening");
    Promise.all(anims).then(() => {
      if (gen !== S.gen) return; // interrupted
      if (hero) hero.style.visibility = "";
      endFlight(it);
      openDone();
    });
  }, [session]);

  // Static heroes fly as a frozen snapshot, which is slow to build. Build it while
  // nothing is moving, so closing (often mid-gesture) doesn't have to.
  const prefreezeStaticHeroes = () => {
    const gen = S.gen;
    const run = () => {
      if (gen !== S.gen || S.phase !== "open") return;
      S.ids.forEach((id) => {
        const hero = heroFor(id);
        if (hero && !isLive(id)) prepareSnapshot(hero);
      });
    };
    const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined;
    if (ric) ric(run, { timeout: 500 });
    else setTimeout(run, 200);
  };

  const gesturesRef = useRef<{ refresh(): void } | null>(null);

  const openDone = () => {
    S.mode = "zoom";
    // Drag progress is measured against the visible item's own source.
    const active = items.current.get(S.ids[S.index]);
    if (active && Number.isFinite(active.sLand)) S.s0 = active.sLand;
    setPhase("open");
    updateAllProgress();
    emitAll("opened");
    gesturesRef.current?.refresh();
    prefreezeStaticHeroes();
    updateDerived();
    const card = cardEls.current.get(S.ids[S.index]);
    card?.querySelector<HTMLElement>("[data-zoom-close]")?.focus({ preventScroll: true });
  };

  /* -------------------------------------------------------------- paging */

  const setIndex = (i: number) => {
    S.refocus = !!rootRef.current?.contains(document.activeElement);
    const previous = S.index;
    S.index = i;
    if (previous !== i && (S.phase === "open" || S.phase === "opening")) {
      recordPage(S.ids[i]);
      const prevId = S.ids[previous];
      if (prevId) emit(getItem(prevId, previous), "deactivated");
      emit(getItem(S.ids[i], i), "activated");
    }
    if (S.phase === "open" && latest.current.hideGroupWhileOpen === false) hideForOpen();
    setIndexState(i);
    const label = latest.current.getLabel?.(S.ids[i]) ?? S.ids[i];
    setAnnounce(`${label}, ${i + 1} of ${S.ids.length}`);
  };
  useEffect(() => {
    gesturesRef.current?.refresh();
    if (!S.refocus || S.phase !== "open") return;
    S.refocus = false;
    cardEls.current.get(S.ids[index])?.querySelector<HTMLElement>("[data-zoom-close]")?.focus({ preventScroll: true });
  }, [index]);

  // Also while opening: the cards and the flying hero slide over without restarting.
  const page = (d: number) => {
    if (S.phase !== "open" && S.phase !== "opening") return;
    const i = clamp(S.index + d, 0, S.ids.length - 1);
    if (i === S.index) {
      // At the end: a small push into the edge, then settle back.
      if (!S.reduced) springTo(trackX, targetX(i), timing().page, { velocity: -d * 500, speed: speed() });
      return;
    }
    setIndex(i);
    if (S.reduced) trackX.jump(targetX(i));
    else springTo(trackX, targetX(i), timing().page, { speed: speed() });
  };

  /* -------------------------------------------------------------- per-card transitions */

  /**
   * Folds the shared zoom (and the track's position) into each card's own
   * transform, keeping every card exactly where it is on screen and carrying its
   * current velocity, so the next transition starts without a seam. Returns
   * each card's velocity in its new coordinates.
   */
  const bake = (zoomVelocity?: ZoomVelocity) => {
    const L = S.L!;
    // During a drag the zoom is set straight from the finger, so its own velocity
    // reads 0; the gesture passes the real one in.
    const Z = {
      x: zx.get(),
      y: zy.get(),
      s: zs.get(),
      vx: zoomVelocity?.vx ?? zx.getVelocity(),
      vy: zoomVelocity?.vy ?? zy.getVelocity(),
      vs: zoomVelocity?.vs ?? zs.getVelocity(),
    };
    const tx = trackX.get();
    const tv = trackX.getVelocity();
    trackX.jump(tx);
    const velocities = new Map<string, { vx: number; vy: number; vs: number }>();
    S.ids.forEach((id, j) => {
      const { cv } = getItem(id, j);
      const C = { x: cv.x.get(), y: cv.y.get(), s: cv.s.get(), vx: cv.x.getVelocity(), vy: cv.y.getVelocity(), vs: cv.s.getVelocity() };
      const px = tx + j * L.step;
      const py = L.top;
      cv.x.jump(Z.x + Z.s * (px + C.x) - px);
      cv.y.jump(Z.y + Z.s * (py + C.y) - py);
      cv.s.jump(Z.s * C.s);
      velocities.set(id, {
        vx: Z.vx + Z.vs * (px + C.x) + Z.s * (tv + C.vx),
        vy: Z.vy + Z.vs * (py + C.y) + Z.s * C.vy,
        vs: Z.vs * C.s + Z.s * C.vs,
      });
    });
    zx.jump(0);
    zy.jump(0);
    zs.jump(1);
    return velocities;
  };

  /**
   * Sends every card to its source ("sources") or back to fully open ("open"),
   * from wherever each one is right now. Used for closing, and for turning an
   * open or a close around mid-flight.
   */
  const transitionCards = (
    target: "sources" | "open",
    index: number,
    zoomVelocity?: ZoomVelocity,
    opts: { towardTargetOnly?: boolean } = {},
  ) => {
    const gen = ++S.gen;
    const L = S.L!;
    const T = timing();
    const sp = speed();
    const spec = target === "sources" ? T.close : T.open;
    const restPx = target === "sources" ? REST.landPx : REST.px;
    const restScale = target === "sources" ? REST.landScale : REST.scale;

    // Read everything up front, then write. Interleaving reads with writes made the
    // browser recompute layout once per card at the moment of release.
    const rootBox = rootRef.current!.getBoundingClientRect();
    const measured = new Map(
      S.ids.map((id) => {
        const it = getItem(id, S.ids.indexOf(id));
        const hero = heroFor(id);
        const src = sources.current.get(id);
        return [
          id,
          {
            offset: heroOffset(id),
            heroRect: hero ? rel(hero.getBoundingClientRect(), rootBox) : null,
            dest: src ? rel(src.el.getBoundingClientRect(), rootBox) : null,
            // Only cards without a flight in the air will need a new one.
            pre: hero && !it.flight ? prepareFlight(id, hero) : null,
            metrics: hero ? measureHero(hero) : null,
          },
        ];
      }),
    );
    S.mode = "cards";
    const velocities = bake(zoomVelocity);
    updateAllProgress();
    if (target === "open" && Math.abs(trackX.get() - targetX(index)) > 0.5) {
      springTo(trackX, targetX(index), spec, { speed: sp });
    }

    const order = S.ids.filter((_, j) => j !== index).concat(S.ids[index]); // active on top
    const landings = order.map((id) => {
      const it = getItem(id, S.ids.indexOf(id));
      const { cv } = it;
      const src = sources.current.get(id);
      const hero = heroFor(id);
      const m = measured.get(id)!;
      const off = m.offset;
      const v = velocities.get(id)!;
      const vx = v.vx;
      const vy = v.vy;
      const P = { x: trackX.get() + it.j * L.step, y: L.top }; // the card's untransformed top-left
      const dest = m.dest;

      if (target === "sources" && it.landed) return Promise.resolve(); // already home

      if (!dest || !src) {
        // Nothing to return to: just fade (and settle back in place if reopening).
        const anims = [springTo(cv.o, target === "sources" ? 0 : 1, T.fade, { restDelta: REST.opacity, speed: sp })];
        if (target === "open") {
          anims.push(
            springTo(cv.x, 0, spec, { velocity: vx, speed: sp }),
            springTo(cv.y, 0, spec, { velocity: vy, speed: sp }),
            springTo(cv.s, 1, spec, { velocity: v.vs, restDelta: REST.scale, speed: sp }),
          );
        }
        return Promise.all(anims);
      }

      const land = zoomOnto(dest, 0, 0);
      it.sLand = land.s;
      if (m.metrics) it.srcFit = fitOf(m.metrics, dest);
      // Each card fades only in the smallest quarter of its range, so it never pops.
      const cardOpacity = (s: number) => cv.o.set(clamp(((s - it.sLand) / (1 - it.sLand)) * 4, 0, 1));
      if (!it.offOpacity) it.offOpacity = cv.s.on("change", cardOpacity);
      cardOpacity(cv.s.get());
      const wasLanded = it.landed;
      it.landed = false;
      src.el.dataset.zoomHidden = "";

      const to = target === "sources" ? { x: land.left - P.x, y: land.top - P.y, s: land.s } : { x: 0, y: 0, s: 1 };
      // For gestures whose motion was only a preview (a wheel pull), keep the speed
      // only where it already heads toward the target; carrying it the other way
      // makes the card visibly lurch before turning round.
      const toward = (velocity: number, delta: number) => (opts.towardTargetOnly && velocity * delta < 0 ? 0 : velocity);
      const cvx = toward(vx, to.x - cv.x.get());
      const cvy = toward(vy, to.y - cv.y.get());
      const cvs = toward(v.vs, to.s - cv.s.get());
      const anims = [
        springTo(cv.x, to.x, spec, { velocity: cvx, restDelta: restPx, speed: sp }),
        springTo(cv.y, to.y, spec, { velocity: cvy, restDelta: restPx, speed: sp }),
        springTo(cv.s, to.s, spec, { velocity: cvs, restDelta: restScale, speed: sp }),
      ];

      if (hero && off) {
        const heroTarget: Rect =
          target === "sources" ? dest : { x: targetX(index) + it.j * L.step + off.x, y: L.top + off.y, w: off.w, h: off.h };
        if (it.flight) {
          // Already flying: turn it around, keeping its current speed. If it was
          // following the card's scrolling, fold that offset into its position first
          // so switching what it follows doesn't move it.
          const f = it.flight;
          const vcx = f.cx.getVelocity();
          const vcy = f.cy.getVelocity();
          if (it.flightScroll0 !== null) {
            const dy = -(it.flightScrollNow - it.flightScroll0) * zs.get() * cv.s.get();
            if (dy) f.cy.jump(f.cy.get() + dy);
          }
          if (it.flightTrack0 !== null) {
            const dx = (trackX.get() - it.flightTrack0) * zs.get();
            if (dx) f.cx.jump(f.cx.get() + dx);
          }
          it.flightScroll0 = target === "open" ? scrollerOf(id)?.scrollTop ?? 0 : null;
          it.flightScrollNow = it.flightScroll0 ?? 0;
          it.flightTrack0 = target === "open" ? targetX(index) : null;
          f.retarget(heroTarget);
          anims.push(
            springTo(f.cx, f.to.cx, spec, { velocity: vcx, restDelta: restPx, speed: sp }),
            springTo(f.cy, f.to.cy, spec, { velocity: vcy, restDelta: restPx, speed: sp }),
            springTo(f.s, f.to.s, spec, { restDelta: restScale, speed: sp }),
          );
        } else {
          const from = wasLanded ? dest : m.heroRect!;
          startFlight(it, hero, from, heroTarget, m.pre ?? prepareFlight(id, hero), target === "open" ? targetX(index) : null);
          // The hero was moving with its card: its centre's speed follows from the card's.
          const f = it.flight!;
          const fvx = wasLanded ? 0 : toward(cvx + cvs * (off.x + off.w / 2), f.to.cx - f.cx.get());
          const fvy = wasLanded ? 0 : toward(cvy + cvs * (off.y + off.h / 2), f.to.cy - f.cy.get());
          const fvs = wasLanded ? 0 : toward(cvs, f.to.s - f.s.get());
          anims.push(
            springTo(f.cx, f.to.cx, spec, { velocity: fvx, restDelta: restPx, speed: sp }),
            springTo(f.cy, f.to.cy, spec, { velocity: fvy, restDelta: restPx, speed: sp }),
            springTo(f.s, f.to.s, spec, { velocity: fvs, restDelta: restScale, speed: sp }),
          );
        }
      }

      return Promise.all(anims).then(() => {
        if (gen !== S.gen || target !== "sources") return;
        // Landed: the real source takes over from this item's card and flight.
        it.offOpacity?.();
        it.offOpacity = null;
        cv.o.set(0);
        delete src.el.dataset.zoomHidden;
        endFlight(it);
        it.landed = true;
        emit(it, "closed");
      });
    });

    // Dim continues from its current value, driven by the active card.
    S.dimAnchor = { p0: activeProgress(), d0: dimOpacity.get() };
    S.offDim?.();
    S.offDim = getItem(S.ids[index], index).cv.s.on("change", updateDerived);
    updateDerived();

    Promise.all(landings).then(() => {
      if (gen !== S.gen) return;
      if (target === "sources") closeDone();
      else finishReopen();
    });
  };

  const finishReopen = () => {
    // Back to the resting open state.
    S.origin = sources.current.get(S.ids[S.index])?.el ?? null;
    hideForOpen();
    S.ids.forEach((id) => {
      const it = getItem(id, S.ids.indexOf(id));
      endFlight(it);
      it.offOpacity?.();
      it.offOpacity = null;
      it.cv.o.set(1);
      const hero = heroFor(id);
      if (hero) hero.style.visibility = "";
    });
    S.offDim?.();
    S.offDim = null;
    openDone();
  };

  /* -------------------------------------------------------------- close & reopen */

  // Make sure the active source is on screen so its card has somewhere to land.
  // Only scroll when it's actually cut off: an already-visible source is left
  // exactly where the person put it. Scroll snapping is never toggled, because
  // turning it back on makes the browser re-snap and the row jumps after landing.
  // Returns true if anything scrolled (the caller then waits a frame to measure).
  const revealSource = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    let hidden = r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight;
    for (let p = el.parentElement; p && !hidden; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const scrolls = /(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY);
      if (!scrolls || (p.scrollWidth <= p.clientWidth && p.scrollHeight <= p.clientHeight)) continue;
      const b = p.getBoundingClientRect();
      const left = b.left + p.clientLeft;
      const top = b.top + p.clientTop;
      hidden = r.left < left - 0.5 || r.top < top - 0.5 || r.right > left + p.clientWidth + 0.5 || r.bottom > top + p.clientHeight + 0.5;
    }
    if (!hidden) return false;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" as ScrollBehavior });
    return true;
  };

  /** Close from open, or turn an opening around. */
  const close = useCallback((v?: ZoomVelocity, closeOpts: { towardTargetOnly?: boolean } = {}) => {
    if (S.phase !== "open" && S.phase !== "opening") return;
    const interrupted = S.phase === "opening";
    leaveHistory();
    // Read (and scroll, if needed) before writing anything, so the browser only
    // recalculates styles once at the moment of release.
    const active = sources.current.get(S.ids[S.index]);
    const scrolled = !S.reduced && active ? revealSource(active.el) : false;
    setPhase("closing");
    emitAll("closing", interrupted);
    setBackgroundInert(false); // so tapping a source can turn the close around
    const gen = ++S.gen;

    if (S.reduced) {
      setGroupHidden(false);
      springTo(fade, 0, timing().fadeOut, { restDelta: REST.opacity, speed: speed() }).then(() => gen === S.gen && closeDone());
      return;
    }
    // After a scroll, let snapping and layout settle for a frame before measuring.
    if (scrolled) requestAnimationFrame(() => gen === S.gen && transitionCards("sources", S.index, v, closeOpts));
    else transitionCards("sources", S.index, v, closeOpts);
  }, []);

  /** Turn a close around: every card heads back to open, with `id` as the visible one. */
  const reopen = (id: string) => {
    if (S.phase !== "closing") return;
    const j = S.ids.indexOf(id);
    if (j < 0) return;
    setPhase("opening");
    setBackgroundInert(true);
    if (j !== S.index) setIndex(j);
    pushEntry(id);
    emitAll("opening", true);
    if (S.reduced) {
      const gen = ++S.gen;
      springTo(fade, 1, timing().fade, { restDelta: REST.opacity, speed: speed() }).then(() => {
        if (gen !== S.gen) return;
        hideForOpen();
        openDone();
      });
      return;
    }
    transitionCards("open", j);
  };

  const closeDone = () => {
    S.ids.forEach((id, j) => {
      const it = getItem(id, j);
      if (!it.landed) emit(it, "closed");
    });
    const focusTarget = sources.current.get(S.ids[S.index])?.el ?? null;
    items.current.forEach(resetItem);
    S.ids.forEach((id) => {
      const el = sources.current.get(id)?.el;
      if (el) delete el.dataset.zoomHidden;
    });
    setBackgroundInert(false);
    if (fixed) document.documentElement.style.overflow = S.scrollLock;
    S.offDim?.();
    S.offDim = null;
    S.mode = "zoom";
    S.origin = null;
    setPhase("idle");
    delete rootRef.current!.dataset.open;
    zx.jump(0);
    zy.jump(0);
    zs.jump(1);
    zoomOpacity.jump(1);
    dimOpacity.jump(0);
    setSession(null);
    const focusable = focusTarget?.closest<HTMLElement>("button, a[href], [tabindex]") ?? focusTarget;
    focusable?.focus({ preventScroll: true });
  };

  /* -------------------------------------------------------------- wiring */

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const gestures = attachGestures(root, {
      phase: () => S.phase,
      dismiss,
      speed,
      count: () => S.ids.length,
      index: () => S.index,
      layout: () => S.L!,
      activeCard: () => cardEls.current.get(S.ids[S.index]) ?? null,
      activeScroller: () =>
        cardEls.current.get(S.ids[S.index])?.querySelector<HTMLElement>(".zoom-card-scroll") ?? null,
      trackX,
      zx,
      zy,
      zs,
      targetX,
      setIndex,
      page,
      settlePage: (i, velocity) => springTo(trackX, targetX(i), timing().page, { velocity, speed: speed() }),
      close: (v, opts) => close(v, opts),
      reopen,
      cancelDismiss: (v) => {
        const T = timing();
        springTo(zx, 0, T.cancel, { velocity: v.vx, speed: speed() });
        springTo(zy, 0, T.cancel, { velocity: v.vy, speed: speed() });
        springTo(zs, 1, T.cancel, { velocity: v.vs, restDelta: REST.scale, speed: speed() });
      },
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (S.phase === "open" || S.phase === "opening")) {
        e.preventDefault();
        close();
        return;
      }
      if (S.phase !== "open" && S.phase !== "opening") return; // arrows can interrupt an opening
      if (e.key === "ArrowRight") {
        e.preventDefault();
        page(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        page(-1);
      }
    };
    gesturesRef.current = gestures;
    window.addEventListener("keydown", onKey);
    // Scrolling during a transition:
    // - inside a card while its hero is still flying in: the flight follows (see startFlight);
    // - the page while cards are flying home: their sources moved, so re-aim them,
    //   keeping their current speed. Once per frame at most.
    let reaim = 0;
    const onAnyScroll = (e: Event) => {
      items.current.forEach((it) => {
        if (!it.flight || it.flightScroll0 === null) return;
        it.flightScrollNow = scrollerOf(it.id)?.scrollTop ?? it.flightScrollNow;
        it.flight.invalidate();
      });
      if (S.phase !== "closing" || S.mode !== "cards" || S.reduced) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      if (reaim) return;
      reaim = requestAnimationFrame(() => {
        reaim = 0;
        if (S.phase === "closing" && S.mode === "cards") transitionCards("sources", S.index);
      });
    };
    document.addEventListener("scroll", onAnyScroll, { capture: true, passive: true });
    // Back and Forward.
    const onPop = (e: PopStateEvent) => {
      if (!historyOption()) return;
      if (S.ignorePops > 0) {
        S.ignorePops -= 1;
        if (S.ignorePops === 0 && S.pendingPush) {
          const id = S.pendingPush;
          S.pendingPush = null;
          pushEntry(id);
        }
        return;
      }
      const state = e.state && typeof e.state === "object" && "zoom" in e.state ? (e.state as { zoom: string; depth: number }) : null;
      S.fromPop = true;
      try {
        if (!state) {
          S.histDepth = 0;
          if (S.phase === "open" || S.phase === "opening") close();
        } else {
          S.histDepth = state.depth;
          if (S.phase === "idle") open(state.zoom);
          else if (S.phase === "closing") reopen(state.zoom);
          else if (S.phase === "open") {
            const j = S.ids.indexOf(state.zoom);
            if (j >= 0 && j !== S.index) page(j - S.index);
          }
        }
      } finally {
        S.fromPop = false;
      }
    };
    window.addEventListener("popstate", onPop);
    const ro = new ResizeObserver(() => {
      if (S.phase !== "open") return;
      S.L = computeLayout();
      setLayout(S.L);
      trackX.jump(targetX(S.index));
    });
    ro.observe(root);
    return () => {
      gestures.detach();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("scroll", onAnyScroll, { capture: true });
      cancelAnimationFrame(reaim);
      ro.disconnect();
    };
  }, [host]);

  // Plain-HTML sources (e.g. static Astro markup).
  useEffect(() => {
    const scan = latest.current.scan;
    if (!scan || !host) return;
    const selector = scan === true ? "[data-zoom-source]" : scan;
    const cleanups = [...document.querySelectorAll<HTMLElement>(selector)].map((el) => {
      const id = el.dataset.zoomSource;
      if (!id) return () => {};
      const unregister = register({ id, group: el.dataset.zoomGroup ?? "default", el });
      const trigger = el.closest<HTMLElement>("a, button") ?? el;
      const onClick = (e: MouseEvent) => {
        // Let modified clicks through so a link can still open in a new tab.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(id);
      };
      trigger.addEventListener("click", onClick);
      return () => {
        unregister();
        trigger.removeEventListener("click", onClick);
      };
    });
    return () => cleanups.forEach((c) => c());
  }, [host]);

  const api = useMemo(() => ({ open, close: () => close(), register, isOpen: !!session }), [open, close, register, session]);

  const closeLabel = props.closeLabel ?? "Close";
  const cardContext = (id: string, j: number, active: boolean): CardContextValue => ({
    id,
    index: j,
    active,
    setHero: (el) => {
      if (el) heroes.current.set(id, el);
      else heroes.current.delete(id);
    },
    setHeroContent: (content) => {
      if (content) heroContent.current.set(id, content);
      else heroContent.current.delete(id);
    },
    close: () => close(),
  });
  const renderClose = () => {
    const option = props.closeButton ?? true;
    if (option === false) return null;
    if (typeof option === "function") return option(() => close());
    return (
      <button type="button" className="zoom-close" data-zoom-close aria-label={closeLabel}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    );
  };
  const overlay =
    host &&
    createPortal(
      <div ref={rootRef} className={fixed ? "zoom-root zoom-fixed" : "zoom-root"} role="dialog" aria-modal="true">
        <motion.div ref={dimRef} className="zoom-dim" style={{ opacity: dimOpacity }} />
        <motion.div ref={zoomerRef} className="zoom-zoomer" style={{ x: zx, y: zy, scale: zs, opacity: zoomOpacity }}>
          {session && layout && (
            <motion.div key={session.key} className="zoom-track" style={{ x: trackX }}>
              {session.ids.map((id, j) => {
                const v = getItem(id, j).cv;
                const active = j === index;
                return (
                  <motion.article
                    key={id}
                    ref={(el: HTMLElement | null) => {
                      if (el) cardEls.current.set(id, el);
                      else cardEls.current.delete(id);
                    }}
                    className="zoom-card"
                    data-zoom-id={id}
                    aria-label={props.getLabel?.(id)}
                    inert={!active}
                    style={{
                      left: j * layout.step,
                      top: layout.top,
                      width: layout.cardW,
                      height: layout.cardH,
                      x: v.x,
                      y: v.y,
                      scale: v.s,
                      opacity: v.o,
                    }}
                  >
                    <ZoomCardContext.Provider value={cardContext(id, j, active)}>
                      <ZoomHeroContext.Provider
                        value={{ progress: getItem(id, j).progress, focus: getItem(id, j).focus, phase: phaseMV, inFlight: false, item: getItem(id, j).api }}
                      >
                        <div className="zoom-card-scroll">
                          <div className="zoom-card-content">
                            {/* Inside the scrolled content (and sticky), so it rides the
                                browser's overscroll bounce with the rest of the card. */}
                            <div className="zoom-close-bar">{renderClose()}</div>
                            {props.renderDestination(id)}
                            {props.debug && <EdgeZones slop={dismiss().wheelEdgeSlop} />}
                          </div>
                        </div>
                      </ZoomHeroContext.Provider>
                    </ZoomCardContext.Provider>
                  </motion.article>
                );
              })}
            </motion.div>
          )}
        </motion.div>
        <div ref={flightRef} className="zoom-flight" />
        {/* Live heroes: the hero's own React content, rendered into its flying copy so
            it can keep animating in flight (driven by the same progress as the card). */}
        <LiveFlights
          handleRef={liveFlights}
          render={(id, { host: liveHost, flight, key }) => {
          const j = S.ids.indexOf(id);
          return createPortal(
            <ZoomCardContext.Provider value={cardContext(id, j, j === S.index)}>
              <ZoomHeroContext.Provider
                value={{ progress: getItem(id, j).progress, focus: getItem(id, j).focus, phase: phaseMV, inFlight: true, item: getItem(id, j).api }}
              >
                <LiveMount onMount={flight.dropSnapshot}>{heroContent.current.get(id)?.children}</LiveMount>
              </ZoomHeroContext.Provider>
            </ZoomCardContext.Provider>,
            liveHost,
            `${id}-${key}`,
          );
          }}
        />
        <div className="zoom-sr" aria-live="polite">
          {announce}
        </div>
      </div>,
      host,
    );

  return (
    <ZoomContext.Provider value={api}>
      {props.children}
      {overlay}
    </ZoomContext.Provider>
  );
}
