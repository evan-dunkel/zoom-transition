import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ZoomProvider, ZoomSource, useZoom, useZoomItem } from "../src/zoom";
import { BOOKS, bookId, type Book } from "./books";
import { BookHero, Cover, type HeroMode } from "./BookParts";
import { PagingControls, usePagingTuning } from "./PagingControls";

// The second prototype: every book in one vertical feed. The store is a grid of
// covers; a cover opens into a full-height card, and the feed pages up and down
// through every book, one card per swipe. Sideways closes.

const ALL = [...BOOKS.values()];
const GROUP = "feed";

/* ------------------------------------------------------------------ grid (sources) */

function Grid() {
  const { open } = useZoom();
  return (
    <ul className="grid" aria-label="All books">
      {ALL.map((b) => (
        <li key={bookId(b)}>
          <button type="button" className="tile" aria-label={`${b.t} by ${b.a}`} onClick={() => open(bookId(b))}>
            <ZoomSource id={bookId(b)} group={GROUP} as="span" className="cover-wrap">
              <Cover b={b} />
            </ZoomSource>
            <span className="t-title" aria-hidden="true">{b.t}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ destination */

const IconBookmark = ({ filled }: { filled: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <path
      d="M6 3.5h10a1 1 0 0 1 1 1v14l-6-4-6 4v-14a1 1 0 0 1 1-1z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      fill={filled ? "currentColor" : "none"}
    />
  </svg>
);

/** One book as a full-height card: the cover up top, details along the bottom, a rail of stats on the right. */
function BookReel({ b, heroMode }: { b: Book; heroMode: HeroMode }) {
  const { index } = useZoomItem();
  const [wanted, setWanted] = useState(false);
  return (
    <div className="reel" style={{ "--tint": b.c[0] } as CSSProperties}>
      <p className="reel-count" aria-hidden="true">
        {index + 1} / {ALL.length}
      </p>
      <div className="reel-hero">
        <BookHero b={b} mode={heroMode} className="reel-cover" />
      </div>
      <div className="reel-foot">
        <div className="reel-info">
          <h2 className="reel-title">{b.t}</h2>
          <p className="reel-author">{b.a}</p>
          <p className="reel-meta">
            {b.g} · {b.date.slice(-4)} · {b.price}
          </p>
          <p className="reel-about">{b.d}</p>
        </div>
        <ul className="reel-rail" aria-label="About this book">
          <li>
            <span className="rail-icon" aria-hidden="true">★</span>
            <span className="rail-value">{b.r.toFixed(1)}</span>
            <span className="rail-label">{b.n}</span>
          </li>
          <li>
            <span className="rail-icon rail-pages" aria-hidden="true">{b.p}</span>
            <span className="rail-label">pages</span>
          </li>
          <li>
            <button type="button" className="rail-want" aria-pressed={wanted} onClick={() => setWanted(!wanted)}>
              <span className="rail-icon" aria-hidden="true">
                <IconBookmark filled={wanted} />
              </span>
              <span className="rail-label">{wanted ? "Saved" : "Want"}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ app */

export function BookFeed({ switcher }: { switcher?: ReactNode }) {
  const phoneRef = useRef<HTMLDivElement>(null);
  const storeRef = useRef<HTMLElement>(null);
  const [slow, setSlow] = useState(false);
  const [heroMode, setHeroMode] = useState<HeroMode>("synced");
  const [wheelSideways, setWheelSideways] = useState(false);
  const paging = usePagingTuning("feed-paging-v1");
  const compact = () => window.matchMedia("(max-width: 540px)").matches;

  return (
    <div className="stage">
      <div className="phone feed" ref={phoneRef}>
        <ZoomProvider
          orientation="vertical"
          // Calm close: only the visible book flies home; the grid stays behind, dimmed.
          flyHome="visible"
          timing={paging.timing}
          paging={paging.paging}
          dismiss={{ wheelSideways }}
          groupOpacity={0.35}
          container={() => phoneRef.current}
          background={() => storeRef.current}
          renderDestination={(id) => <BookReel b={BOOKS.get(id)!} heroMode={heroMode} />}
          landing={{ widthRatio: 1, topOffset: 0.3 }}
          history={{ mode: "session" }}
          getLabel={(id) => BOOKS.get(id)?.t ?? id}
          timeScale={slow ? 0.2 : 1}
          geometry={() =>
            compact()
              ? { top: 8, bottom: 8, side: 8, gap: 8 }
              : { top: 24, bottom: 24, side: 18, gap: 12, maxCardWidth: 460 }
          }
          dim={() => parseFloat(getComputedStyle(phoneRef.current!).getPropertyValue("--dim-max")) || 0.3}
        >
          <main className="store" ref={storeRef}>
            <header className="store-head">
              <h1>Book Store</h1>
              <button className="slowmo" type="button" aria-pressed={slow} onClick={() => setSlow(!slow)}>
                Slow motion
              </button>
            </header>
            {switcher}
            <p className="hint">Tap a cover. Swipe up and down to browse every book, drag sideways to close.</p>
            <div className="tune">
              <label>
                Book in flight
                <select value={heroMode} onChange={(e) => setHeroMode(e.target.value as HeroMode)}>
                  <option value="synced">Synced to flight</option>
                  <option value="own">Own timing</option>
                  <option value="static">Static</option>
                </select>
              </label>
              <label>
                <input id="wheel-sideways" type="checkbox" checked={wheelSideways} onChange={(e) => setWheelSideways(e.target.checked)} /> Sideways scroll closes (trackpad)
              </label>
            </div>
            <PagingControls tuning={paging} />
            <Grid />
          </main>
        </ZoomProvider>
      </div>
    </div>
  );
}
