import { useMemo, useRef, useState, type CSSProperties } from "react";
import { animate, motion, useTransform, type MotionValue } from "motion/react";
import {
  ZoomHero,
  ZoomProvider,
  ZoomSource,
  useZoom,
  useZoomEvent,
  useZoomProgress,
  useZoomValue,
  type ZoomTiming,
} from "../src/zoom";
import { BOOKS, ROWS, bookId, type Book } from "./books";

/* ------------------------------------------------------------------ covers */

const TEXT_TOP = new Set(["arch", "waves", "split", "block"]);

function Cover({ b }: { b: Book }) {
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

/* ------------------------------------------------------------------ store (sources) *//* ------------------------------------------------------------------ store (sources) */

function Shelf({ title, books }: { title: string; books: Book[] }) {
  const { open } = useZoom();
  const headingId = `shelf-${bookId(books[0])}`;
  return (
    <section className="shelf" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <div className="row">
        {books.map((b) => (
          <button key={bookId(b)} type="button" className="book" aria-label={`${b.t} by ${b.a}`} onClick={() => open(bookId(b))}>
            <ZoomSource id={bookId(b)} group={title} as="span" className="cover-wrap">
              <Cover b={b} />
            </ZoomSource>
            <span className="b-title" aria-hidden="true">{b.t}</span>
            <span className="b-author" aria-hidden="true">{b.a}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ destination */

const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
  </svg>
);
const IconCheck = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8.5l3.2 3.2L13 4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

function BookDetail({ b, heroMode }: { b: Book; heroMode: HeroMode }) {
  const [wanted, setWanted] = useState(false);
  const year = b.date.slice(-4);
  const month = b.date.split(" ")[0];
  return (
    <div className="detail" style={{ "--tint": b.c[0] } as CSSProperties}>
      <div className="hero">
        {heroMode === "static" ? (
          // A plain asset: flies as a still snapshot, nothing inside it moves.
          <ZoomHero className="cover-slot" live={false}>
            <Cover b={b} />
          </ZoomHero>
        ) : (
          <ZoomHero className="cover-slot">
            {heroMode === "synced" ? <BookSynced b={b} /> : <BookOwnTiming b={b} />}
          </ZoomHero>
        )}
      </div>
      <div className="info">
        <h2 className="c-title">{b.t}</h2>
        <p className="c-author">{b.a}</p>
        <p className="c-genre">{b.g}</p>
        <div className="actions">
          <button type="button" className="want" aria-pressed={wanted} onClick={() => setWanted(!wanted)}>
            {wanted ? <IconCheck /> : <IconPlus />}
            <span>Want to Read</span>
          </button>
          <span className="price">{b.price} e-book</span>
        </div>
        <dl className="stats">
          <div>
            <dt>Rating</dt>
            <dd>
              {b.r.toFixed(1)} <span className="star" aria-hidden="true">★</span>
              <small>{b.n} ratings</small>
            </dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>{b.p}<small>pages</small></dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd>{year}<small>{month}</small></dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>EN<small>English</small></dd>
          </div>
        </dl>
        <section className="about">
          <h3>About this book</h3>
          <p>{b.d}</p>
        </section>
        <section className="details">
          <h3>Details</h3>
          <dl className="rows">
            <div><dt>Publisher</dt><dd>{b.pub}</dd></div>
            <div><dt>Released</dt><dd>{b.date}</dd></div>
            <div><dt>Print length</dt><dd>{b.p} pages</dd></div>
            <div><dt>Genre</dt><dd>{b.g}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ timing controls */

type Tuning = { open: number; openBounce: number; ratio: number; bounce: number; slop: number };
const TUNING_KEY = "bookzoom-timing-v3"; // bumped when the defaults change
function loadTuning(): Tuning {
  const fallback = { open: 0.5, openBounce: 0.15, ratio: 1.75, bounce: 0.15, slop: 32 };
  try {
    const saved = JSON.parse(localStorage.getItem(TUNING_KEY) || "null");
    return { ...fallback, ...(saved ?? {}) };
  } catch {
    return fallback;
  }
}
const num = (v: string, fallback: number, min: number, max: number) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* ------------------------------------------------------------------ app */

export function BookStore() {
  const phoneRef = useRef<HTMLDivElement>(null);
  const storeRef = useRef<HTMLElement>(null);
  const [slow, setSlow] = useState(false);
  const [heroMode, setHeroMode] = useState<HeroMode>("own");
  const [historyMode, setHistoryMode] = useState<"session" | "item" | "off">("session");
  const [showZones, setShowZones] = useState(true);
  const [fields, setFields] = useState(() => {
    const t = loadTuning();
    return { open: String(t.open), openBounce: String(t.openBounce), ratio: String(t.ratio), bounce: String(t.bounce), slop: String(t.slop) };
  });
  const tuning: Tuning = {
    open: num(fields.open, 0.5, 0.1, 3),
    openBounce: num(fields.openBounce, 0.15, 0, 0.6),
    ratio: num(fields.ratio, 1.75, 0.25, 4),
    bounce: num(fields.bounce, 0.15, 0, 0.4),
    slop: num(fields.slop, 32, 0, 400),
  };
  const update = (key: keyof typeof fields, value: string) => {
    const next = { ...fields, [key]: value };
    setFields(next);
    try {
      localStorage.setItem(
        TUNING_KEY,
        JSON.stringify({
          open: num(next.open, 0.5, 0.1, 3),
          openBounce: num(next.openBounce, 0.15, 0, 0.6),
          ratio: num(next.ratio, 1.75, 0.25, 4),
          bounce: num(next.bounce, 0.15, 0, 0.4),
          slop: num(next.slop, 32, 0, 400),
        }),
      );
    } catch {}
  };
  const timing: Partial<ZoomTiming> = useMemo(
    () => ({
      open: { duration: tuning.open, bounce: tuning.openBounce },
      close: { duration: tuning.open / tuning.ratio, bounce: tuning.bounce },
      fadeOut: { duration: 0.35 / tuning.ratio, bounce: 0 },
    }),
    [tuning.open, tuning.openBounce, tuning.ratio, tuning.bounce],
  );
  const compact = () => window.matchMedia("(max-width: 540px)").matches;

  return (
    <div className="stage">
      <div className="phone" ref={phoneRef}>
        <ZoomProvider
          container={() => phoneRef.current}
          background={() => storeRef.current}
          renderDestination={(id) => <BookDetail b={BOOKS.get(id)!} heroMode={heroMode} />}
          landing={{ widthRatio: 0.86, topOffset: 0.1 }}
          history={historyMode === "off" ? false : { mode: historyMode }}
          dismiss={{ wheelEdgeSlop: tuning.slop }}
          debug={showZones}
          getLabel={(id) => BOOKS.get(id)?.t ?? id}
          timing={timing}
          timeScale={slow ? 0.2 : 1}
          geometry={() => (compact() ? { top: 8, bottom: 8, side: 18, gap: 8 } : { top: 52, bottom: 14, side: 18, gap: 8 })}
          dim={() => parseFloat(getComputedStyle(phoneRef.current!).getPropertyValue("--dim-max")) || 0.3}
        >
          <main className="store" ref={storeRef}>
            <header className="store-head">
              <h1>Book Store</h1>
              <button className="slowmo" type="button" aria-pressed={slow} onClick={() => setSlow(!slow)}>
                Slow motion
              </button>
            </header>
            <p className="hint">Tap a cover. Swipe sideways to browse the shelf, drag down to close.</p>
            <div className="tune">
              <label>
                Open <input type="number" inputMode="decimal" min={0.1} max={3} step={0.05} value={fields.open} onChange={(e) => update("open", e.target.value)} /> s
              </label>
              <label>
                Open bounce <input type="number" inputMode="decimal" min={0} max={0.6} step={0.05} value={fields.openBounce} onChange={(e) => update("openBounce", e.target.value)} />
              </label>
              <label>
                Close <input type="number" inputMode="decimal" min={0.25} max={4} step={0.05} value={fields.ratio} onChange={(e) => update("ratio", e.target.value)} />× faster
              </label>
              <label>
                Close bounce <input type="number" inputMode="decimal" min={0} max={0.4} step={0.05} value={fields.bounce} onChange={(e) => update("bounce", e.target.value)} />
              </label>
              <output>Close takes {(tuning.open / tuning.ratio).toFixed(2)} s</output>
              <label>
                Book in flight
                <select value={heroMode} onChange={(e) => setHeroMode(e.target.value as HeroMode)}>
                  <option value="own">Own timing</option>
                  <option value="synced">Synced to flight</option>
                  <option value="static">Static</option>
                </select>
              </label>
              <label>
                Edge zone <input type="number" inputMode="numeric" min={0} max={400} step={4} value={fields.slop} onChange={(e) => update("slop", e.target.value)} /> px
              </label>
              <label className="check">
                <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} /> Show edge zones
              </label>
              <label>
                History
                <select value={historyMode} onChange={(e) => setHistoryMode(e.target.value as "session" | "item" | "off")}>
                  <option value="session">Open and closed only</option>
                  <option value="item">Every book</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
            {ROWS.map((row) => (
              <Shelf key={row.title} title={row.title} books={row.books} />
            ))}
          </main>
        </ZoomProvider>
      </div>
    </div>
  );
}
