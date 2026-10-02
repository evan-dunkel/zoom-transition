import { motionValue, type MotionValue } from "motion/react";
import { REST, clamp, project, rubber, springTo } from "./springs";

export type GestureLayout = { W: number; H: number; side: number; step: number; top: number; cardH: number };

export type ZoomVelocity = { vx: number; vy: number; vs: number };

export type GestureController = {
  phase(): "idle" | "opening" | "open" | "closing";
  count(): number;
  index(): number;
  layout(): GestureLayout;
  activeCard(): HTMLElement | null;
  activeScroller(): HTMLElement | null;
  dismiss(): {
    distance: number;
    velocity: number;
    minDistance: number;
    pivotY: number;
    maxShrink: number;
    wheel: "top" | "bottom" | "both" | false;
    wheelDistance: number;
    wheelEdgeSlop: number;
    drag: "top" | "bottom" | "both" | false;
  };
  /** Playback speed, so wheel smoothing follows slow motion too. */
  speed(): number;
  trackX: MotionValue<number>;
  zx: MotionValue<number>;
  zy: MotionValue<number>;
  zs: MotionValue<number>;
  targetX(i: number): number;
  setIndex(i: number): void;
  page(direction: number): void;
  settlePage(i: number, velocity: number): void;
  /** velocity: of the shared zoom (x, y in px/s, s in scale/s) at the moment of release. */
  close(velocity?: ZoomVelocity, opts?: { towardTargetOnly?: boolean }): void;
  /** Turn a close around, making `id` the visible card. */
  reopen(id: string): void;
  cancelDismiss(velocity: ZoomVelocity): void;
};

/**
 * Touch and mouse handling for the open pager. Touch uses touch events so a
 * vertical drag can either scroll the card natively or, at the top of the card,
 * become a dismiss — the decision is made on the first move, before scrolling starts.
 * Motion's own drag/pan gestures can't make that hand-off with native scroll.
 */
export function attachGestures(root: HTMLElement, c: GestureController) {
  type Axis = "x" | "y" | "none" | null;
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
    /** Dismiss drag direction: 1 = pulled down from the top, -1 = pulled up from the bottom. */
    dir: 1 as 1 | -1,
    ty: 0,
  };
  let suppressClickUntil = 0;

  const start = (x: number, y: number, t: number, type: "touch" | "mouse") => {
    // A touch can begin while the card is still opening; it takes effect once open.
    const phase = c.phase();
    if (phase !== "open" && phase !== "opening") return;
    Object.assign(G, { on: true, type, x0: x, y0: y, axis: null, samples: [{ t, x, y }], startIndex: c.index(), ty: 0 });
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
  // bottom, so the part under your finger stays under it.
  const pivot = (dir: number = 1) => {
    const L = c.layout();
    const p = c.dismiss().pivotY;
    return { cx: L.W / 2, cy: L.top + L.cardH * (dir < 0 ? 1 - p : p) };
  };
  const edgeAllowed = (which: "top" | "bottom", option: "top" | "bottom" | "both" | false) =>
    option === "both" || option === which;

  /** Returns true when the gesture is ours, so touch can preventDefault. */
  const move = (x: number, y: number, t: number) => {
    if (!G.on) return false;
    sample(t, x, y);
    let dx = x - G.x0;
    let dy = y - G.y0;
    if (!G.axis) {
      if (c.phase() !== "open") return false;
      if (Math.hypot(dx, dy) < (G.type === "touch" ? 3 : 5)) return false;
      const scroller = c.activeScroller();
      if (Math.abs(dx) > Math.abs(dy) * 0.9) {
        G.axis = "x";
        G.startTrack = c.trackX.get();
        c.trackX.jump(G.startTrack); // grab a settling page where it is
      } else if (
        (dy > 0 && (!scroller || scroller.scrollTop <= 0) && edgeAllowed("top", c.dismiss().drag)) ||
        (dy < 0 &&
          (!scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) &&
          edgeAllowed("bottom", c.dismiss().drag))
      ) {
        // At the top pulling down, or at the bottom pulling up: a dismiss drag.
        G.axis = "y";
        G.dir = dy > 0 ? 1 : -1;
        const { cx, cy } = pivot(G.dir);
        const s = c.zs.get();
        G.tx0 = c.zx.get() - cx * (1 - s);
        G.ty0 = c.zy.get() - cy * (1 - s);
        c.zx.jump(c.zx.get());
        c.zy.jump(c.zy.get());
        c.zs.jump(s);
      } else {
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
    if (G.axis === "x") {
      let v = G.startTrack + dx;
      const max = c.targetX(0);
      const min = c.targetX(c.count() - 1);
      if (v > max) v = max + rubber(v - max, L.W);
      else if (v < min) v = min - rubber(min - v, L.W);
      c.trackX.jump(v);
      return true;
    }
    if (G.axis === "y") {
      const { cx, cy } = pivot(G.dir);
      // How far the card has been pulled in the dismiss direction; pushing back
      // past where it started rubber-bands.
      const pulled = G.dir * (G.ty0 + dy);
      const amount = pulled >= 0 ? pulled : -rubber(-pulled, L.H);
      const k = 1 - clamp(amount / (L.H * 0.9), 0, 1) * c.dismiss().maxShrink;
      G.ty = amount;
      c.zs.jump(k);
      c.zx.jump(cx * (1 - k) + G.tx0 + dx);
      c.zy.jump(cy * (1 - k) + G.dir * amount);
      return true;
    }
    return false;
  };

  const end = (t: number) => {
    if (!G.on) return;
    G.on = false;
    if (G.axis === "x") {
      const L = c.layout();
      const v = clamp(velocity(t).vx, -4000, 4000);
      const projected = c.trackX.get() + project(v);
      let i = Math.round((L.side - projected) / L.step);
      i = clamp(clamp(i, G.startIndex - 1, G.startIndex + 1), 0, c.count() - 1);
      if (i !== c.index()) c.setIndex(i);
      c.settlePage(i, v);
    } else if (G.axis === "y") {
      const { vx, vy } = velocity(t);
      const d = c.dismiss();
      const L = c.layout();
      const { cx, cy } = pivot(G.dir);
      // The card was shrinking with the finger, not just moving: hand the spring the
      // full motion (scale speed included), or the shrink stalls for a moment on release.
      const span = L.H * 0.9;
      const vPull = G.dir * vy; // speed in the dismiss direction
      const shrinking = G.ty > 0 && G.ty < span;
      const vs = shrinking ? -(d.maxShrink / span) * vPull : 0;
      const vty = G.ty >= 0 ? vy : 0;
      const zoomVelocity = { vx: vx - cx * vs, vy: vty - cy * vs, vs };
      if (G.ty > d.distance || (vPull > d.velocity && G.ty > d.minDistance)) c.close(zoomVelocity);
      else c.cancelDismiss(zoomVelocity);
    }
    // Restoring the card's scrolling triggers a style recalculation; do it after the
    // close has taken its measurements rather than before.
    root.classList.remove("zoom-dragging");
    if (G.axis === "x" || G.axis === "y") suppressClickUntil = performance.now() + 150;
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      if (G.on) end(e.timeStamp);
      return;
    }
    const p = e.touches[0];
    start(p.clientX, p.clientY, e.timeStamp, "touch");
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!G.on || G.type !== "touch") return;
    const p = e.touches[0];
    if (move(p.clientX, p.clientY, e.timeStamp) && e.cancelable) e.preventDefault();
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (G.type === "touch") end(e.timeStamp);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    start(e.clientX, e.clientY, e.timeStamp, "mouse");
  };
  const onPointerMove = (e: PointerEvent) => {
    if (G.on && G.type === "mouse") move(e.clientX, e.clientY, e.timeStamp);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (G.on && G.type === "mouse") end(e.timeStamp);
  };

  /* ---------------------------------------------------------- tuning aids */

  // Reflect the wheel-dismiss state on the root as data attributes, so the debug
  // edge zones can show when the content is within the zone and when a swipe is armed.
  const flag = (name: string, on: boolean) => {
    if (on) {
      if (!(name in root.dataset)) root.dataset[name] = "";
    } else if (name in root.dataset) delete root.dataset[name];
  };
  const showZones = () => {
    const sc = c.activeScroller();
    const slop = c.dismiss().wheelEdgeSlop;
    flag("zoneTop", !!sc && sc.scrollTop <= slop);
    flag("zoneBottom", !!sc && sc.scrollHeight - sc.clientHeight - sc.scrollTop <= slop);
  };
  let armedTimer = 0;
  const showArmed = () => {
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
  const W = {
    lastT: 0,
    lastScrollT: 0,
    prevAbs: 0,
    /** Smallest step seen since the content stopped at the edge (for the dip-then-rise test). */
    minAtEdge: Infinity,
    armedTop: false,
    armedBottom: false,
    pulling: 0 as 0 | 1 | -1, // 1: pulling down from the top, -1: pulling up from the bottom
    acc: 0,
    endTimer: 0,
    swallowUntil: 0,
  };
  const pull = motionValue(0); // the card's offset, smoothed so wheel notches glide
  let mapping = false;
  pull.on("change", (ty) => {
    if (!mapping) return;
    const L = c.layout();
    const { cx, cy } = pivot(ty < 0 ? -1 : 1);
    const k = 1 - clamp(Math.abs(ty) / (L.H * 0.9), 0, 1) * c.dismiss().maxShrink;
    c.zs.jump(k);
    c.zx.jump(cx * (1 - k));
    c.zy.jump(cy * (1 - k) + ty);
  });
  const SMOOTH = { duration: 0.16, bounce: 0 };
  const pullTo = (ty: number) => springTo(pull, ty, SMOOTH, { speed: c.speed(), restDelta: REST.px });
  const visualPull = (acc: number) => {
    const L = c.layout();
    return Math.sign(acc) * rubber(Math.abs(acc), L.H * 0.6);
  };
  /** The scroll distance that would put the card where it visibly is now. */
  const pullFromVisual = (ty: number) => {
    const d = c.layout().H * 0.6;
    const r = Math.min(Math.abs(ty) / d, 0.999);
    return Math.sign(ty) * ((1 / (1 - r) - 1) * d) / 0.55;
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
    const ty = pull.get();
    const { cx, cy } = pivot(ty < 0 ? -1 : 1);
    const vty = pull.getVelocity();
    const span = L.H * 0.9;
    const vs = -(d.maxShrink / span) * Math.sign(ty) * vty;
    pull.stop();
    mapping = false;
    W.pulling = 0;
    W.acc = 0;
    W.swallowUntil = performance.now() + 250; // eat the rest of this scroll's momentum
    clearTimeout(W.endTimer);
    // The pull's speed comes from smoothing, not a hand: only keep what heads home.
    c.close({ vx: -cx * vs, vy: vty - cy * vs, vs }, { towardTargetOnly: true });
  };
  const wheelDelta = (e: WheelEvent) => (e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * c.layout().H : e.deltaY);

  const onVerticalWheel = (e: WheelEvent) => {
    const d = c.dismiss();
    const scroller = c.activeScroller();
    if (!d.wheel || !scroller) return;
    const now = performance.now();
    const fromTopEdge = scroller.scrollTop;
    const fromBottomEdge = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    const atTop = fromTopEdge <= 1;
    const atBottom = fromBottomEdge <= 1;
    const dy = wheelDelta(e);
    const step = Math.abs(dy);
    const gap = now - W.lastT;
    const atEdgeThisWay = (dy < 0 && atTop) || (dy > 0 && atBottom);
    const still = now - W.lastScrollT > STILL_MS;
    if (gap > QUIET_MS) {
      // After a real pause: arm an edge if the content is resting at or near it.
      const settled = now - W.lastScrollT > QUIET_MS;
      const slop = d.wheelEdgeSlop;
      W.armedTop = settled && fromTopEdge <= slop;
      W.armedBottom = settled && fromBottomEdge <= slop;
      W.minAtEdge = Infinity;
    } else if (atEdgeThisWay && still && !(dy < 0 ? W.armedTop : W.armedBottom)) {
      // A quick second swipe, already at the edge.
      const fingersBack = W.minAtEdge <= DIP && step >= W.minAtEdge * 1.8 + 3;
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
    if (!W.pulling) {
      const fromTop = dy < 0 && atTop && W.armedTop && (d.wheel === "top" || d.wheel === "both");
      const fromBottom = dy > 0 && atBottom && W.armedBottom && (d.wheel === "bottom" || d.wheel === "both");
      if (!fromTop && !fromBottom) return; // ordinary scrolling inside the card
      W.pulling = fromTop ? 1 : -1;
      // If the card is still springing back from a pull a moment ago, carry on
      // from where it visibly is instead of starting over from zero.
      const visible = pull.get();
      W.acc = Math.sign(visible) === W.pulling ? pullFromVisual(visible) : 0;
      mapping = true;
    }
    e.preventDefault();
    W.acc -= dy; // scrolling up pulls the card down, and vice versa
    if (Math.sign(W.acc) !== W.pulling) {
      // Scrolled back past where the pull began: hand back to normal scrolling.
      stopPulling();
      return;
    }
    if (Math.abs(W.acc) >= d.wheelDistance) {
      commitWheelDismiss();
      return;
    }
    pullTo(visualPull(W.acc));
    clearTimeout(W.endTimer);
    W.endTimer = window.setTimeout(() => {
      if (W.pulling) stopPulling(); // let go before the threshold: spring back
    }, END_MS);
  };

  // Trackpad: one sideways two-finger swipe turns one page, then waits for the swipe to end.
  let wAcc = 0;
  let wLock = 0;
  let wTimer = 0;
  const onWheel = (e: WheelEvent) => {
    if (c.phase() !== "open") return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
      onVerticalWheel(e);
      return;
    }
    e.preventDefault();
    const now = performance.now();
    clearTimeout(wTimer);
    wTimer = window.setTimeout(() => (wAcc = 0), 160);
    if (now < wLock) {
      wLock = now + 180;
      return;
    }
    wAcc += e.deltaX;
    if (Math.abs(wAcc) > 40) {
      c.page(Math.sign(wAcc));
      wAcc = 0;
      wLock = now + 400;
    }
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
    if (e.clientX < r.left) c.page(-1);
    else if (e.clientX > r.right) c.page(1);
    else if (e.clientY < r.top) c.close();
  };

  root.addEventListener("touchstart", onTouchStart, { passive: true });
  root.addEventListener("touchmove", onTouchMove, { passive: false });
  root.addEventListener("touchend", onTouchEnd);
  root.addEventListener("touchcancel", onTouchEnd);
  root.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  // Track when card content last moved (scroll events don't bubble, but capture sees them).
  const onScroll = () => {
    W.lastScrollT = performance.now();
    showZones();
  };
  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  // After a wheel dismiss, the rest of that scroll's momentum shouldn't scroll the
  // page behind. Swallow it until the wheel goes quiet.
  const onWindowWheel = (e: WheelEvent) => {
    const now = performance.now();
    if (now < W.swallowUntil) {
      e.preventDefault();
      W.swallowUntil = now + 250;
    }
  };
  window.addEventListener("wheel", onWindowWheel, { passive: false, capture: true });
  root.addEventListener("click", onClick, true);

  const detach = () => {
    clearTimeout(armedTimer);
    root.removeEventListener("touchstart", onTouchStart);
    root.removeEventListener("touchmove", onTouchMove);
    root.removeEventListener("touchend", onTouchEnd);
    root.removeEventListener("touchcancel", onTouchEnd);
    root.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    root.removeEventListener("wheel", onWheel);
    window.removeEventListener("wheel", onWindowWheel, { capture: true });
    root.removeEventListener("scroll", onScroll, { capture: true });
    clearTimeout(W.endTimer);
    pull.stop();
    root.removeEventListener("click", onClick, true);
    clearTimeout(wTimer);
  };
  return { detach, refresh: showZones };
}
