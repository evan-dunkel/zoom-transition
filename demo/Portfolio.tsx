import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ZoomHero, ZoomProvider, ZoomSource, useZoom, useZoomItem } from "../src/zoom";
import {
  PROJECTS,
  PROJECT_BY_ID,
  WRITING,
  WRITING_BY_ID,
  type ArtSpec,
  type Project,
  type Section,
  type Writing,
} from "./portfolioContent";

// The third prototype: a design portfolio. Projects and writing open into two
// continuous streams: every piece is a card as tall as its content, one after
// another, scrolled like a document with nothing to page or push through. The
// image sits on the card like the books' covers do, and the card grows out from
// behind it. Sideways, Escape or ✕ closes, and only the piece you're reading flies
// back to its spot on the index.

const WORK = "work";
const NOTES = "writing";

/* ------------------------------------------------------------------ generated images */

const BARS = [38, 62, 48, 80, 56, 92, 70];
const TILES = ["circle", "pill", "square", "arch", "dot", "circle", "square", "pill", "arch"];
const SPINES = [72, 88, 64, 94, 80, 58, 86, 70, 90, 76];
const WEIGHTS = [200, 350, 500, 650, 800];

/** A damped oscillation settling on a target: the spring the essays talk about. */
const SPRING_PATH = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const y = 1 - Math.exp(-5.2 * t) * Math.cos(2 * Math.PI * 2.1 * t);
    pts.push(`${(12 + t * 176).toFixed(1)},${(104 - y * 70).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
})();

/** Placeholder imagery drawn with CSS, sized by whatever box it sits in. */
function Art({ a }: { a: ArtSpec }) {
  const style = { "--a-bg": a.c[0], "--a-fg": a.c[1], "--a-ac": a.c[2] } as CSSProperties;
  let parts: ReactNode = null;
  switch (a.kind) {
    case "phones":
      parts = (
        <>
          <span className="ph ph-back" />
          <span className="ph ph-front" />
        </>
      );
      break;
    case "type":
      parts = (
        <>
          <span className="glyph">Aa</span>
          <span className="lines" />
        </>
      );
      break;
    case "bars":
      parts = (
        <span className="panel">
          {BARS.map((h, i) => (
            <span key={i} className="bar" style={{ "--h": `${h}%` } as CSSProperties} />
          ))}
        </span>
      );
      break;
    case "tiles":
      parts = (
        <span className="tiles">
          {TILES.map((t, i) => (
            <span key={i} className={`tile-shape s-${t}`} />
          ))}
        </span>
      );
      break;
    case "orbits":
      parts = (
        <>
          <span className="rings" />
          <span className="planet p1" />
          <span className="planet p2" />
        </>
      );
      break;
    case "spring":
      parts = (
        <svg viewBox="0 0 200 120" preserveAspectRatio="none">
          <line x1="12" y1="34" x2="188" y2="34" />
          <path d={SPRING_PATH} />
        </svg>
      );
      break;
    case "shelf":
      parts = (
        <span className="spines">
          {SPINES.map((h, i) => (
            <span key={i} className={i % 3 === 1 ? "spine alt" : "spine"} style={{ "--h": `${h}%` } as CSSProperties} />
          ))}
        </span>
      );
      break;
    case "breathe":
      parts = (
        <span className="words">
          {WEIGHTS.map((w) => (
            <span key={w} style={{ fontWeight: w }}>
              breathe
            </span>
          ))}
        </span>
      );
      break;
    case "draft":
      parts = (
        <span className="doc">
          <span className="doc-title" />
          <span className="doc-mark" />
          <span className="doc-lines" />
        </span>
      );
      break;
  }
  return (
    <span className={`art art-${a.kind}`} style={style} aria-hidden="true">
      {parts}
    </span>
  );
}

/* ------------------------------------------------------------------ index (sources) */

function Index() {
  const { open } = useZoom();
  return (
    <>
      <section className="pf-section" aria-labelledby="pf-work">
        <h2 id="pf-work" className="pf-label">Selected work</h2>
        <ul className="pf-work">
          {PROJECTS.map((p) => (
            <li key={p.id}>
              <button type="button" className="pf-tile" onClick={() => open(p.id)}>
                <ZoomSource id={p.id} group={WORK} as="span" className="pf-tile-art">
                  <Art a={p.art} />
                </ZoomSource>
                <span className="pf-tile-title">{p.title}</span>
                <span className="pf-tile-meta">
                  {p.kicker} · {p.year}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="pf-section" aria-labelledby="pf-notes">
        <h2 id="pf-notes" className="pf-label">Writing and experiments</h2>
        <ul className="pf-notes">
          {WRITING.map((w) => (
            <li key={w.id}>
              <button type="button" className="pf-row" onClick={() => open(w.id)}>
                <ZoomSource id={w.id} group={NOTES} as="span" className="pf-row-art">
                  <Art a={w.art} />
                </ZoomSource>
                <span className="pf-row-text">
                  <span className="pf-row-meta">
                    {w.kind} · {w.date}
                  </span>
                  <span className="pf-row-title">{w.title}</span>
                  <span className="pf-row-summary">{w.summary}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ destinations */

function Body({ sections }: { sections: Section[] }) {
  return (
    <>
      {sections.map((s, i) => (
        <section key={i} className="pf-body">
          {s.heading && <h3>{s.heading}</h3>}
          {s.paragraphs.map((p, k) => (
            <p key={k}>{p}</p>
          ))}
          {s.quote && <blockquote>{s.quote}</blockquote>}
          {s.figure && (
            <figure className="pf-figure">
              <span className="pf-figure-art">
                <Art a={s.figure.art} />
              </span>
              <figcaption>{s.figure.caption}</figcaption>
            </figure>
          )}
        </section>
      ))}
    </>
  );
}

/** The end of a piece: what comes next in this feed, or the way back. */
function Next({ title, kind, last }: { title?: string; kind: string; last: string }) {
  const { close } = useZoomItem();
  if (!title) {
    return (
      <footer className="pf-next">
        <p className="pf-next-label">{last}</p>
        <button type="button" className="pf-back" onClick={close}>
          Back to the index
        </button>
      </footer>
    );
  }
  return (
    <footer className="pf-next">
      <p className="pf-next-label">Next {kind}</p>
      <p className="pf-next-title">{title}</p>
      <p className="pf-next-hint">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M7 2v9M3 7.5l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        Keep scrolling
      </p>
    </footer>
  );
}

function ProjectPage({ p }: { p: Project }) {
  const { index } = useZoomItem();
  return (
    <article className="pf-page">
      <div className="pf-stage" style={{ "--tint": p.art.c[0] } as CSSProperties}>
        <ZoomHero className="pf-hero pf-hero-work">
          <Art a={p.art} />
        </ZoomHero>
      </div>
      <div className="pf-text">
        <p className="pf-eyebrow">
          Project {index + 1} of {PROJECTS.length} · {p.year}
        </p>
        <h2 className="pf-title">{p.title}</h2>
        <p className="pf-kicker">{p.kicker}</p>
        <p className="pf-lede">{p.summary}</p>
        <dl className="pf-facts">
          {p.facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <Body sections={p.sections} />
        <Next title={PROJECTS[index + 1]?.title} kind="project" last="That’s all four projects." />
      </div>
    </article>
  );
}

function WritingPage({ w }: { w: Writing }) {
  const { index } = useZoomItem();
  return (
    <article className="pf-page">
      <div className="pf-stage" style={{ "--tint": w.art.c[0] } as CSSProperties}>
        <ZoomHero className="pf-hero pf-hero-note">
          <Art a={w.art} />
        </ZoomHero>
      </div>
      <div className="pf-text">
        <p className="pf-eyebrow">
          {w.kind} · {w.date} · {w.minutes} min read
        </p>
        <h2 className="pf-title">{w.title}</h2>
        <p className="pf-lede">{w.summary}</p>
        <div className="pf-reading">
          <Body sections={w.sections} />
        </div>
        <Next title={WRITING[index + 1]?.title} kind="piece" last="That’s everything for now." />
      </div>
    </article>
  );
}

function Destination({ id }: { id: string }) {
  const p = PROJECT_BY_ID.get(id);
  if (p) return <ProjectPage p={p} />;
  return <WritingPage w={WRITING_BY_ID.get(id)!} />;
}

/* ------------------------------------------------------------------ app */

export function Portfolio({ switcher }: { switcher?: ReactNode }) {
  const phoneRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const [slow, setSlow] = useState(false);

  const compact = () => window.matchMedia("(max-width: 540px)").matches;
  return (
    <div className="stage">
      <div className="phone portfolio" ref={phoneRef}>
        <ZoomProvider
          layout="stream"
          flyHome="visible"
          groupOpacity={0.35}
          // Like the books: the card starts a little narrower than the image, just
          // behind it, and grows out from there.
          landing={{ widthRatio: 0.86, topOffset: 0.05 }}
          container={() => phoneRef.current}
          background={() => pageRef.current}
          renderDestination={(id) => <Destination id={id} />}
          history={{ mode: "session" }}
          getLabel={(id) => PROJECT_BY_ID.get(id)?.title ?? WRITING_BY_ID.get(id)?.title ?? id}
          timeScale={slow ? 0.2 : 1}
          geometry={() =>
            compact()
              ? { top: 8, bottom: 8, side: 8, gap: 12 }
              : { top: 24, bottom: 24, side: 18, gap: 20, maxCardWidth: 680 }
          }
          dim={() => parseFloat(getComputedStyle(phoneRef.current!).getPropertyValue("--dim-max")) || 0.3}
        >
          <main className="store pf" ref={pageRef}>
            <header className="store-head">
              <h1 className="pf-name">Ines Calder</h1>
              <button className="slowmo" type="button" aria-pressed={slow} onClick={() => setSlow(!slow)}>
                Slow motion
              </button>
            </header>
            {switcher}
            <p className="pf-intro">
              Product designer. I work on interfaces that move well and read well: transit, reading, health, and the
              systems behind them.
            </p>
            <p className="hint">
              Sample portfolio. Open a project or a piece of writing and keep scrolling: the next one follows. Swipe
              sideways, press Esc or ✕ to close.
            </p>
            <Index />
          </main>
        </ZoomProvider>
      </div>
    </div>
  );
}
