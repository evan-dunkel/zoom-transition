import type { CSSProperties } from "react";
import { animate, motion, useTransform, type MotionValue } from "motion/react";
import { ZoomHero, useZoomEvent, useZoomProgress, useZoomValue } from "../src/zoom";
import type { Book } from "./books";

// Book pieces shared by both prototypes (the shelves and the feed).

/* ------------------------------------------------------------------ covers */

const TEXT_TOP = new Set(["arch", "waves", "split", "block"]);

export function Cover({ b }: { b: Book }) {
  const style = { "--cb": b.c[0], "--cf": b.c[1], "--ca": b.c[2], ...(b.ts ? { "--ts": b.ts } : {}) } as CSSProperties;
  return (
    <span className="cover" style={style}>
      <span className={`face m-${b.m} f-${b.f} ${TEXT_TOP.has(b.m) ? "t-top" : "t-bottom"}`}>
        <span className="motif" />
        <span className="cv-text">
          <span className="cv-title">{b.t}</span>
          <span className="cv-author">{b.a}</span>
        </span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ the book opening (content motion) */

// Everything in this section is book-store content. The library only supplies
// signals: progress (synced), events + shared values (own timing), or nothing (static).

export type HeroMode = "synced" | "own" | "static";

/** A book with a front cover hinged on the spine, over a first page. */
function Book3D({ b, angle }: { b: Book; angle: MotionValue<number> }) {
  const pageShade = useTransform(angle, (a) => Math.min(1, Math.max(0, -a / 90)) * 0.22);
  return (
    <span className="book3d" style={{ "--tint": b.c[0] } as CSSProperties}>
      <span className="page" aria-hidden="true">
        <span className="page-kicker">Chapter one</span>
        <span className="page-lines" />
        <motion.span className="page-shade" style={{ opacity: pageShade }} />
      </span>
      <motion.span className="front" style={{ rotateY: angle }}>
        <span className="face face-front">
          <Cover b={b} />
        </span>
        <span className="face face-back" aria-hidden="true" />
      </motion.span>
    </span>
  );
}

const OPEN_ANGLE = -105;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Synced: the cover angle is a pure function of two signals, so it scrubs with
 * everything. progress opens the book as it zooms up (closed on the shelf, fully
 * open in the card) and closes it as it's dragged down or flies home. focus opens
 * only the centred book: swiping slides the next one in opening while the previous
 * one closes, following the finger.
 */
function BookSynced({ b }: { b: Book }) {
  const { progress, focus } = useZoomProgress();
  const angle = useTransform([progress, focus], ([p, f]: number[]) => OPEN_ANGLE * clamp01(p) * clamp01(f));
  return <Book3D b={b} angle={angle} />;
}

/**
 * Own timing: the book is told when things start and runs its own springs.
 * Only the visible book opens. Swiping to another book closes this one and opens
 * that one once the page settles. Closing shuts it fast enough to be closed
 * before it lands on the shelf. A close that interrupts an opening (or the other
 * way round) continues from the current angle and speed, because Motion's
 * animate() starts from where the value is; from fully open it starts fresh.
 */
function BookOwnTiming({ b }: { b: Book }) {
  const angle = useZoomValue("cover-angle", 0); // shared by the card and its flying copy
  useZoomEvent((e) => {
    const swing = (to: number, visualDuration: number, bounce: number) => {
      if (e.reducedMotion) angle.jump(to);
      else animate(angle, to, { type: "spring", visualDuration, bounce }).speed = e.timeScale;
    };
    switch (e.type) {
      case "opening":
        if (e.active) swing(OPEN_ANGLE, 0.8, 0.2);
        else swing(0, 0.35, 0); // neighbours stay (or go back to) closed
        break;
      case "activated":
        swing(OPEN_ANGLE, 0.7, 0.2);
        break;
      case "deactivated":
        swing(0, 0.35, 0);
        break;
      case "closing":
        swing(0, 0.2, 0);
        break;
    }
  });
  return <Book3D b={b} angle={angle} />;
}

/** The cover as a destination's hero, moving the way `mode` says while it flies. */
export function BookHero({ b, mode, className = "cover-slot" }: { b: Book; mode: HeroMode; className?: string }) {
  if (mode === "static") {
    // A plain asset: flies as a still snapshot, nothing inside it moves.
    return (
      <ZoomHero className={className} live={false}>
        <Cover b={b} />
      </ZoomHero>
    );
  }
  return <ZoomHero className={className}>{mode === "synced" ? <BookSynced b={b} /> : <BookOwnTiming b={b} />}</ZoomHero>;
}

/* ------------------------------------------------------------------ icons */

export const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
  </svg>
);
export const IconCheck = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8.5l3.2 3.2L13 4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);
