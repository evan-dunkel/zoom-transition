import { motionValue, type MotionValue } from "motion/react";
import { REST, clamp, project, rubber, springTo } from "./springs";

export type GestureLayout = {
  W: number;
  H: number;
  side: number;
  step: number;
  top: number;
  cardH: number;
  vertical: boolean;
  /** One natively scrolled column: no paging, sideways closes. */
  stream: boolean;
};

export type ZoomVelocity = { vx: number; vy: number; vs: number };

/** Which edges of the card a gesture may close it from. */
export type DismissEdges = { top: boolean; bottom: boolean };

/** The provider's dismiss options, with every edge setting resolved. */
export type GestureDismiss = {
  distance: number;
  velocity: number;
  minDistance: number;
  pivotY: number;
  maxShrink: number;
  dimFade: number;
  drag: DismissEdges;
  wheel: DismissEdges;
  wheelSideways: boolean;
  wheelDistance: number;
  wheelEdgeSlop: number;
};

/** The provider's paging options, resolved. */
export type GesturePaging = { swipeDistance: number; atEdge: "new-swipe" | "continue" };

export type GestureController = {
  phase(): "idle" | "opening" | "open" | "closing";
  count(): number;
  index(): number;
  layout(): GestureLayout;
  activeCard(): HTMLElement | null;
  activeScroller(): HTMLElement | null;
  dismiss(): GestureDismiss;
  paging(): GesturePaging;
  /** Playback speed, so wheel smoothing follows slow motion too. */
  speed(): number;
  /** Whether the debug edge zones are drawn (their state is only tracked then). */
  debug(): boolean;
  track: MotionValue<number>;
  zx: MotionValue<number>;
  zy: MotionValue<number>;
  zs: MotionValue<number>;
  trackAt(i: number): number;
  setIndex(i: number): void;
  page(direction: number): void;
  settlePage(i: number, velocity: number): void;
  /** velocity: of the shared zoom (x, y in px/s, s in scale/s) at the moment of release. */
  /** opts.id: the card to send home (its own close button); otherwise the provider picks. */
  close(velocity?: ZoomVelocity, opts?: { towardTargetOnly?: boolean; id?: string }): void;
  /** Turn a close around, making `id` the visible card. */
  reopen(id: string): void;
  cancelDismiss(velocity: ZoomVelocity): void;
};

/**
 * Touch and mouse handling for the open pager. Touch uses touch events so a
 * vertical drag can either scroll the card natively or, at the top of the card,
 * become a dismiss (or, in a vertical pager, turn the page) — the decision is made
 * on the first move, before scrolling starts. Motion's own drag/pan gestures can't
 * make that hand-off with native scroll.
 *
 * Horizontal pager: sideways drags page, vertical drags at an edge dismiss.
 * Vertical pager: vertical drags at an edge page, sideways drags dismiss.
 */
export function attachGestures(root: HTMLElement, c: GestureController) {
  /**
   * "page": moving the track. "dismiss": pulling the card away. "scroll": scrolling the
   * visible card for a touch that landed off it (see below). "none": left to native scrolling.
   */
  type Axis = "page" | "dismiss" | "scroll" | "none" | null;
  const G = {
    on: false,
    type: "touch" as "touch" | "mouse",
    x0: 0,
    y0: 0,
    axis: null as Axis,
    samples: [] as { t: number; x: number; y: number }[],
    startTrack: 0,
    startIndex: 0,
    tx0: 0,
    ty0: 0,
    /**
     * Dismiss drag direction: 1 = pulled down from the top (or, in a vertical pager,
     * to the right), -1 = pulled up from the bottom (or to the left).
     */
    dir: 1 as 1 | -1,
    /** How far the card has been pulled in the dismiss direction. */
    pulled: 0,
    /** Where the touch landed. */
    target: null as EventTarget | null,
    /** "scroll": the visible card's scroll position when the drag began. */
    scroll0: 0,
  };
  let suppressClickUntil = 0;

  const start = (x: number, y: number, t: number, type: "touch" | "mouse", target: EventTarget | null) => {
    // A touch can begin while the card is still opening; it takes effect once open.
    const phase = c.phase();
    if (phase !== "open" && phase !== "opening") return;
    stopGlide();
    Object.assign(G, { on: true, type, x0: x, y0: y, axis: null, samples: [{ t, x, y }], startIndex: c.index(), pulled: 0, target });
  };
  /** A page turn is still settling: the track isn't at the visible card yet. */
  const turning = () => Math.abs(c.track.get() - c.trackAt(c.index())) > 0.5;
  /**
   * Scroll the visible card's content by hand, one wheel event's worth. Plain scrollTop:
   * restarting a smooth scroll on every event barely moves it, and older Safari throws
   * on behavior "instant".
   */
  const scrollCardBy = (sc: HTMLElement, dy: number) => {
    stopGlide();
    sc.scrollTop += dy;
  };
  /** True when an event landed somewhere other than the visible card (a neighbour, a gap, the backdrop). */
  const offCard = (target: EventTarget | null) => {
    const card = c.activeCard();
    return !!card && !(target instanceof Node && card.contains(target));
  };

  // Right after a page turn, the card you left is still partly on screen, and it's
  // inert, so scrolling over it would do nothing until the new card slid under the
  // pointer or finger. Scrolling anywhere off the visible card scrolls the visible card.
  let glide = 0;
  const stopGlide = () => {
    cancelAnimationFrame(glide);
    glide = 0;
  };
  /** A touch scroll we drove ourselves carries on with UIScrollView-like deceleration. */
  const glideScroll = (sc: HTMLElement, pxPerSecond: number) => {
    stopGlide();
    let v = pxPerSecond / 1000;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - last, 32);
      last = now;
      const before = sc.scrollTop;
      sc.scrollTop = before + v * dt;
      v *= Math.pow(0.998, dt);
      glide = Math.abs(v) > 0.02 && sc.scrollTop !== before ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  };
  const sample = (t: number, x: number, y: number) => {
    G.samples.push({ t, x, y });
    while (G.samples.length > 2 && t - G.samples[0].t > 120) G.samples.shift();
  };
  const velocity = (now: number) => {
    const s = G.samples.filter((p) => now - p.t <= 100);
    if (s.length < 2) return { vx: 0, vy: 0 };
    const a = s[0];
    const b = s[s.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0.004) return { vx: 0, vy: 0 };
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  };
  // The card shrinks around a point a third of the way down when pulled down from
  // the top, and the mirror point (a third of the way up) when pulled up from the
  // bottom, so the part under your finger stays under it. Pulled sideways (vertical
  // pager), it shrinks around the same point a third of the way down.
  const pivot = (dir: number = 1) => {
    const L = c.layout();
    const p = c.dismiss().pivotY;
    return { cx: L.W / 2, cy: L.top + L.cardH * (dir < 0 && !L.vertical ? 1 - p : p) };
  };
  /** How far a pull goes before the card has shrunk all it will. */
  const pullSpan = (L: GestureLayout) => (L.vertical ? L.W : L.H) * 0.9;
  /** Dismiss gestures are on: a vertical pager closes sideways, from either side, if either edge is on. */
  const sidewaysOn = (edges: DismissEdges) => edges.top || edges.bottom;

  /** Returns true when the gesture is ours, so touch can preventDefault. */
  const move = (x: number, y: number, t: number) => {
    if (!G.on) return false;
    sample(t, x, y);
    let dx = x - G.x0;
    let dy = y - G.y0;
    if (!G.axis) {
      if (c.phase() !== "open") return false;
      if (Math.hypot(dx, dy) < (G.type === "touch" ? 3 : 5)) return false;
      const L0 = c.layout();
      const scroller = c.activeScroller();
      const drag = c.dismiss().drag;
      const sideways = Math.abs(dx) > Math.abs(dy) * 0.9;
      const atTop = !scroller || scroller.scrollTop <= 0;
      const atBottom = !scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      const startPaging = () => {
        G.axis = "page";
        G.startTrack = c.track.get();
        c.track.jump(G.startTrack); // grab a settling page where it is
      };
      const startDismiss = (dir: 1 | -1) => {
        G.axis = "dismiss";
        G.dir = dir;
        const { cx, cy } = pivot(G.dir);
        const s = c.zs.get();
        G.tx0 = c.zx.get() - cx * (1 - s);
        G.ty0 = c.zy.get() - cy * (1 - s);
        c.zx.jump(c.zx.get());
        c.zy.jump(c.zy.get());
        c.zs.jump(s);
      };
      if (L0.vertical) {
        if (sideways && sidewaysOn(drag)) startDismiss(dx > 0 ? 1 : -1);
        // A stream has no pages: vertical drags are the column's own scrolling.
        else if (L0.stream) {
          G.axis = "none";
          return false;
        }
        // At the top pulling down, or at the bottom pushing up: the previous or next page.
        else if (!sideways && ((dy > 0 && atTop) || (dy < 0 && atBottom))) startPaging();
        else if (!sideways && G.type === "touch" && scroller && (turning() || offCard(G.target))) {
          G.axis = "scroll";
          G.scroll0 = scroller.scrollTop;
        } else {
          G.axis = "none";
          return false;
        }
      } else if (sideways) startPaging();
      // At the top pulling down, or at the bottom pulling up: a dismiss drag.
      else if ((dy > 0 && drag.top && atTop) || (dy < 0 && drag.bottom && atBottom)) startDismiss(dy > 0 ? 1 : -1);
      else {
        G.axis = "none";
        return false;
      }
      G.x0 = x;
      G.y0 = y;
      dx = 0;
      dy = 0;
      root.classList.add("zoom-dragging");
    }
    const L = c.layout();
    if (G.axis === "page") {
      let v = G.startTrack + (L.vertical ? dy : dx);
      const max = c.trackAt(0);
      const min = c.trackAt(c.count() - 1);
      const size = L.vertical ? L.H : L.W;
      if (v > max) v = max + rubber(v - max, size);
      else if (v < min) v = min - rubber(min - v, size);
      c.track.jump(v);
      return true;
    }
    if (G.axis === "scroll") {
      const sc = c.activeScroller();
      if (sc) sc.scrollTop = G.scroll0 - dy;
      return true;
    }
    if (G.axis === "dismiss") {
      const { cx, cy } = pivot(G.dir);
      // How far the card has been pulled in the dismiss direction; pushing back
      // past where it started rubber-bands. The other axis follows the finger freely.
      const pulled = G.dir * (L.vertical ? G.tx0 + dx : G.ty0 + dy);
      const amount = pulled >= 0 ? pulled : -rubber(-pulled, L.vertical ? L.W : L.H);
      const k = 1 - clamp(amount / pullSpan(L), 0, 1) * c.dismiss().maxShrink;
      G.pulled = amount;
      c.zs.jump(k);
      c.zx.jump(cx * (1 - k) + (L.vertical ? G.dir * amount : G.tx0 + dx));
      c.zy.jump(cy * (1 - k) + (L.vertical ? G.ty0 + dy : G.dir * amount));
      return true;
    }
    return false;
  };

  const end = (t: number) => {
    if (!G.on) return;
    G.on = false;
    if (G.axis === "page") {
      const L = c.layout();
      const fling = velocity(t);
      const v = clamp(L.vertical ? fling.vy : fling.vx, -4000, 4000);
      const projected = c.track.get() + project(v);
      let i = Math.round((c.trackAt(0) - projected) / L.step);
      i = clamp(clamp(i, G.startIndex - 1, G.startIndex + 1), 0, c.count() - 1);
      if (i !== c.index()) c.setIndex(i);
      c.settlePage(i, v);
    } else if (G.axis === "scroll") {
      const sc = c.activeScroller();
      if (sc) glideScroll(sc, -clamp(velocity(t).vy, -6000, 6000));
    } else if (G.axis === "dismiss") {
      const { vx, vy } = velocity(t);
      const d = c.dismiss();
      const L = c.layout();
      const { cx, cy } = pivot(G.dir);
      // The card was shrinking with the finger, not just moving: hand the spring the
      // full motion (scale speed included), or the shrink stalls for a moment on release.
      const span = pullSpan(L);
      const vAlong = L.vertical ? vx : vy; // along the pull's axis
      const vAcross = L.vertical ? vy : vx;
      const vPull = G.dir * vAlong; // speed in the dismiss direction
      const shrinking = G.pulled > 0 && G.pulled < span;
      const vs = shrinking ? -(d.maxShrink / span) * vPull : 0;
      const vMain = G.pulled >= 0 ? vAlong : 0;
      const zoomVelocity = L.vertical
        ? { vx: vMain - cx * vs, vy: vAcross - cy * vs, vs }
        : { vx: vAcross - cx * vs, vy: vMain - cy * vs, vs };
      if (G.pulled > d.distance || (vPull > d.velocity && G.pulled > d.minDistance)) c.close(zoomVelocity);
      else c.cancelDismiss(zoomVelocity);
    }
    // Restoring the card's scrolling triggers a style recalculation; do it after the
    // close has taken its measurements rather than before.
    root.classList.remove("zoom-dragging");
    if (G.axis === "page" || G.axis === "dismiss" || G.axis === "scroll") suppressClickUntil = performance.now() + 150;
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      if (G.on) end(e.timeStamp);
      return;
    }
    const p = e.touches[0];
    start(p.clientX, p.clientY, e.timeStamp, "touch", e.target);
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!G.on || G.type !== "touch") return;
    const p = e.touches[0];
    if (move(p.clientX, p.clientY, e.timeStamp) && e.cancelable) e.preventDefault();
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (G.type === "touch") end(e.timeStamp);
  };
  // A mouse drag is followed on the window (it may leave the card), but only while
  // one is in progress, so ordinary mouse movement on the page costs nothing.
  const followPointer = (on: boolean) => {
    if (on) {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    } else {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    start(e.clientX, e.clientY, e.timeStamp, "mouse", e.target);
    if (G.on) followPointer(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (G.on && G.type === "mouse") move(e.clientX, e.clientY, e.timeStamp);
  };
  const onPointerUp = (e: PointerEvent) => {
    followPointer(false);
    if (G.on && G.type === "mouse") end(e.timeStamp);
  };

  /* ---------------------------------------------------------- tuning aids */

  // Reflect the wheel-dismiss state on the root as data attributes, so the debug
  // edge zones can show when the content is within the zone and when a swipe is armed.
  // Skipped entirely unless debug is on: it reads layout on every scroll.
  const flag = (name: string, on: boolean) => {
    if (on) {
      if (!(name in root.dataset)) root.dataset[name] = "";
    } else if (name in root.dataset) delete root.dataset[name];
  };
  const showZones = () => {
    const sc = c.debug() ? c.activeScroller() : null;
    const { wheel, wheelEdgeSlop: slop } = c.dismiss();
    flag("zoneTop", !!sc && wheel.top && sc.scrollTop <= slop);
    flag("zoneBottom", !!sc && wheel.bottom && sc.scrollHeight - sc.clientHeight - sc.scrollTop <= slop);
  };
  let armedTimer = 0;
  const showArmed = () => {
    if (!c.debug()) return;
    flag("armedTop", W.armedTop);
    flag("armedBottom", W.armedBottom);
    clearTimeout(armedTimer);
    armedTimer = window.setTimeout(() => {
      flag("armedTop", false);
      flag("armedBottom", false);
    }, QUIET_MS);
  };

  /* ---------------------------------------------------------- wheel / trackpad */

  // Scrolling past the top (or bottom) of a card pulls it like a drag; pull far
  // enough and it closes. Wheels have no "release", so a pause ends the gesture.
  //
  // A swipe that runs into an edge never closes the card, however fast: the pull
  // is only *armed* by a new swipe made with the content already resting at the
  // edge. Swipe to the end, then swipe again to close. Telling a new swipe apart
  // from the first one's momentum, without waiting:
  // - Trackpad: momentum only ever slows down. A new swipe is the scroll speed
  //   dipping to almost nothing and then picking up again (fingers back down).
  // - Mouse wheel: no momentum; a new spin is a short gap, then the same notch size.
  // - After a real pause (QUIET_MS), a swipe starting within EDGE_SLOP of the edge
  //   is armed straight away.
  const QUIET_MS = 250;
  // How long the wheel can go quiet mid-pull before we treat it as let go. macOS
  // can pause around 200 ms between the fingers lifting and momentum starting; a
  // shorter wait let the card spring back and then lurch forward again.
  const END_MS = 350;
  const STILL_MS = 50; // content must have stopped at the edge this long
  const DIP = 8; // px per event: "almost stopped"
  const MOUSE_GAP_MS = 140; // notches within one spin come faster than this; a new spin comes after a beat

  /**
   * Follows a swipe that has already done its job (turned a page, closed the card),
   * to tell what's left of it from a new swipe, so a new swipe acts at once even
   * mid-momentum (quick flicks in a row). A real pause (QUIET_MS) always ends it.
   *
   * Momentum only ever slows. But the swipe is often still speeding up when it acts
   * (the page turns a few events in), and that mustn't read as a new swipe. So the
   * tail first waits for the swipe to start slowing (two falls in a row); from then
   * on, any clear rise in speed is fingers pushing again. Before that, only the
   * strict sign counts: the speed dipping to almost nothing and picking up again.
   * Movement the other way is never part of it, but doesn't end it either: momentum
   * the old way can still be arriving.
   */
  const swipeTail = () => {
    let dir = 0;
    let min = Infinity;
    let lastT = 0;
    let prev = 0;
    let falls = 0;
    /** Smallest step since the swipe started slowing (Infinity until it has). */
    let minSlowing = Infinity;
    return {
      start(direction: number) {
        dir = direction;
        min = Infinity;
        lastT = performance.now();
        prev = 0;
        falls = 0;
        minSlowing = Infinity;
      },
      end() {
        dir = 0;
      },
      /** True while `delta` is still the old swipe or its momentum. */
      owns(delta: number, now: number) {
        if (!dir) return false;
        const quiet = now - lastT > QUIET_MS;
        lastT = now;
        const step = Math.abs(delta);
        const dipAndRise = min <= DIP && step >= min * 1.8 + 3;
        const riseWhileSlowing = minSlowing !== Infinity && step >= minSlowing * 1.5 + 4;
        if (quiet || dipAndRise || riseWhileSlowing) {
          dir = 0; // a new swipe
          return false;
        }
        if (Math.sign(delta) !== dir) return false;
        min = Math.min(min, step);
        falls = step < prev ? falls + 1 : step > prev ? 0 : falls;
        prev = step;
        if (falls >= 2 || minSlowing !== Infinity) minSlowing = Math.min(minSlowing, step);
        return true;
      },
      get active() {
        return dir !== 0;
      },
    };
  };
  const W = {
    lastT: 0,
    lastScrollT: 0,
    prevAbs: 0,
    /** Smallest step seen since the content stopped at the edge (for the dip-then-rise test). */
    minAtEdge: Infinity,
    armedTop: false,
    armedBottom: false,
    /**
     * 1: pulling down from the top (vertical pager: to the right), -1: pulling up
     * from the bottom (vertical pager: to the left).
     */
    pulling: 0 as 0 | 1 | -1,
    acc: 0,
    endTimer: 0,
  };
  // The card's offset along the pull, smoothed so wheel notches glide. A horizontal
  // pager pulls the card down or up; a vertical one pulls it sideways.
  const pull = motionValue(0);
  let mapping = false;
  pull.on("change", (t) => {
    if (!mapping) return;
    const L = c.layout();
    const { cx, cy } = pivot(t < 0 ? -1 : 1);
    const k = 1 - clamp(Math.abs(t) / pullSpan(L), 0, 1) * c.dismiss().maxShrink;
    c.zs.jump(k);
    c.zx.jump(cx * (1 - k) + (L.vertical ? t : 0));
    c.zy.jump(cy * (1 - k) + (L.vertical ? 0 : t));
  });
  const SMOOTH = { duration: 0.16, bounce: 0 };
  const pullTo = (t: number) => springTo(pull, t, SMOOTH, { speed: c.speed(), restDelta: REST.px });
  /** How far the rubber band stretches for a pull. */
  const pullStretch = () => {
    const L = c.layout();
    return (L.vertical ? L.W : L.H) * 0.6;
  };
  const visualPull = (acc: number) => Math.sign(acc) * rubber(Math.abs(acc), pullStretch());
  /** The scroll distance that would put the card where it visibly is now. */
  const pullFromVisual = (t: number) => {
    const d = pullStretch();
    const r = Math.min(Math.abs(t) / d, 0.999);
    return Math.sign(t) * ((1 / (1 - r) - 1) * d) / 0.55;
  };
  const stopPulling = () => {
    W.pulling = 0;
    W.acc = 0;
    pullTo(0).then(() => {
      if (!W.pulling) mapping = false;
    });
  };
  const commitWheelDismiss = () => {
    const L = c.layout();
    const d = c.dismiss();
    const t = pull.get();
    const { cx, cy } = pivot(t < 0 ? -1 : 1);
    const vt = pull.getVelocity();
    const vs = -(d.maxShrink / pullSpan(L)) * Math.sign(t) * vt;
    pull.stop();
    mapping = false;
    W.pulling = 0;
    W.acc = 0;
    // Eat the rest of this scroll's momentum (it scrolled the other way to the pull).
    swallowMomentum(-Math.sign(t), L.vertical ? "x" : "y");
    clearTimeout(W.endTimer);
    // The pull's speed comes from smoothing, not a hand: only keep what heads home.
    const v = L.vertical ? { vx: vt - cx * vs, vy: -cy * vs, vs } : { vx: -cx * vs, vy: vt - cy * vs, vs };
    c.close(v, { towardTargetOnly: true });
  };
  /** Start pulling the card in `direction` (1 or -1), carrying on from a pull still springing back. */
  const beginPull = (direction: 1 | -1) => {
    W.pulling = direction;
    if (!mapping) {
      // A drag let go short of closing may still be springing the card back. Stop that
      // and pick the pull up from where the card is, rather than snapping it to rest.
      const L = c.layout();
      const k = c.zs.get();
      if (Math.abs(1 - k) > 0.001 || Math.abs(c.zx.get()) > 0.5 || Math.abs(c.zy.get()) > 0.5) {
        [c.zx, c.zy, c.zs].forEach((v) => v.stop());
        const { cx, cy } = pivot(direction);
        pull.jump(L.vertical ? c.zx.get() - cx * (1 - k) : c.zy.get() - cy * (1 - k));
      }
    }
    // If the card is still springing back from a pull a moment ago, carry on
    // from where it visibly is instead of starting over from zero.
    const visible = pull.get();
    W.acc = Math.sign(visible) === W.pulling ? pullFromVisual(visible) : 0;
    mapping = true;
  };
  /** One wheel event's worth of pull; closes past wheelDistance, springs back after a pause. */
  const pullBy = (delta: number) => {
    W.acc -= delta; // scrolling up pulls the card down, and vice versa (sideways likewise)
    if (Math.sign(W.acc) !== W.pulling) {
      // Scrolled back past where the pull began: hand back to normal scrolling.
      stopPulling();
      return;
    }
    if (Math.abs(W.acc) >= c.dismiss().wheelDistance) {
      commitWheelDismiss();
      return;
    }
    pullTo(visualPull(W.acc));
    clearTimeout(W.endTimer);
    W.endTimer = window.setTimeout(() => {
      if (W.pulling) stopPulling(); // let go before the threshold: spring back
    }, END_MS);
  };
  const wheelDelta = (e: WheelEvent, axis: "x" | "y" = "y") => {
    const d = axis === "x" ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) return d * 16;
    if (e.deltaMode === 2) return d * (axis === "x" ? c.layout().W : c.layout().H);
    return d;
  };

  /**
   * Arms the top or bottom edge when this vertical wheel event is a new swipe made
   * with the content resting at (or within the slop of) that edge, as described
   * above. Returns where the content is.
   *
   * eager (paging): a new swipe is recognised as soon as the speed picks up at the
   * edge, without first dropping to almost nothing. Momentum only ever slows, so any
   * clear rise is fingers pushing again. Waiting for a near stop meant a swipe made
   * while the last one's momentum was still running into the edge (or while the
   * content bounced there) never counted, and the page wouldn't turn.
   */
  const armEdges = (dy: number, scroller: HTMLElement, edges: DismissEdges, slop: number, eager = false) => {
    const now = performance.now();
    const fromTopEdge = scroller.scrollTop;
    const fromBottomEdge = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    const atTop = fromTopEdge <= 1;
    const atBottom = fromBottomEdge <= 1;
    const step = Math.abs(dy);
    const gap = now - W.lastT;
    const atEdgeThisWay = (dy < 0 && atTop) || (dy > 0 && atBottom);
    const still = now - W.lastScrollT > STILL_MS;
    if (gap > QUIET_MS) {
      // After a real pause: arm an edge if the content is resting at or near it.
      const settled = now - W.lastScrollT > QUIET_MS;
      W.armedTop = edges.top && settled && fromTopEdge <= slop;
      W.armedBottom = edges.bottom && settled && fromBottomEdge <= slop;
      W.minAtEdge = Infinity;
    } else if (atEdgeThisWay && still && (dy < 0 ? edges.top && !W.armedTop : edges.bottom && !W.armedBottom)) {
      // A quick second swipe, already at the edge.
      const fingersBack = eager
        ? W.minAtEdge !== Infinity && step >= W.minAtEdge * 1.5 + 4
        : W.minAtEdge <= DIP && step >= W.minAtEdge * 1.8 + 3;
      const wheelAgain = gap >= MOUSE_GAP_MS && step >= 40 && step === W.prevAbs;
      if (fingersBack || wheelAgain) {
        if (dy < 0) W.armedTop = true;
        else W.armedBottom = true;
      }
    }
    W.minAtEdge = atEdgeThisWay && still ? Math.min(W.minAtEdge, step) : Infinity;
    W.prevAbs = step;
    W.lastT = now;
    showArmed();
    return { atTop, atBottom };
  };

  // Horizontal pager: scrolling past the top (or bottom) of the card pulls it to close.
  const onVerticalWheel = (e: WheelEvent) => {
    const d = c.dismiss();
    if (!d.wheel.top && !d.wheel.bottom) return;
    const scroller = c.activeScroller();
    if (!scroller) return;
    const dy = wheelDelta(e);
    const { atTop, atBottom } = armEdges(dy, scroller, d.wheel, d.wheelEdgeSlop);
    if (!W.pulling) {
      const fromTop = dy < 0 && atTop && W.armedTop && d.wheel.top;
      const fromBottom = dy > 0 && atBottom && W.armedBottom && d.wheel.bottom;
      if (!fromTop && !fromBottom) return; // ordinary scrolling inside the card
      beginPull(fromTop ? 1 : -1);
    }
    e.preventDefault();
    pullBy(dy);
  };

  // Vertical pager: with dismiss.wheelSideways, scrolling sideways pulls the card to
  // close, either way. There's nothing to scroll sideways, so there's no edge to wait
  // for: the pull starts at once. Off (the default), a sideways scroll does nothing.
  const onSidewaysWheel = (e: WheelEvent) => {
    // Always ours, so a sideways swipe never reaches the browser's swipe-back navigation.
    e.preventDefault();
    const d = c.dismiss();
    if (!d.wheelSideways || !sidewaysOn(d.wheel)) return;
    const dx = wheelDelta(e, "x");
    if (!dx) return;
    if (!W.pulling) beginPull(dx < 0 ? 1 : -1);
    pullBy(dx);
  };

  // Trackpad: a two-finger swipe along the pager (paging.swipeDistance of travel) turns one page. The rest of that
  // swipe, its momentum included, is ignored, but a new swipe turns the next page
  // right away, even while the last one's momentum is still arriving (as arrow keys
  // can). A new swipe is told apart from momentum the same way as for wheel dismiss:
  // momentum only ever slows, so the speed dipping and picking up again is fingers
  // back down. A swipe the other way, or after a real pause, is always new.
  const pageTail = swipeTail();
  let pageAcc = 0;
  let pageLastT = 0;
  // macOS can pause ~200 ms between the fingers lifting and momentum starting, so
  // only a longer quiet spell starts the count again.
  const pageClock = (now: number) => {
    if (now - pageLastT > QUIET_MS) pageAcc = 0;
    pageLastT = now;
  };
  /** Counts a swipe's travel along the pager, turning a page once it's far enough. */
  const pageBy = (delta: number) => {
    if (Math.sign(pageAcc) !== Math.sign(delta)) pageAcc = 0;
    pageAcc += delta;
    if (Math.abs(pageAcc) > c.paging().swipeDistance) {
      c.page(Math.sign(delta));
      pageTail.start(Math.sign(delta));
      pageAcc = 0;
    }
  };
  // Horizontal pager: sideways swipes page.
  const onHorizontalWheel = (e: WheelEvent) => {
    e.preventDefault();
    const now = performance.now();
    const dx = wheelDelta(e, "x");
    pageClock(now);
    if (!dx || pageTail.owns(dx, now)) return;
    pageBy(dx);
  };
  // Vertical pager: vertical swipes page, once the card's own content has reached
  // its top or bottom. By default (paging.atEdge "new-swipe"), as with closing, a
  // swipe that runs into the edge doesn't turn the page; a new swipe made at the edge
  // does, so a long card can be read to the end without flying past it. With
  // "continue", reaching the edge turns the page straight away.
  const onVerticalPagingWheel = (e: WheelEvent) => {
    const scroller = c.activeScroller();
    if (!scroller) return;
    const now = performance.now();
    const dy = wheelDelta(e);
    if (!dy) return;
    const keepGoing = c.paging().atEdge === "continue";
    const afterPage = pageTail.active;
    // What's left of a swipe that turned a page mustn't scroll the new card, unless
    // paging is set to keep going: then the cards read as one continuous stream and
    // the swipe carries on into the next card's content.
    if (!keepGoing && pageTail.owns(dy, now)) {
      e.preventDefault();
      pageClock(now);
      return;
    }
    const { atTop, atBottom } = armEdges(dy, scroller, { top: true, bottom: true }, c.dismiss().wheelEdgeSlop, true);
    const atEdgeThisWay = dy < 0 ? atTop : atBottom;
    // A new swipe straight after a page turn: at the edge, it turns the next one.
    if (afterPage && atEdgeThisWay) {
      if (dy < 0) W.armedTop = true;
      else W.armedBottom = true;
    }
    const armed = keepGoing || (dy < 0 ? W.armedTop : W.armedBottom);
    if (!atEdgeThisWay || !armed) {
      // Scrolls the card's content. Natively when the pointer is over it; by hand while
      // a page turn is still settling (hit-testing a card that's moving is unreliable,
      // and the card being left is inert, so native scrolling would wait for the new
      // card to reach the pointer) and from anywhere off the card.
      if (turning() || offCard(e.target)) {
        e.preventDefault();
        scrollCardBy(scroller, dy);
      }
      return;
    }
    e.preventDefault();
    pageClock(now);
    pageBy(dy);
  };
  // Vertical layouts: each wheel gesture is locked to one axis. A trackpad swipe often
  // starts a little diagonal; deciding per event let its first events scroll the column
  // and the next ones pull the card, which showed as a jump before the pull. The lock is
  // decided on a gesture's first event and released after a pause, or switched to
  // sideways by a clearly sideways event (a new swipe over the last one's momentum,
  // which only ever moves the way it was going).
  const AX = { axis: null as "x" | "y" | null, lastT: 0 };
  const wheelAxis = (e: WheelEvent) => {
    const now = performance.now();
    const dx = Math.abs(e.deltaX);
    const dy = Math.abs(e.deltaY);
    if (now - AX.lastT > 120) AX.axis = null;
    AX.lastT = now;
    if (AX.axis === "y" && dx > 4 && dx > dy * 2) AX.axis = "x";
    if (!AX.axis) AX.axis = dx > dy ? "x" : "y";
    return AX.axis;
  };
  const onWheel = (e: WheelEvent) => {
    if (c.phase() !== "open") return;
    if (c.layout().vertical) {
      if (wheelAxis(e) === "x") onSidewaysWheel(e); // its vertical part doesn't scroll either
      else if (!c.layout().stream) onVerticalPagingWheel(e); // a stream just scrolls
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) onHorizontalWheel(e);
    else onVerticalWheel(e);
  };

  const onClick = (e: MouseEvent) => {
    if (performance.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const phase = c.phase();
    const target = e.target as Element;
    if (phase === "closing") {
      // Tapping any card (or its flying cover) on its way home brings it back.
      const hit = target.closest<HTMLElement>("[data-zoom-id]");
      if (hit?.dataset.zoomId) {
        e.preventDefault();
        e.stopPropagation();
        c.reopen(hit.dataset.zoomId);
      }
      return;
    }
    if (phase !== "open" && phase !== "opening") return;
    if (target.closest("[data-zoom-close]")) {
      // A close button closes its own card (in a stream, more than one can be in view).
      c.close(undefined, { id: target.closest<HTMLElement>("[data-zoom-id]")?.dataset.zoomId });
      return;
    }
    if (c.layout().stream) {
      // Every card in a stream is content; only a tap off all of them closes.
      if (target.closest(".zoom-card")) return;
      c.close();
      return;
    }
    const card = c.activeCard();
    if (!card || card.contains(target)) return;
    if (phase === "opening") {
      c.close(); // a tap outside the card while it's opening sends it back
      return;
    }
    const r = card.getBoundingClientRect();
    if (c.layout().vertical) {
      // Above or below: the neighbour peeking there. Beside the card: close.
      if (e.clientY < r.top) c.page(-1);
      else if (e.clientY > r.bottom) c.page(1);
      else c.close();
    } else if (e.clientX < r.left) c.page(-1);
    else if (e.clientX > r.right) c.page(1);
    else if (e.clientY < r.top) c.close();
  };

  root.addEventListener("touchstart", onTouchStart, { passive: true });
  root.addEventListener("touchmove", onTouchMove, { passive: false });
  root.addEventListener("touchend", onTouchEnd);
  root.addEventListener("touchcancel", onTouchEnd);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("wheel", onWheel, { passive: false });
  // Track when card content last moved (scroll events don't bubble, but capture sees them).
  const onScroll = () => {
    W.lastScrollT = performance.now();
    showZones();
  };
  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  // After a wheel dismiss, the rest of that scroll's momentum shouldn't scroll the
  // page behind, so it's swallowed, but only the momentum: a new scroll (or one the
  // other way) goes through straight away, and the swallowing ends with it. The
  // listener is only attached for that moment: a non-passive wheel listener on the
  // window would otherwise make the browser run JavaScript before every page scroll.
  const MAX_SWALLOW_MS = 2000; // momentum is long over by then, whatever it looks like
  const closeTail = swipeTail();
  let swallowTimer = 0;
  let quietTimer = 0;
  // Quiet for QUIET_MS means the momentum is over: whatever comes next is a new scroll.
  const stopWhenQuiet = () => {
    clearTimeout(quietTimer);
    quietTimer = window.setTimeout(stopSwallowing, QUIET_MS);
  };
  const stopSwallowing = () => {
    clearTimeout(swallowTimer);
    clearTimeout(quietTimer);
    closeTail.end();
    window.removeEventListener("wheel", onWindowWheel, { capture: true });
  };
  let swallowAxis: "x" | "y" = "y";
  function swallowMomentum(direction: number, axis: "x" | "y") {
    swallowAxis = axis;
    closeTail.start(direction);
    window.addEventListener("wheel", onWindowWheel, { passive: false, capture: true });
    clearTimeout(swallowTimer);
    swallowTimer = window.setTimeout(stopSwallowing, MAX_SWALLOW_MS);
    stopWhenQuiet();
  }
  function onWindowWheel(e: WheelEvent) {
    if (closeTail.owns(wheelDelta(e, swallowAxis), performance.now())) {
      e.preventDefault();
      stopWhenQuiet();
    } else if (!closeTail.active) stopSwallowing();
  }
  root.addEventListener("click", onClick, true);

  const detach = () => {
    clearTimeout(armedTimer);
    stopGlide();
    root.removeEventListener("touchstart", onTouchStart);
    root.removeEventListener("touchmove", onTouchMove);
    root.removeEventListener("touchend", onTouchEnd);
    root.removeEventListener("touchcancel", onTouchEnd);
    root.removeEventListener("pointerdown", onPointerDown);
    followPointer(false);
    root.removeEventListener("wheel", onWheel);
    stopSwallowing();
    root.removeEventListener("scroll", onScroll, { capture: true });
    clearTimeout(W.endTimer);
    pull.stop();
    root.removeEventListener("click", onClick, true);
  };
  return { detach, refresh: showZones };
}
