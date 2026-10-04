import {
  Fragment,
  createContext,
  memo,
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
import { cancelFrame, frame, motion, motionValue, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import { REST, clamp, defaultTiming, springTo, type ZoomTiming } from "./springs";
import { createFlight, measureHero, prepareSnapshot, radiusOf, snapshotOf, type Flight, type HeroMetrics, type Rect } from "./flight";
import { attachGestures, type DismissEdges, type GestureDismiss, type GesturePaging, type ZoomVelocity } from "./gestures";

/* ------------------------------------------------------------------ types */

export type ZoomGeometry = {
  /** Minimum gap between a card and the left/right edges (neighbours peek through it in a horizontal pager). */
  side: number;
  /** Space between cards. */
  gap: number;
  /** Space above and below the card (neighbours peek through it in a vertical pager). */
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

/**
 * Which edges of a card a gesture can close it from. true or "both": top and bottom;
 * false: neither; "top" / "bottom": only that one. As an object, an edge left out
 * keeps its default (top on, bottom off), so { bottom: true } turns on both.
 */
export type ZoomEdges = boolean | "top" | "bottom" | "both" | { top?: boolean; bottom?: boolean };

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
  /**
   * Close by dragging (touch, or a mouse drag) down from the card's top or up from its
   * bottom. Default: top only. Add the bottom with { bottom: true }.
   */
  drag: ZoomEdges;
  /**
   * Close by scrolling (mouse wheel or trackpad) past the card's top or bottom.
   * Default: top only. Add the bottom with { bottom: true }.
   */
  wheel: ZoomEdges;
  /**
   * Vertical layouts (feed, stream): also close by scrolling sideways with a trackpad
   * or a tilting wheel. Off by default: trackpad swipes mix sideways and vertical
   * motion, and momentum, too unevenly for it to feel dependable. A sideways touch or
   * mouse drag closes either way.
   */
  wheelSideways: boolean;
  /** How far (in px of scrolling) past the edge closes the card. */
  wheelDistance: number;
  /** A swipe that starts with the content within this many px of an edge can close the card. */
  wheelEdgeSlop: number;
};

/** Edges a gesture closes from unless told otherwise: pulling down from the top only.
 *  Pulling up from the bottom is off: it's easy to do by accident at the end of a
 *  long read, and on phones it competes with the home indicator. */
const DEFAULT_EDGES: DismissEdges = { top: true, bottom: false };

/** Normalises every way of writing ZoomEdges to one flag per edge. */
const resolveEdges = (e: ZoomEdges | undefined): DismissEdges => {
  if (e === undefined) return DEFAULT_EDGES;
  if (e === true || e === "both") return { top: true, bottom: true };
  if (e === false) return { top: false, bottom: false };
  if (e === "top") return { top: true, bottom: false };
  if (e === "bottom") return { top: false, bottom: true };
  return { top: e.top ?? DEFAULT_EDGES.top, bottom: e.bottom ?? DEFAULT_EDGES.bottom };
};

/** How swiping between a group's cards feels. */
export type ZoomPaging = {
  /** Trackpad or mouse wheel: how far (px) a swipe travels before it turns the page. */
  swipeDistance: number;
  /**
   * Vertical pager: what scrolling into the top or bottom of a card's content does.
   * "new-swipe" (default): it stops there, and a new swipe turns the page, so a long
   * read can't fly past its end. "continue": it turns the page straight away and the
   * swipe carries on into the next card's content, so the cards read as one stream.
   */
  atEdge: "new-swipe" | "continue";
};
const defaultPaging: GesturePaging = { swipeDistance: 40, atEdge: "new-swipe" };

const defaultLanding: ZoomLanding = { widthRatio: 1, topOffset: 0 };
const defaultDismiss: ZoomDismiss = {
  distance: 130,
  velocity: 650,
  minDistance: 24,
  pivotY: 0.3,
  maxShrink: 0.4,
  dimFade: 0.65,
  drag: DEFAULT_EDGES,
  wheel: DEFAULT_EDGES,
  wheelSideways: false,
  wheelDistance: 240,
  wheelEdgeSlop: 32,
};

export type ZoomProviderProps = {
  /** Optional: with scan, the sources can be the page's own markup instead. */
  children?: ReactNode;
  /** The destination for a source: any React content. Mark its shared element with <ZoomHero>. */
  renderDestination: (id: string) => ReactNode;
  /** Element the overlay is portalled into (must be positioned). Defaults to document.body, over the viewport. */
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
  /**
   * Swipe between the items of a group. When false, only the opened item gets a card.
   * Default true; pass options to tune it (how fast a page turn settles is timing.page).
   */
  paging?: boolean | Partial<ZoomPaging>;
  /**
   * Which way the cards of a group are laid out and swiped through.
   * - "horizontal" (default): side by side; swipe sideways to page, pull down to close.
   * - "vertical": stacked like a feed; swipe or scroll up and down to page, and drag or
   *   scroll a card sideways (either way) to close. Up/Down arrows page. The card's own
   *   content still scrolls first; paging takes over at its top and bottom.
   */
  orientation?: "horizontal" | "vertical";
  /**
   * How a group's cards are arranged while open.
   * - "pager" (default): one card per page, each the height of the screen; swipe to
   *   page (see orientation).
   * - "stream": one continuous column, each card as tall as its content, scrolled
   *   natively like a document. No paging: the visible card is whichever sits under
   *   the top third of the screen, and that's the one that flies home on close.
   *   Close with the close button (it stays in view), Escape, or by dragging or
   *   scrolling sideways.
   */
  layout?: "pager" | "stream";
  /** While open, hide every item of the group on the page (not just the visible one), so
   *  nothing shows twice in the gaps between cards. Default true. */
  hideGroupWhileOpen?: boolean;
  /**
   * While open, keep the group's other items on the page at this opacity instead of
   * hiding them; only the visible item's own source is hidden. They follow the
   * visible card: dimming as it opens, and back to full as it closes and lands.
   * Takes precedence over hideGroupWhileOpen.
   */
  groupOpacity?: number;
  /**
   * Which cards fly back to their sources when the zoom closes.
   * - "group" (default): every card in the group flies home to its own source.
   * - "visible": only the visible card does. The others stay where they are and fade
   *   out with it (and fade in with it when it opens), for a calmer close.
   */
  flyHome?: "group" | "visible";
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
  /**
   * Stream: the title shown above the first card of each section (sources give theirs
   * with data-zoom-section, or ZoomSource's section prop). Defaults to the section's
   * name in an h2.zoom-stream-title; style that like the page's own section titles.
   */
  renderSectionTitle?: (section: string) => ReactNode;
  /**
   * Keeping the page behind on the piece being read, so a close lands where the reader
   * is, not where they started. The source is scrolled into view, centred, only when it's
   * out of view:
   * - "close" (default): the moment a close starts.
   * - "read": each time the visible piece changes while open, so nothing moves at close.
   *   For a backdrop the page can't be seen through (opaque, or heavily blurred).
   * - false: never.
   */
  revealSource?: "close" | "read" | false;
  /** Draw tuning aids: the wheel-dismiss edge zones in each card. */
  debug?: boolean;
  /** Accessible name for each destination card. */
  getLabel?: (id: string) => string;
  closeLabel?: string;
};

type Phase = "idle" | "opening" | "open" | "closing";
type Layout = {
  W: number;
  H: number;
  side: number;
  gap: number;
  cardW: number;
  /** Distance from one card to the next along the paging axis. */
  step: number;
  top: number;
  cardH: number;
  /** Cards are stacked top to bottom and the track moves vertically. */
  vertical: boolean;
  /** One natively scrolled column of content-height cards (implies vertical). */
  stream: boolean;
};
type SourceEntry = { id: string; group: string; el: HTMLElement; section?: string };
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
  /** Stream: how much of the close button its card's scrolling leaves visible (0 to 1). */
  barScroll: number;
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

/** Debug: the bands of content within wheelEdgeSlop of the top and bottom. If any of a
 *  band is on screen, a swipe toward that edge can close the card. Only edges that
 *  wheel dismissal is enabled for are drawn. */
function EdgeZones({ slop, edges }: { slop: number; edges: DismissEdges }) {
  return (
    <>
      {edges.top && (
        <div className="zoom-debug-edge zoom-debug-top" style={{ height: slop }} aria-hidden="true">
          <span>edge zone {slop}px</span>
        </div>
      )}
      {edges.bottom && (
        <div className="zoom-debug-edge zoom-debug-bottom" style={{ height: slop }} aria-hidden="true">
          <span>edge zone {slop}px</span>
        </div>
      )}
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

/** Swaps the flight's snapshot for the live content as soon as it has rendered. */
function LiveMount({ onMount, children }: { onMount: () => void; children: ReactNode }) {
  useLayoutEffect(onMount, []);
  return <>{children}</>;
}

function CloseButton({ option, label, close }: { option: ZoomProviderProps["closeButton"]; label: string; close: () => void }) {
  if (option === false) return null;
  if (typeof option === "function") return <>{option(close)}</>;
  return (
    <button type="button" className="zoom-close" data-zoom-close aria-label={label}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  );
}

type ZoomCardProps = {
  id: string;
  j: number;
  active: boolean;
  layout: Layout;
  item: Item;
  phase: MotionValue<Phase>;
  label: string | undefined;
  renderDestination: (id: string) => ReactNode;
  closeButton: ZoomProviderProps["closeButton"];
  closeLabel: string;
  close: (id?: string) => void;
  /** Debug edge zones, when drawn. */
  zones: { slop: number; edges: DismissEdges } | null;
  makeContext: (id: string, j: number, active: boolean) => CardContextValue;
  setCardEl: (id: string, el: HTMLElement | null) => void;
  /** Stream: the card's section, and whether it starts or ends it (for styling joins).
   *  Plain values, so the memo still holds. */
  section?: string;
  sectionStart?: boolean;
  sectionEnd?: boolean;
};
/**
 * One page of the pager. Memoised, so paging (which changes which card is active)
 * re-renders only the two cards whose active state changed, not every destination
 * in the group.
 */
const ZoomCard = memo(function ZoomCard({
  id,
  j,
  active,
  layout,
  item,
  phase,
  label,
  renderDestination,
  closeButton,
  closeLabel,
  close,
  zones,
  makeContext,
  setCardEl,
  section,
  sectionStart,
  sectionEnd,
}: ZoomCardProps) {
  const cardContext = useMemo(() => makeContext(id, j, active), [makeContext, id, j, active]);
  const heroContext = useMemo(
    () => ({ progress: item.progress, focus: item.focus, phase, inFlight: false, item: item.api }),
    [item, phase],
  );
  const ref = useCallback((el: HTMLElement | null) => setCardEl(id, el), [setCardEl, id]);
  const closeThis = useCallback(() => close(id), [close, id]);
  const v = item.cv;
  return (
    <motion.article
      ref={ref}
      className="zoom-card"
      data-zoom-id={id}
      data-zoom-section={section}
      data-zoom-section-start={sectionStart ? "" : undefined}
      data-zoom-section-end={sectionEnd ? "" : undefined}
      aria-label={label}
      inert={!active && !layout.stream}
      tabIndex={-1}
      style={{
        // In a stream, cards sit in the column's own flow at their content's height.
        ...(layout.stream
          ? {}
          : {
              left: layout.vertical ? layout.side : j * layout.step,
              top: layout.vertical ? j * layout.step : layout.top,
              height: layout.cardH,
            }),
        width: layout.cardW,
        x: v.x,
        y: v.y,
        scale: v.s,
        opacity: v.o,
      }}
    >
      <ZoomCardContext.Provider value={cardContext}>
        <ZoomHeroContext.Provider value={heroContext}>
          <div className="zoom-card-scroll">
            <div className="zoom-card-content">
              {/* Inside the scrolled content (and sticky), so it rides the
                  browser's overscroll bounce with the rest of the card. */}
              <div className="zoom-close-bar">
                <CloseButton option={closeButton} label={closeLabel} close={closeThis} />
              </div>
              {renderDestination(id)}
              {zones && <EdgeZones slop={zones.slop} edges={zones.edges} />}
            </div>
          </div>
        </ZoomHeroContext.Provider>
      </ZoomCardContext.Provider>
    </motion.article>
  );
});

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
  /** Each card's close bar, looked up once (null: a custom close button without one). */
  const closeBars = useRef(new WeakMap<HTMLElement, HTMLElement | null>()).current;
  const rootRef = useRef<HTMLDivElement>(null);
  const zoomerRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

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
    /** The next open is already open: the page loaded at an item's address. */
    instant: false,
    /** The page's scrollRestoration, while our own Back is set to manual. */
    restoration: null as ScrollRestoration | null,
    /** The item the page's address named when it loaded, until its source registers. */
    addressed: null as string | null,
    /** popstate events caused by our own history.go(), to be ignored. */
    ignorePops: 0,
    /** An entry to add once our own pending history.go() has landed. */
    pendingPush: null as string | null,
    /** True while reacting to Back/Forward, so we don't write history back. */
    fromPop: false,
    /** The page's own overflow and scrollbar-gutter styles while we lock scrolling. */
    scrollLock: null as { overflow: string; gutter: string } | null,
    /**
     * How far the page has moved under the overlay at once during a close (a host
     * re-laying it out, the viewport changing size), applied to the overlay's moving
     * layers so nothing jumps on screen. rel() works in the shifted frame.
     */
    shift: { x: 0, y: 0 },
    /** While closing: a source on the page, and where it was last seen (viewport px). */
    pageRef: null as { el: HTMLElement; left: number; top: number; vw: number; vh: number } | null,
    sessionKey: 0,
    /** Portalled into document.body, over the viewport (no container given). */
    fixed: false,
    /** groupOpacity for this session (null: the group is hidden or shown as hideGroupWhileOpen says). */
    groupOpacity: null as number | null,
    /** flyHome is "visible" for this session: the other cards fade with the visible one. */
    flyVisible: false,
    /** groupOpacity: the index of the item whose source is hidden on the page. */
    hiddenAt: 0,
    /** The last input was the keyboard (not a pointer): decides where focus goes. */
    keyboard: false,
  }).current;

  // The shared zoom: the whole pager (card, metadata, neighbours) scales together.
  const track = useMotionValue(0);
  const zx = useMotionValue(0);
  const zy = useMotionValue(0);
  const zs = useMotionValue(1);
  const zoomOpacity = useMotionValue(1);
  const dimOpacity = useMotionValue(0);
  /** The backdrop filter's layer: the dim's share of full strength (0 to 1), so a light
   *  dim still gets a complete blur. */
  const backdropOpacity = useMotionValue(0);
  const fade = useMotionValue(0); // reduced motion only
  /** Stream section titles: they fade in and out with the neighbouring cards. */
  const extrasOpacity = useMotionValue(1);

  const timing = (): ZoomTiming => ({ ...defaultTiming, ...latest.current.timing });
  const landing = (): ZoomLanding => ({ ...defaultLanding, ...latest.current.landing });
  // Read on every pointer and wheel event, so it's resolved once per `dismiss` prop
  // rather than rebuilt each time.
  const dismissCache = useRef<{ input: Partial<ZoomDismiss> | undefined; value: GestureDismiss } | null>(null);
  const dismiss = (): GestureDismiss => {
    const input = latest.current.dismiss;
    const cached = dismissCache.current;
    if (cached && cached.input === input) return cached.value;
    const d = { ...defaultDismiss, ...input };
    const value = { ...d, drag: resolveEdges(d.drag), wheel: resolveEdges(d.wheel) };
    dismissCache.current = { input, value };
    return value;
  };
  const speed = () => latest.current.timeScale ?? 1;

  // Resolved in a passive effect: by then every ref in the tree, including a
  // container that wraps this provider, has been attached.
  useEffect(() => {
    const c = latest.current.container;
    setHost(c ? c() : document.body);
  }, []);
  const fixed = host === document.body;
  // Mirrored into S: close() and friends are created once (useCallback with no deps),
  // so they must not read `fixed` from the render they were created in.
  S.fixed = fixed;

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
        barScroll: 1,
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
      cv.o.on("change", () => {
        updateProgress(self);
        writeBar(self);
      });
    }
    it.j = j;
    return it;
  };
  /**
   * The close bar's opacity: with its card (written on the bar itself, since the bar is
   * sticky and Safari can draw a sticky layer without its ancestors' opacity; where the
   * card's opacity does reach it, it leaves a little ahead) and, in a stream, as its card
   * scrolls away. While a card opens or closes the button itself is hidden by zoom.css and
   * fades in once it has landed (it sits on the hero's corner, under the flying copy).
   */
  function writeBar(it: Item) {
    const card = cardEls.current.get(it.id);
    if (!card) return;
    let bar = closeBars.get(card);
    if (bar === undefined) {
      bar = card.querySelector<HTMLElement>(".zoom-close-bar");
      closeBars.set(card, bar);
    }
    if (!bar) return;
    const o = it.barScroll * clamp(it.cv.o.get(), 0, 1);
    bar.style.opacity = o >= 0.999 ? "" : String(o);
    bar.style.pointerEvents = o < 0.5 ? "none" : "";
  }
  const resetItem = (it: Item) => {
    it.values.forEach((v) => v.mv.jump(v.initial));
    endFlight(it);
    it.srcFit = NaN;
    it.offOpacity?.();
    it.offOpacity = null;
    it.landed = false;
    it.sLand = NaN;
    it.barScroll = 1;
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
    holdScroll();
    window.history.pushState({ zoom: id, depth: S.histDepth }, "", urlFor(id));
  };
  /**
   * Going Back to the page (ours on close, or the browser's), the browser would restore
   * the scroll position it saved for the page's entry, where the reader opened from,
   * undoing the scroll to the source the close makes. The setting belongs to each entry
   * (a pushed one inherits it), so it's set to manual on the page's entry before the first
   * push, and put back once the close has landed.
   */
  const holdScroll = () => {
    if (S.restoration !== null) return;
    S.restoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
  };
  const releaseRestoration = () => {
    if (S.restoration === null || (window.history.state && typeof window.history.state === "object" && "zoom" in window.history.state)) return;
    window.history.scrollRestoration = S.restoration;
    S.restoration = null;
  };
  /**
   * The visible item changed: a new entry ("item" mode) or just a new address ("session"
   * mode). Scrolling a stream only ever updates the address: an entry per piece
   * scrolled past would make Back crawl.
   */
  const recordPage = (id: string, replace = false) => {
    const h = historyOption();
    if (!h || S.fromPop || S.histDepth === 0) return;
    if (h.mode === "item" && !replace) {
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
    const cardH = H - geo.top - geo.bottom;
    const stream = latest.current.layout === "stream";
    const vertical = stream || latest.current.orientation === "vertical";
    return { W, H, side, gap: geo.gap, cardW, step: (vertical ? cardH : cardW) + geo.gap, top: geo.top, cardH, vertical, stream };
  };
  /** Where the track sits when page i is the visible one. */
  const trackAt = (i: number) => (S.L!.stream ? 0 : (S.L!.vertical ? S.L!.top : S.L!.side) - i * S.L!.step);
  /** Card j's untransformed top-left, in the root, with the track at `t`. */
  const slot = (j: number, t = track.get()) => {
    const L = S.L!;
    if (L.stream) {
      // Where the column's flow puts it, less how far the column is scrolled.
      const card = cardEls.current.get(S.ids[j]);
      const sc = streamRef.current;
      return { x: card?.offsetLeft ?? L.side, y: (card?.offsetTop ?? 0) - (sc?.scrollTop ?? 0) };
    }
    return L.vertical ? { x: L.side, y: t + j * L.step } : { x: t + j * L.step, y: L.top };
  };
  /** Stream: scroll the column so card j's top sits at the layout's top (as far as it can). */
  const scrollStreamTo = (j: number, smooth = false) => {
    const sc = streamRef.current;
    const card = cardEls.current.get(S.ids[j]);
    if (!sc || !card) return;
    // A card that starts a section opens with its section's title in view above it.
    const title = card.previousElementSibling as HTMLElement | null;
    const from = title?.hasAttribute("data-zoom-section-title") ? title.offsetTop : card.offsetTop;
    const top = Math.max(0, from - S.L!.top);
    if (smooth) sc.scrollTo({ top, behavior: "smooth" });
    else sc.scrollTop = top;
  };
  /** A movement of the track, as screen x/y. */
  const alongTrack = (d: number) => (S.L!.vertical ? { x: 0, y: d } : { x: d, y: 0 });
  const rel = (r: DOMRect, root: DOMRect = rootRef.current!.getBoundingClientRect()): Rect => ({
    x: r.left - root.left - S.shift.x,
    y: r.top - root.top - S.shift.y,
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
    const x = track.get();
    S.ids.forEach((id, j) => {
      const d = Math.abs(x - trackAt(j)) / S.L!.step;
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
  const scrollerOf = (id: string) =>
    S.L?.stream ? streamRef.current : cardEls.current.get(id)?.querySelector<HTMLElement>(".zoom-card-scroll") ?? null;
  function startFlight(
    it: Item,
    hero: HTMLElement,
    from: Rect,
    to: Rect,
    pre: ReturnType<typeof prepareFlight>,
    /** Heading into the card: the track position its landing spot was worked out for. */
    toCardTrack: number | null = null,
    /** Corner radius (on-screen px) where it takes off and where it lands. */
    radii?: { from: number; to: number },
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
        const paged = alongTrack(it.flightTrack0 === null ? 0 : (track.get() - it.flightTrack0) * zs.get());
        const y = it.flightScroll0 === null ? 0 : -(it.flightScrollNow - it.flightScroll0) * zs.get() * it.cv.s.get();
        return { x: paged.x, y: paged.y + y };
      },
      // The hero's shadow belongs to it in the card, not on the source: it fades in as
      // the card opens and out as it closes, following the item's progress.
      shadowOpacity: () => it.progress.get(),
      radii,
      // Once it's following scrolled content, the copy is part of that content: hide
      // whatever has scrolled past the card's top or bottom edge, like the rest of it.
      clip: () => {
        if (it.flightScroll0 === null || it.flightScrollNow === it.flightScroll0 || !S.L) return null;
        if (S.L.stream) return { top: zy.get(), bottom: zy.get() + zs.get() * S.L.H };
        const top = zy.get() + zs.get() * (slot(it.j).y + it.cv.y.get());
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

  /** The dim's share of full strength while open: dragging a card fades some of it. */
  const restingShare = () => {
    const d = dismiss();
    return 1 - clamp((1 - zs.get()) / d.maxShrink, 0, 1) * d.dimFade;
  };
  const restingDim = () => S.dimMax * restingShare();
  /** How far the active card is between its source (0) and fully open (1). */
  const activeProgress = () => {
    const it = items.current.get(S.ids[S.index]);
    if (!it) return 1;
    if (!Number.isFinite(it.sLand)) return clamp(it.cv.o.get(), 0, 1);
    return clamp((it.cv.s.get() - it.sLand) / (1 - it.sLand), 0, 1);
  };
  /** The visible card's progress, 0 on its source to 1 open (the fade, with reduced motion). */
  const visibleProgress = () => {
    if (S.reduced) return clamp(fade.get(), 0, 1);
    const it = items.current.get(S.ids[S.index]);
    return it ? clamp(progressOf(it), 0, 1) : 1;
  };
  /**
   * Everything that follows the visible card: the rest of the group on the page (with
   * groupOpacity) and, when only the visible card flies home, the other cards.
   */
  /**
   * groupOpacity: each source's share of the group's opacity. 1 for the rest of the
   * group, 0 for the visible item's own source. When the visible item changes while
   * open (a page turn, or scrolling a stream on to the next piece), the two swap
   * softly instead of one snapping out and the other snapping in.
   */
  const presence = useRef(new Map<string, MotionValue<number>>());
  const presenceOf = (id: string) => {
    let mv = presence.current.get(id);
    if (!mv) {
      mv = motionValue(1);
      presence.current.set(id, mv);
      mv.on("change", () => writeGroupOpacity(id, groupBase()));
    }
    return mv;
  };
  /** The dimmed group's opacity: full on the page, groupOpacity once a card is open. */
  const groupBase = () => (S.groupOpacity === null ? 1 : 1 - (1 - S.groupOpacity) * visibleProgress());
  function writeGroupOpacity(id: string, base: number) {
    if (S.groupOpacity === null || S.phase === "idle") return;
    const el = sources.current.get(id)?.el;
    if (!el || el.dataset.zoomDimmed === undefined) return;
    el.style.setProperty("--zoom-group-opacity", String(base * (presence.current.get(id)?.get() ?? 1)));
  }
  const followVisible = () => {
    if (S.groupOpacity === null && !S.flyVisible) return;
    const p = visibleProgress();
    if (S.groupOpacity !== null) {
      const base = groupBase();
      S.ids.forEach((id) => writeGroupOpacity(id, base));
    }
    if (S.flyVisible && !S.reduced) {
      // Squared, so they're mostly gone before the visible card has shrunk much.
      S.ids.forEach((id, j) => {
        if (j !== S.index) getItem(id, j).cv.o.set(p * p);
      });
      extrasOpacity.set(p * p);
    }
  };
  const updateDerived = () => {
    if (S.phase === "idle") return;
    followVisible();
    if (S.reduced) {
      const f = clamp(fade.get(), 0, 1);
      zoomOpacity.set(f);
      dimOpacity.set(restingDim() * f);
      backdropOpacity.set(restingShare() * f);
    } else if (S.mode === "cards") {
      // Continuous from wherever the dim was when this transition started,
      // heading to full dim when open and to none at the sources.
      const p = activeProgress();
      const { p0, d0 } = S.dimAnchor;
      const d =
        p >= p0 ? (p0 >= 0.999 ? S.dimMax : d0 + ((S.dimMax - d0) * (p - p0)) / (1 - p0)) : p0 <= 0.001 ? 0 : (d0 * p) / p0;
      zoomOpacity.set(1);
      dimOpacity.set(d);
      backdropOpacity.set(S.dimMax > 0 ? clamp(d / S.dimMax, 0, 1) : clamp(p, 0, 1));
    } else if (S.phase === "opening") {
      const t = clamp((zs.get() - S.s0) / (1 - S.s0), 0, 1);
      dimOpacity.set(S.dimMax * t);
      backdropOpacity.set(t);
      // Only the smallest quarter of the zoom fades, so the card never pops in.
      zoomOpacity.set(clamp(t * 4, 0, 1));
    } else {
      zoomOpacity.set(1);
      dimOpacity.set(restingDim());
      backdropOpacity.set(restingShare());
    }
  };
  useEffect(() => {
    const off = [
      zs.on("change", updateDerived),
      zs.on("change", updateAllProgress),
      track.on("change", () =>
        items.current.forEach((it) => {
          if (it.flight && it.flightTrack0 !== null) it.flight.invalidate();
        }),
      ),
      track.on("change", updateAllFocus),
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
    // The page loaded at this item's address: open it once its group has registered too.
    if (entry.id === S.addressed) requestAnimationFrame(() => openAddressed.current());
    return () => {
      if (sources.current.get(entry.id)?.el === entry.el) sources.current.delete(entry.id);
    };
  }, []);

  /** With groupOpacity: the visible item's source hidden, the others dimmed (following followVisible). */
  const markGroup = (hideVisible: boolean) => {
    S.ids.forEach((id, j) => {
      const el = sources.current.get(id)?.el;
      if (!el) return;
      el.dataset.zoomDimmed = "";
      if (j === S.index) {
        // Hidden outright while its card or flight covers it; its share stays 0 after.
        if (hideVisible) el.dataset.zoomHidden = "";
        presenceOf(id).jump(0);
        S.hiddenAt = j;
      } else {
        delete el.dataset.zoomHidden;
        presenceOf(id).jump(1);
      }
    });
  };
  /**
   * The page behind stays exactly as it was while a card is open: changing which piece
   * is visible (a page turn, scrolling a stream on) doesn't touch it, because tiles
   * changing in the background while you read are a distraction. On close the swap
   * happens at once: the visible item's source is hidden (its card is about to land
   * there) and the one hidden since opening comes back with the rest of the group.
   */
  const showHiddenSourceFor = (index: number) => {
    if (S.groupOpacity === null || S.hiddenAt === index) return;
    const was = sources.current.get(S.ids[S.hiddenAt])?.el;
    if (was) delete was.dataset.zoomHidden;
    presenceOf(S.ids[S.hiddenAt]).jump(1);
    const now = sources.current.get(S.ids[index])?.el;
    if (now) {
      now.dataset.zoomDimmed = "";
      now.dataset.zoomHidden = "";
    }
    presenceOf(S.ids[index]).jump(0);
    S.hiddenAt = index;
  };
  const unmarkGroup = (el: HTMLElement) => {
    delete el.dataset.zoomDimmed;
    el.style.removeProperty("--zoom-group-opacity");
  };
  /** While open: hide the group's items on the page, or just the visible one (dimming the rest). */
  const hideForOpen = () => {
    if (S.groupOpacity !== null) {
      markGroup(true);
      followVisible();
    } else if (latest.current.hideGroupWhileOpen === false) {
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

  /**
   * Over the whole page, the overlay is part of the page (zoom.css, .zoom-page): placed
   * over the viewport at the page's scroll position. Its containing block may be offset
   * (a positioned body), so it's measured at the origin first.
   */
  const placeOnPage = () => {
    const root = rootRef.current;
    if (!S.fixed || !root) return;
    const html = document.documentElement;
    Object.assign(root.style, { right: "auto", bottom: "auto", left: "0px", top: "0px", width: `${html.clientWidth}px`, height: `${html.clientHeight}px` });
    const r = root.getBoundingClientRect();
    root.style.left = `${-r.left}px`;
    root.style.top = `${-r.top}px`;
  };

  // Over the whole page, the page behind stops scrolling while open. Where scrollbars
  // take up space (Windows, Linux, some macOS settings), their gutter is kept so the
  // page doesn't reflow sideways, which would also move the sources cards land on.
  const lockScroll = () => {
    if (!S.fixed || S.scrollLock) return;
    const html = document.documentElement;
    const scrollbar = window.innerWidth - html.clientWidth;
    S.scrollLock = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter };
    if (scrollbar > 0) html.style.scrollbarGutter = "stable";
    html.style.overflow = "hidden";
  };
  /**
   * Closing: the page scrolls again as soon as the close starts, not once it's done, so
   * whatever that sets off (a host re-laying out the page, the browser's own toolbars)
   * moves the sources early, while the cards can still re-aim at them (see onAnyScroll
   * and the resize listener), instead of after they've landed. The scrollbar gutter stays
   * reserved until the end, so the page doesn't reflow sideways under the landing cards.
   */
  const releaseScroll = () => {
    if (S.scrollLock) document.documentElement.style.overflow = S.scrollLock.overflow;
  };
  /** Closing: start watching a source, to tell the page moving under the overlay. */
  const watchPage = (el: HTMLElement | null) => {
    if (!el) return (S.pageRef = null);
    // Relative to the overlay: over the whole page it's part of the page, and moves with it.
    const r = el.getBoundingClientRect();
    const o = rootRef.current!.getBoundingClientRect();
    const vv = window.visualViewport;
    S.pageRef = { el, left: r.left - o.left, top: r.top - o.top, vw: vv?.width ?? innerWidth, vh: vv?.height ?? innerHeight };
  };
  const applyShift = () => {
    const t = S.shift.x || S.shift.y ? `${S.shift.x}px ${S.shift.y}px` : "";
    for (const el of [zoomerRef.current, flightRef.current]) if (el) el.style.translate = t;
  };
  const clearShift = () => {
    S.shift = { x: 0, y: 0 };
    S.pageRef = null;
    applyShift();
  };
  /** A close turned back into an open: lock again. */
  const relockScroll = () => {
    if (S.scrollLock) document.documentElement.style.overflow = "hidden";
  };
  const unlockScroll = () => {
    if (!S.scrollLock) return;
    const html = document.documentElement;
    html.style.overflow = S.scrollLock.overflow;
    html.style.scrollbarGutter = S.scrollLock.gutter;
    S.scrollLock = null;
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
    placeOnPage(); // before measuring: the overlay is over the viewport where the page is now
    S.L = computeLayout();
    S.reduced = !!reduceRef.current;
    const d = latest.current.dim;
    S.dimMax = typeof d === "function" ? d() : d ?? 0.35;
    S.groupOpacity = latest.current.groupOpacity ?? null;
    S.flyVisible = latest.current.flyHome === "visible";
    S.pendingOpen = id;
    S.origin = entry.el;
    S.mode = "zoom";
    extrasOpacity.jump(1);
    setPhase("opening");
    startFlightButton();
    ids.forEach((i, j) => resetItem(getItem(i, j)));
    track.jump(trackAt(S.index)); // so the freshly mounted track renders in place
    updateAllFocus();
    setLayout(S.L);
    setIndexState(S.index);
    setSession({ ids, key: ++S.sessionKey });
    pushEntry(id);
  }, []);

  /**
   * A page loaded at an item's address (#id, the default addresses) opens with that item
   * open. The entry becomes the plain page with the item's entry above it, as if it had
   * been tapped, so Back closes it and stays on the page. A custom history url is the
   * item's own page, so there's nothing to open over.
   */
  /** The item the address names (default #id addresses only); `known`: one of ours. */
  const addressedId = (known = true) => {
    const h = historyOption();
    if (!h || h.url || location.hash.length < 2) return null;
    try {
      const id = decodeURIComponent(location.hash.slice(1));
      return !known || sources.current.has(id) ? id : null;
    } catch {
      return null;
    }
  };
  // Opens the item the page loaded at, already open, once its source has registered.
  const openAddressed = useRef(() => {});
  openAddressed.current = () => {
    const id = S.addressed;
    if (!id || S.phase !== "idle" || !sources.current.has(id)) return;
    S.addressed = null;
    window.history.replaceState(null, "", location.pathname + location.search);
    S.instant = true;
    open(id);
  };
  useEffect(() => {
    // Sources may register before this runs (their effects come first) or later.
    S.addressed = addressedId(false);
    const raf = requestAnimationFrame(() => openAddressed.current());
    // The address changed within the page (typed, or a link to #id): open it as a tap
    // would. The browser has already added the entry, so it's adopted, not added again.
    const onHash = () => {
      S.addressed = null;
      const id = addressedId();
      if (!id || S.phase !== "idle") return;
      S.fromPop = true; // no entry of our own
      try {
        open(id);
      } finally {
        S.fromPop = false;
      }
      S.histDepth = 1;
      window.history.replaceState({ zoom: id, depth: 1 }, "", urlFor(id));
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // First open from idle: runs after the cards mount but before they paint.
  useLayoutEffect(() => {
    if (!session || !S.pendingOpen) return;
    const id = S.pendingOpen;
    S.pendingOpen = null;
    const instant = S.instant; // (with reduced motion it fades in as usual)
    S.instant = false;
    const gen = ++S.gen;
    const root = rootRef.current!;
    const zoomer = zoomerRef.current!;
    const L = S.L!;
    const T = timing();
    const sp = speed();

    lockScroll();
    setBackgroundInert(true);
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
      if (S.groupOpacity !== null) markGroup(false); // the others dim with the fade
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

    // A stream opens scrolled to this item's card (as near the top as the column allows).
    if (L.stream) scrollStreamTo(S.index);
    const at = slot(S.index);

    if (instant) {
      // Opened from the address as the page loaded: already open, no flight. The zoom it
      // would have started from is still worked out, for dragging and closing later.
      S.s0 = zoomOnto(rel(S.origin!.getBoundingClientRect()), at.x, at.y).s;
      zx.jump(0);
      zy.jump(0);
      zs.jump(1);
      hideForOpen();
      root.dataset.open = "";
      emitAll("opening");
      openDone();
      return;
    }

    // Measure at full size first, before the zoom is applied (and before any writes).
    const card = cardEls.current.get(id)!;
    const hero = heroFor(id);
    const src = rel(S.origin!.getBoundingClientRect());
    const srcRadius = radiusOf(S.origin!);
    let heroTarget: Rect | null = null;
    const pre = hero ? prepareFlight(id, hero) : null;
    if (hero) {
      const hr = hero.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      heroTarget = { x: at.x + (hr.left - cr.left), y: at.y + (hr.top - cr.top), w: hr.width, h: hr.height };
    }

    const z = zoomOnto(src, at.x, at.y);
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
      const f = startFlight(it, hero, src, heroTarget, pre, trackAt(S.index), { from: srcRadius, to: pre.metrics.ownRadius });
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

  // Stream: the visible card is the one under the top third of the column. Follows the
  // reader's scrolling (once per frame), moving which source is hidden, which card
  // closes, and the address.
  useEffect(() => {
    const sc = streamRef.current;
    if (!session || !sc) return;
    let raf = 0;
    // Each card's close button sticks to the top while its card is in view. As the
    // card scrolls away its bottom edge would cut the button off; instead it fades out
    // over the last CLOSE_FADE px. Everything is read first, then written.
    const CLOSE_FADE = 64;
    const fadeCloseButtons = () => {
      const reads = S.ids.map((id) => {
        const card = cardEls.current.get(id);
        const bar = card?.querySelector<HTMLElement>(".zoom-close-bar");
        const button = bar?.firstElementChild as HTMLElement | null | undefined;
        if (!card || !bar || !button) return null;
        return { bar, room: card.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom };
      });
      reads.forEach((r, j) => {
        if (!r) return;
        const it = getItem(S.ids[j], j);
        it.barScroll = clamp(r.room / CLOSE_FADE, 0, 1);
        writeBar(it);
      });
    };
    const pick = () => {
      raf = 0;
      if (S.phase !== "open") return;
      fadeCloseButtons();
      const box = sc.getBoundingClientRect();
      const line = box.top + box.height / 3;
      let best = S.index;
      S.ids.forEach((id, j) => {
        const r = cardEls.current.get(id)?.getBoundingClientRect();
        if (r && r.top <= line && r.bottom > line) best = j;
      });
      if (best !== S.index) setIndex(best, true);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(pick);
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      sc.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [session, layout?.stream]);

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
    clearShift(); // a close turned around after the page moved (rare): settle in the plain frame
    streamRef.current?.querySelectorAll<HTMLElement>("[data-zoom-section-title]").forEach((el) => (el.style.transform = ""));
    S.mode = "zoom";
    // Drag progress is measured against the visible item's own source.
    const active = items.current.get(S.ids[S.index]);
    if (active && Number.isFinite(active.sLand)) S.s0 = active.sLand;
    setPhase("open");
    endFlightButton(); // the real button shows from this frame
    updateAllProgress();
    emitAll("opened");
    gesturesRef.current?.refresh();
    prefreezeStaticHeroes();
    updateDerived();
    focusCard(S.index);
  };

  /**
   * Focus moves into the open card, so the dialog is where assistive tech and the
   * keyboard are. Keyboard users land on the close button. After a tap or click the
   * card itself takes focus instead: a focused button shows its ring on touch screens
   * (iOS Safari draws it for programmatic focus), which reads as a glitch.
   */
  function focusCard(index: number) {
    const card = cardEls.current.get(S.ids[index]);
    if (!card) return;
    const target = S.keyboard ? card.querySelector<HTMLElement>("[data-zoom-close]") ?? card : card;
    target.focus({ preventScroll: true });
  }

  /* -------------------------------------------------------------- paging */

  /** quiet: the visible card changed because the reader scrolled a stream: no focus move, no announcement. */
  const setIndex = (i: number, quiet = false) => {
    S.refocus = !quiet && !!rootRef.current?.contains(document.activeElement);
    const previous = S.index;
    S.index = i;
    if (previous !== i && (S.phase === "open" || S.phase === "opening")) {
      recordPage(S.ids[i], quiet);
      // revealSource "read": the page behind follows the piece being read.
      const el = latest.current.revealSource === "read" && S.phase === "open" ? sources.current.get(S.ids[i])?.el : null;
      if (el) revealSource(el);
      const prevId = S.ids[previous];
      if (prevId) emit(getItem(prevId, previous), "deactivated");
      emit(getItem(S.ids[i], i), "activated");
    }
    if (S.phase === "open" && latest.current.hideGroupWhileOpen === false && S.groupOpacity === null) hideForOpen();
    if (S.groupOpacity !== null) {
      // While open, the page behind is left alone (see showHiddenSourceFor).
      if (S.phase === "opening") hideForOpen();
    }
    if (S.flyVisible) followVisible();
    setIndexState(i);
    if (quiet) return;
    const label = latest.current.getLabel?.(S.ids[i]) ?? S.ids[i];
    setAnnounce(`${label}, ${i + 1} of ${S.ids.length}`);
  };
  useEffect(() => {
    gesturesRef.current?.refresh();
    if (!S.refocus || S.phase !== "open") return;
    S.refocus = false;
    focusCard(index);
  }, [index]);

  // Also while opening: the cards and the flying hero slide over without restarting.
  const page = (d: number) => {
    if (S.phase !== "open" && S.phase !== "opening") return;
    const i = clamp(S.index + d, 0, S.ids.length - 1);
    if (S.L?.stream) {
      // No pages to turn: bring that card to the top (Back and Forward in "item" history).
      if (i !== S.index) scrollStreamTo(i, !S.reduced);
      return;
    }
    if (i === S.index) {
      // At the end: a small push into the edge, then settle back.
      if (!S.reduced) springTo(track, trackAt(i), timing().page, { velocity: -d * 500, speed: speed() });
      return;
    }
    setIndex(i);
    if (S.reduced) track.jump(trackAt(i));
    else springTo(track, trackAt(i), timing().page, { speed: speed() });
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
    const t = track.get();
    const tv = alongTrack(track.getVelocity());
    track.jump(t);
    const velocities = new Map<string, { vx: number; vy: number; vs: number }>();
    S.ids.forEach((id, j) => {
      const { cv } = getItem(id, j);
      const C = { x: cv.x.get(), y: cv.y.get(), s: cv.s.get(), vx: cv.x.getVelocity(), vy: cv.y.getVelocity(), vs: cv.s.getVelocity() };
      const { x: px, y: py } = slot(j, t);
      cv.x.jump(Z.x + Z.s * (px + C.x) - px);
      cv.y.jump(Z.y + Z.s * (py + C.y) - py);
      cv.s.jump(Z.s * C.s);
      velocities.set(id, {
        vx: Z.vx + Z.vs * (px + C.x) + Z.s * (tv.x + C.vx),
        vy: Z.vy + Z.vs * (py + C.y) + Z.s * (tv.y + C.vy),
        vs: Z.vs * C.s + Z.s * C.vs,
      });
    });
    // Stream section titles aren't cards: hold each where it is on screen by giving it
    // the zoom being folded away (they fade out with the close from there).
    if (L.stream) {
      const sc = streamRef.current;
      sc?.querySelectorAll<HTMLElement>("[data-zoom-section-title]").forEach((el) => {
        const px = el.offsetLeft;
        const py = el.offsetTop - (sc?.scrollTop ?? 0);
        el.style.transformOrigin = "0 0";
        el.style.transform = `translate(${Z.x + Z.s * px - px}px, ${Z.y + Z.s * py - py}px) scale(${Z.s})`;
      });
    }
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
            destRadius: src ? radiusOf(src.el) : 0,
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
    if (target === "open" && Math.abs(track.get() - trackAt(index)) > 0.5) {
      springTo(track, trackAt(index), spec, { speed: sp });
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
      const P = slot(it.j); // the card's untransformed top-left
      const dest = m.dest;

      if (target === "sources" && it.landed) return Promise.resolve(); // already home

      if (S.flyVisible && it.j !== index) {
        // Only the visible card flies. The others stay where they are and fade with it
        // (followVisible), heading back to their places only if the close turns around.
        it.offOpacity?.();
        it.offOpacity = null;
        if (it.flight) {
          endFlight(it);
          if (hero) hero.style.visibility = "";
        }
        if (target === "sources") return Promise.resolve();
        return Promise.all([
          springTo(cv.x, 0, spec, { velocity: vx, speed: sp }),
          springTo(cv.y, 0, spec, { velocity: vy, speed: sp }),
          springTo(cv.s, 1, spec, { velocity: v.vs, restDelta: REST.scale, speed: sp }),
        ]);
      }

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
        const rest = slot(it.j, trackAt(index));
        const heroTarget: Rect = target === "sources" ? dest : { x: rest.x + off.x, y: rest.y + off.y, w: off.w, h: off.h };
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
            const d = alongTrack((track.get() - it.flightTrack0) * zs.get());
            if (d.x) f.cx.jump(f.cx.get() + d.x);
            if (d.y) f.cy.jump(f.cy.get() + d.y);
          }
          it.flightScroll0 = target === "open" ? scrollerOf(id)?.scrollTop ?? 0 : null;
          it.flightScrollNow = it.flightScroll0 ?? 0;
          it.flightTrack0 = target === "open" ? trackAt(index) : null;
          f.retarget(heroTarget, target === "sources" ? m.destRadius : m.metrics?.ownRadius ?? 0);
          anims.push(
            springTo(f.cx, f.to.cx, spec, { velocity: vcx, restDelta: restPx, speed: sp }),
            springTo(f.cy, f.to.cy, spec, { velocity: vcy, restDelta: restPx, speed: sp }),
            springTo(f.s, f.to.s, spec, { restDelta: restScale, speed: sp }),
          );
        } else {
          const from = wasLanded ? dest : m.heroRect!;
          // Corners: the source's on the page; the hero's at whatever scale its card is at.
          const heroRadius = m.metrics?.ownRadius ?? 0;
          const radii = {
            from: wasLanded ? m.destRadius : heroRadius * (m.metrics ? m.heroRect!.w / m.metrics.W0 : 1),
            to: target === "sources" ? m.destRadius : heroRadius,
          };
          startFlight(it, hero, from, heroTarget, m.pre ?? prepareFlight(id, hero), target === "open" ? trackAt(index) : null, radii);
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
        if (S.groupOpacity !== null) presenceOf(id).jump(1); // the source is back, in full
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
    // Centred, so the card lands mid-screen with its neighbours around it.
    try {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
    } catch {
      el.scrollIntoView({ block: "center", inline: "nearest" }); // older Safari has no "instant"
    }
    // Over the whole page the overlay is part of the page and just scrolled away with it:
    // back over the viewport (the cards, placed within it, stay where they are on screen).
    placeOnPage();
    return true;
  };

  /**
   * The visible card's close button during a flight. The button sits on its hero's corner,
   * and the hero's flying copy is drawn above the cards, so the real button (hidden by
   * zoom.css while a card opens or closes) can't be seen there. A copy rides above the
   * flight instead: on the real button's spot every frame (read after Motion has written
   * the frame's card positions, so it doesn't trail), with the flight's progress squared,
   * so it arrives late in an open and leaves early in a close, and follows a close that
   * turns around. At landing the real button takes over in the same frame.
   */
  // One copy and one follower for the provider's life (not per render), so whichever
  // render ends a flight removes the copy the starting render made.
  const flightButton = useRef({ el: null as HTMLElement | null, id: "", follow: null as (() => void) | null }).current;
  function followFlightButton() {
    if (S.phase !== "opening" && S.phase !== "closing") return endFlightButton();
    const id = S.ids[S.index];
    const button = cardEls.current.get(id)?.querySelector<HTMLElement>(".zoom-close-bar > *");
    const layer = flightRef.current;
    if (!button || !layer) return;
    if (flightButton.id !== id || !flightButton.el) {
      flightButton.el?.remove();
      const ghost = button.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-zoom-close");
      ghost.setAttribute("aria-hidden", "true");
      ghost.tabIndex = -1;
      ghost.classList.add("zoom-flight-close");
      // zIndex: above the flying copies, whichever was added to the layer first.
      Object.assign(ghost.style, { position: "absolute", zIndex: "1", left: "0", top: "0", right: "auto", bottom: "auto", margin: "0", transformOrigin: "0 0", pointerEvents: "none" });
      layer.appendChild(ghost);
      flightButton.el = ghost;
      flightButton.id = id;
    }
    const b = rel(button.getBoundingClientRect());
    const w = button.offsetWidth || 1;
    const p = clamp(visibleProgress(), 0, 1);
    const bar = parseFloat(button.parentElement!.style.opacity || "1"); // a stream's scroll fade
    flightButton.el.style.transform = `translate(${b.x}px, ${b.y}px) scale(${b.w / w})`;
    flightButton.el.style.opacity = String(p * p * bar);
  }
  function startFlightButton() {
    if (latest.current.closeButton === false) return;
    flightButton.follow ??= followFlightButton;
    frame.postRender(flightButton.follow, true);
  }
  function endFlightButton() {
    if (flightButton.follow) cancelFrame(flightButton.follow);
    flightButton.el?.remove();
    flightButton.el = null;
    flightButton.id = "";
  }

  /** Close from open, or turn an opening around. */
  const close = useCallback((v?: ZoomVelocity, closeOpts: { towardTargetOnly?: boolean; id?: string } = {}) => {
    if (S.phase !== "open" && S.phase !== "opening") return;
    const interrupted = S.phase === "opening";
    // Stream: send home the piece you're looking at. Its own close button names it;
    // otherwise it's the card whose image is most in view, which can differ from the
    // card under the top third (a tall piece's text above, the next one's image below).
    if (S.L?.stream && S.phase === "open") {
      const j = closeOpts.id !== undefined ? S.ids.indexOf(closeOpts.id) : dominantCard();
      if (j >= 0 && j !== S.index) setIndex(j, true);
    }
    leaveHistory();
    // Read (and scroll, if needed) before writing anything, so the browser only
    // recalculates styles once at the moment of release.
    const active = sources.current.get(S.ids[S.index]);
    const scrolled = !S.reduced && active && latest.current.revealSource !== false ? revealSource(active.el) : false;
    showHiddenSourceFor(S.index); // the visible item's place on the page, ready for it
    setPhase("closing");
    startFlightButton();
    emitAll("closing", interrupted);
    setBackgroundInert(false); // so tapping a source can turn the close around
    releaseScroll();
    watchPage(active?.el ?? null);
    const gen = ++S.gen;

    if (S.reduced) {
      setGroupHidden(false);
      // The visible item's source fades back in with the rest of the page.
      if (S.groupOpacity !== null) springTo(presenceOf(S.ids[S.index]), 1, timing().fadeOut, { restDelta: REST.opacity, speed: speed() });
      springTo(fade, 0, timing().fadeOut, { restDelta: REST.opacity, speed: speed() }).then(() => gen === S.gen && closeDone());
      return;
    }
    // After a scroll, let snapping and layout settle for a frame before measuring.
    if (scrolled) requestAnimationFrame(() => gen === S.gen && transitionCards("sources", S.index, v, closeOpts));
    else transitionCards("sources", S.index, v, closeOpts);
  }, []);

  /**
   * Stream: the card whose hero is most in view, or the visible card if no other's is.
   * Scored by visible area times the share of the hero that's visible, so a whole icon
   * beats a sliver of a large image, and most of a large image beats a whole icon.
   */
  const dominantCard = () => {
    const view = streamRef.current?.getBoundingClientRect();
    if (!view) return S.index;
    const score = (id: string) => {
      const hero = heroFor(id);
      if (!hero) return 0;
      const r = hero.getBoundingClientRect();
      const area = r.width * r.height;
      const w = Math.min(r.right, view.right) - Math.max(r.left, view.left);
      const h = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
      if (area <= 0 || w <= 0 || h <= 0) return 0;
      return (w * h) ** 2 / area;
    };
    let best = S.index;
    let bestScore = score(S.ids[S.index]);
    S.ids.forEach((id, j) => {
      if (j === S.index) return;
      const s = score(id);
      if (s > bestScore) [best, bestScore] = [j, s];
    });
    return best;
  };

  /** Turn a close around: every card heads back to open, with `id` as the visible one. */
  const reopen = (id: string) => {
    if (S.phase !== "closing") return;
    const j = S.ids.indexOf(id);
    if (j < 0) return;
    setPhase("opening");
    startFlightButton();
    setBackgroundInert(true);
    relockScroll();
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
    endFlightButton();
    releaseRestoration();
    presence.current.forEach((mv) => mv.jump(1)); // before the group is unmarked below
    S.ids.forEach((id, j) => {
      const it = getItem(id, j);
      if (!it.landed) emit(it, "closed");
    });
    const focusTarget = sources.current.get(S.ids[S.index])?.el ?? null;
    items.current.forEach(resetItem);
    S.ids.forEach((id) => {
      const el = sources.current.get(id)?.el;
      if (!el) return;
      delete el.dataset.zoomHidden;
      unmarkGroup(el);
    });
    setBackgroundInert(false);
    unlockScroll();
    clearShift();
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
    backdropOpacity.jump(0);
    setSession(null);
    // Keyboard users get focus back on what they opened. After a tap or click nothing
    // keeps focus: returning it would draw a ring around the tile on touch screens.
    if (S.keyboard) {
      const focusable = focusTarget?.closest<HTMLElement>("button, a[href], [tabindex]") ?? focusTarget;
      focusable?.focus({ preventScroll: true });
    } else {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && (rootRef.current?.contains(active) || focusTarget?.contains(active) || active.contains(focusTarget))) active.blur();
    }
  };

  /* -------------------------------------------------------------- wiring */

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const gestures = attachGestures(root, {
      phase: () => S.phase,
      dismiss,
      paging: () => {
        const pg = latest.current.paging;
        return typeof pg === "object" ? { ...defaultPaging, ...pg } : defaultPaging;
      },
      speed,
      debug: () => !!latest.current.debug,
      count: () => S.ids.length,
      index: () => S.index,
      layout: () => S.L!,
      activeCard: () => cardEls.current.get(S.ids[S.index]) ?? null,
      activeScroller: () =>
        cardEls.current.get(S.ids[S.index])?.querySelector<HTMLElement>(".zoom-card-scroll") ?? null,
      track,
      zx,
      zy,
      zs,
      trackAt,
      setIndex,
      page,
      settlePage: (i, velocity) => springTo(track, trackAt(i), timing().page, { velocity, speed: speed() }),
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
      if (S.L?.stream) return; // arrows scroll the column
      const [back, next] = S.L?.vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
      if (e.key === next) {
        e.preventDefault();
        page(1);
      } else if (e.key === back) {
        e.preventDefault();
        page(-1);
      }
    };
    gesturesRef.current = gestures;
    window.addEventListener("keydown", onKey);
    // How the person is getting around, for where focus goes (see focusCard).
    const onKeyInput = () => (S.keyboard = true);
    const onPointerInput = () => (S.keyboard = false);
    window.addEventListener("keydown", onKeyInput, true);
    window.addEventListener("pointerdown", onPointerInput, true);
    // Scrolling during a transition:
    // - inside a card while its hero is still flying in: the flight follows (see startFlight);
    // - the page while cards are flying home: their sources moved, so re-aim them,
    //   keeping their current speed. Once per frame at most.
    let reaim = 0;
    const onAnyScroll = (e: Event) => {
      if (S.phase === "idle") return;
      items.current.forEach((it) => {
        if (!it.flight || it.flightScroll0 === null) return;
        it.flightScrollNow = scrollerOf(it.id)?.scrollTop ?? it.flightScrollNow;
        it.flight.invalidate();
      });
      if (e.target instanceof Node && root.contains(e.target)) return;
      followPage();
    };
    /**
     * Closing, the page moved. If the viewport changed size with it, the page moved under
     * the overlay at once (a host re-laying it out, as the claude.ai viewer does when a
     * page's scrolling is released; the overlay's own frame moves on screen with it):
     * shift everything in flight by the same amount, in this frame, so nothing moves on
     * screen and the targets still hold. Otherwise it was scrolled: re-aim at the sources.
     */
    const followPage = () => {
      if (S.phase !== "closing" || S.mode !== "cards" || S.reduced) return;
      const ref = S.pageRef;
      if (!ref) return reaimSoon();
      const r = ref.el.getBoundingClientRect();
      const o = root.getBoundingClientRect();
      const vv = window.visualViewport;
      const vw = vv?.width ?? innerWidth;
      const vh = vv?.height ?? innerHeight;
      const [left, top] = [r.left - o.left, r.top - o.top];
      const dx = left - ref.left;
      const dy = top - ref.top;
      const resized = Math.abs(vw - ref.vw) > 0.5 || Math.abs(vh - ref.vh) > 0.5;
      Object.assign(ref, { left, top, vw, vh });
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      if (!resized) return reaimSoon();
      S.shift = { x: S.shift.x + dx, y: S.shift.y + dy };
      applyShift();
    };
    const reaimSoon = () => {
      if (S.phase !== "closing" || S.mode !== "cards" || S.reduced || reaim) return;
      reaim = requestAnimationFrame(() => {
        reaim = 0;
        if (S.phase === "closing" && S.mode === "cards") transitionCards("sources", S.index);
      });
    };
    // The viewport changing size mid-close (a host re-laying out the page, toolbars
    // showing) moves the sources too.
    // Over the whole page, the overlay follows the viewport's size (first, so the page's
    // movement is then measured against where it now is).
    const replace = () => S.phase !== "idle" && placeOnPage();
    window.addEventListener("resize", replace);
    window.visualViewport?.addEventListener("resize", replace);
    window.addEventListener("resize", followPage);
    window.visualViewport?.addEventListener("resize", followPage);
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
      track.jump(trackAt(S.index));
    });
    ro.observe(root);
    return () => {
      gestures.detach();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onKeyInput, true);
      window.removeEventListener("pointerdown", onPointerInput, true);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("resize", replace);
      window.visualViewport?.removeEventListener("resize", replace);
      window.removeEventListener("resize", followPage);
      window.visualViewport?.removeEventListener("resize", followPage);
      document.removeEventListener("scroll", onAnyScroll, { capture: true });
      cancelAnimationFrame(reaim);
      ro.disconnect();
    };
  }, [host]);

  // Unmounted while open (a route change, an Astro page swap): give the page back
  // its scrolling, interactivity and hidden sources, and drop any flying copies.
  useEffect(
    () => () => {
      if (S.phase === "idle") return;
      S.gen += 1; // completions of the running transition are ignored from here on
      S.offDim?.();
      S.offDim = null;
      items.current.forEach(resetItem);
      sources.current.forEach(({ el }) => {
        delete el.dataset.zoomHidden;
        unmarkGroup(el);
      });
      setBackgroundInert(false);
      unlockScroll();
      S.phase = "idle";
    },
    [],
  );

  // Plain-HTML sources (e.g. static Astro markup).
  useEffect(() => {
    const scan = latest.current.scan;
    if (!scan || !host) return;
    const selector = scan === true ? "[data-zoom-source]" : scan;
    const cleanups = [...document.querySelectorAll<HTMLElement>(selector)].map((el) => {
      const id = el.dataset.zoomSource;
      if (!id) return () => {};
      const unregister = register({ id, group: el.dataset.zoomGroup ?? "default", el, section: el.dataset.zoomSection });
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
  /** From a card's own close button or context: that card goes home. */
  const closeFromUi = useCallback((id?: string) => close(undefined, { id }), [close]);
  // Stable, so memoised cards keep their context until their own id/index/active changes.
  const cardContext = useCallback(
    (id: string, j: number, active: boolean): CardContextValue => ({
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
      close: () => closeFromUi(id),
    }),
    [closeFromUi],
  );
  const setCardEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardEls.current.set(id, el);
    else cardEls.current.delete(id);
  }, []);
  const resolved = dismiss();
  // The edge zones are for closing past the top or bottom, which a vertical pager doesn't do.
  const zones = useMemo(
    () => (props.debug && props.orientation !== "vertical" ? { slop: resolved.wheelEdgeSlop, edges: resolved.wheel } : null),
    [props.debug, props.orientation, resolved.wheelEdgeSlop, resolved.wheel],
  );
  const overlay =
    host &&
    createPortal(
      <div
        ref={rootRef}
        className={["zoom-root", fixed && "zoom-page", layout?.vertical && "zoom-vertical", layout?.stream && "zoom-streaming"]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
      >
        <motion.div className="zoom-backdrop" style={{ opacity: backdropOpacity }} />
        <motion.div ref={dimRef} className="zoom-dim" style={{ opacity: dimOpacity }} />
        <motion.div ref={zoomerRef} className="zoom-zoomer" style={{ x: zx, y: zy, scale: zs, opacity: zoomOpacity }}>
          {session && layout && (
            <motion.div
              key={session.key}
              ref={layout.stream ? streamRef : undefined}
              className={layout.stream ? "zoom-stream" : "zoom-track"}
              style={
                layout.stream
                  ? { paddingTop: layout.top, paddingBottom: `calc(${layout.top}px + var(--zoom-overscan, 0px))`, rowGap: layout.gap, ["--zoom-gap" as string]: `${layout.gap}px` }
                  : layout.vertical
                    ? { y: track }
                    : { x: track }
              }
            >
              {session.ids.map((id, j) => {
                const sectionOf = (k: number) => (k >= 0 && k < session.ids.length ? sources.current.get(session.ids[k])?.section : undefined);
                const section = layout.stream ? sectionOf(j) : undefined;
                const startsSection = !!section && section !== sectionOf(j - 1);
                const endsSection = !!section && section !== sectionOf(j + 1);
                return (
                <Fragment key={id}>
                {startsSection && (
                  <motion.div className="zoom-stream-title-row" style={{ width: layout.cardW, opacity: extrasOpacity }} data-zoom-section-title="">
                    {props.renderSectionTitle ? props.renderSectionTitle(section!) : <h2 className="zoom-stream-title">{section}</h2>}
                  </motion.div>
                )}
                <ZoomCard
                  key={id}
                  id={id}
                  j={j}
                  active={j === index}
                  layout={layout}
                  item={getItem(id, j)}
                  phase={phaseMV}
                  label={props.getLabel?.(id)}
                  renderDestination={props.renderDestination}
                  closeButton={props.closeButton ?? true}
                  closeLabel={closeLabel}
                  close={closeFromUi}
                  zones={zones}
                  makeContext={cardContext}
                  setCardEl={setCardEl}
                  section={section}
                  sectionStart={startsSection}
                  sectionEnd={endsSection}
                />
                </Fragment>
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
