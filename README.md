# Zoom transition system (React + Motion)

> Continuing development? Read `HANDOFF.md` first.

A reusable version of the Book Store zoom: any element can be a source, any
content can be the destination, sources in a group become a swipeable set,
and closing sends every card back to its own source.

## Files

- `src/zoom/` — the system. Copy this folder into your project.
  - `ZoomProvider.tsx` — overlay, pager and the open/close orchestration
  - `ZoomSource.tsx` — wrap React content the zoom starts from
  - `ZoomHero.tsx` — mark the shared element inside destination content
  - `TemplateDestination.tsx` — use server-rendered HTML as the destination
  - `gestures.ts` — swipe paging, drag to dismiss, trackpad, clicks
  - `flight.ts` — the flying copy of the hero
  - `springs.ts` — SwiftUI-style springs (duration + bounce) mapped to Motion
  - `zoom.css` — required styles; theme with the `--zoom-*` properties
  - `corners.css` — optional: smoothed corners matched to Figma's iOS-style 60%
- `demo/` — three prototypes: the Book Store as shelves that page sideways
  (`BookStore.tsx`), the Book Store as a feed that pages up and down (`BookFeed.tsx`),
  and a design portfolio of long reads that opens into one continuous stream
  (`Portfolio.tsx`)
- `standalone/portfolio/` — the portfolio at its simplest: plain markup, one island, one
  stylesheet (`npm run build:portfolio` → `dist/portfolio.html`). Start here to map it onto a site.
- `standalone/portfolio-icons/` — a second prototype: every piece opens into one stream
  under section titles (Air Apps, personal projects, writing, then About with a call to
  action). Air Apps cards lead with a large image; the rest lead with an icon beside the
  title (→ `dist/portfolio-icons.html`). Its content lives in `content.html` and its settings
  in `mount.tsx`, so other prototypes can share them.
- `standalone/portfolio-sections/` — the same content with each section opening as one
  continuous card, and switchable delineations between works (→ `dist/portfolio-sections.html`).
  All are built by `standalone/build.py <folder>`, which inlines linked stylesheets, the
  script and SVG images, and `<!-- include path -->` directives (shared markup).
- `astro-example/` — how it drops into an Astro portfolio

Requires `react`, `react-dom` and `motion`.

## React usage

```tsx
import { ZoomProvider, ZoomSource, ZoomHero, useZoom } from "./zoom";
import "./zoom/zoom.css";

<ZoomProvider renderDestination={(id) => <ProjectDetail id={id} />}>
  <Grid />
</ZoomProvider>

// In Grid: anything can be a source
const { open } = useZoom();
<button onClick={() => open(p.slug)}>
  <ZoomSource id={p.slug} group="work"><img src={p.thumb} alt="" /></ZoomSource>
  <h3>{p.title}</h3>
</button>

// In ProjectDetail: mark what the source flies into
<ZoomHero><img src={p.hero} alt={p.title} /></ZoomHero>
```

`useZoomItem()` inside destination content gives `{ id, index, isActive, close }`.

## Motion inside the hero

Three ways for content to take part in a transition. The library supplies
signals; the motion itself is yours.

**1. Synced to the flight** — `useZoomProgress()` gives `{ progress, focus, phase, inFlight }`.
`progress` is a Motion value: 0 on the source, 1 fully open, continuous through
opening, closing, drags and interruptions (it overshoots with bounce, so clamp
if needed). `focus` is 1 while the item is the centred page and falls to 0 as it
slides a page away, following the finger. Map them to anything and it scrubs.

```tsx
const { progress, focus } = useZoomProgress();
// Opens as it zooms up, only while centred; swiping opens the next and closes this one.
const angle = useTransform([progress, focus], ([p, f]) => -105 * clamp(p, 0, 1) * clamp(f, 0, 1));
```

**2. On its own timing** — `useZoomEvent(handler)` is called at the start of
`"opening"` and `"closing"`, when each settles (`"opened"`, `"closed"`), and when
an item becomes or stops being the visible card (`"activated"`, `"deactivated"`,
after a swipe settles, an arrow key, or a tap on a neighbour). A
transition that turns another around arrives with `interrupted: true`. Events
also say whether the item is the visible one (`active`), whether reduced motion
is on, and the current `timeScale`. Animate a `useZoomValue(name, initial)`: it's
shared by the card and the hero's flying copy, so both show the same animation,
and Motion's `animate()` continues from the current value and speed, so an
interrupted opening simply turns into the close.

```tsx
const angle = useZoomValue("cover-angle", 0);
useZoomEvent((e) => {
  if ((e.type === "opening" && e.active) || e.type === "activated")
    animate(angle, -105, { type: "spring", visualDuration: 0.8, bounce: 0.2 });
  if (e.type === "closing" || e.type === "deactivated")
    animate(angle, 0, { type: "spring", visualDuration: 0.2 });
});
```

Handlers run once per item (from the card, not again from the flying copy).
Content can keep animating after the zoom lands. When closing, finish before the
item lands: at that point the source on the page takes over.

**3. Static** — `<ZoomHero live={false}>` flies a still snapshot. Heroes from plain
HTML (`data-zoom-hero`) always fly this way.

React heroes are live by default: while flying, the hero's own React content is
rendered into the flying copy. Style live heroes with their own classes; in
flight they sit outside the card (the `className` given to `ZoomHero` is kept).

## What belongs where

The library owns how things move between places: sources and groups, the zoom
and per-card return, flights, interruptions, gestures, springs, reduced motion,
focus and the progress signal. Your project owns what things look like and any
motion *inside* them (like the book opening), the data, the theme values, and any
tuning UI. Book-store-specific feel lives in the demo's props, not the library.

`zoom.css` keeps the two apart in three labelled parts: **mechanics** (required: positioning,
scrolling, hit-testing and visibility the script relies on; don't override), **default
look** (everything visual, driven by `--zoom-*` properties; theme or override freely), and
debug aids. The look isn't in a cascade layer on purpose: unlayered page resets such as
`button { background: transparent }` (Tailwind v3's preflight) would then beat it. The
library also hands the page information rather than looks where a layout needs it:
`data-zoom-section`, `data-zoom-section-start` / `-end` on stream cards, `--zoom-gap`,
`data-phase` on the root.

## Astro usage

React context doesn't cross islands, so either put the whole gallery in one
React island, or keep the markup in Astro and use one small island with `scan`
(see `astro-example/`):

- Sources: add `data-zoom-source="id"` (and `data-zoom-group`) to any element.
  Clicking it, or the link around it, opens the zoom. Modified clicks
  (cmd/ctrl) still follow the link, and without JavaScript it's a normal link.
- Destinations: `<template data-zoom-destination="id">` rendered by Astro, with
  `data-zoom-hero` on the shared element.

## Options worth knowing

- `timing` — `{ open, close, page, cancel, fade, fadeOut }`, each `{ duration, bounce }`
  with SwiftUI semantics. Defaults: open 0.5 s / bounce 0.15; close 1.75× faster
  (0.29 s) / bounce 0.15.
- `timeScale` — 0.2 for slow motion while tuning.
- `geometry` — card insets, gap and `maxCardWidth`; can be a function of the viewport size.
- `landing` — how a card sits on its source: `{ widthRatio, topOffset }`. Default is
  exactly the source's width, top-aligned; the Book Store uses `{ 0.86, 0.1 }`.
- `dismiss` — drag-to-dismiss feel: `{ distance, velocity, minDistance, pivotY, maxShrink, dimFade }`,
  plus which edges each gesture can close the card from:
  - `drag` — dragging with a finger (or the mouse): pull down from the top, or up from the bottom.
  - `wheel` — scrolling with a mouse wheel or trackpad past the top or bottom.

  By default only the top edge closes, for both gestures. Pulling up from the bottom
  is off: it's easy to do by accident at the end of a long read, and on phones it
  competes with the home indicator. Each edge can be switched on or off on its own;
  an edge you leave out keeps its default:

  ```tsx
  dismiss={{
    wheel: { bottom: true }, // scrolling closes past the top or the bottom
    drag: { top: false },    // dragging never closes
  }}
  ```

  `true`/`false` turn a gesture on or off at both edges; `"top"`, `"bottom"` and `"both"` also work.
  When an edge is off, that gesture just scrolls the card (with the browser's own bounce).
  `wheelDistance` sets how far past the edge you scroll to close (px, default 240).
  In vertical layouts (feed, stream), `wheelSideways: true` also closes on a sideways
  trackpad or wheel scroll. It's off by default: on desktop trackpads a sideways swipe
  mixes in vertical motion and momentum too unevenly to close dependably. Sideways touch
  and mouse drags close either way; a sideways scroll otherwise does nothing (and never
  reaches the browser's swipe-back).
  A swipe that runs into an edge never closes the card; a second swipe made at the
  edge does, and it's recognised right away: on a trackpad by the scroll speed
  dipping and picking up again (momentum only ever slows), on a mouse wheel by a
  short gap before the next spin. After a longer pause, a swipe starting within
  `wheelEdgeSlop` px of the edge (default 32) also counts.
- `debug` — draws tuning aids in each card: striped bands showing the wheel-dismiss
  edge zones (if any of a band is on screen, a swipe toward that edge can close the
  card). They brighten while the content is in the zone and again while a swipe is armed.
  Only edges with wheel dismissal on get a band.
- `paging` — swipe between a group's items (default true). Pass options to tune it:
  `{ swipeDistance: 40, atEdge: "new-swipe" }`. `swipeDistance` is how far (px) a trackpad
  or wheel swipe travels before it turns the page. `atEdge` (vertical pager) is what
  scrolling into the end of a card's content does: `"new-swipe"` stops there and a new
  swipe turns the page; `"continue"` turns it straight away and lets the swipe carry
  on into the next card's content, so the cards read as one continuous stream. How quickly a page turn
  settles is `timing.page` (default 0.5 s, no bounce).
- `layout` — `"pager"` (default) or `"stream"`. A stream lays a group's cards out as one
  continuous column, each card as tall as its content, scrolled natively like a document:
  no paging, nothing to push through between pieces. The card under the top third of the
  screen is the visible one (its source is the hidden one, and it's the one that flies
  home). Close with the close button (it stays in view while reading), Escape, or by
  dragging sideways (scrolling sideways too, with `dismiss.wheelSideways`). Made for long
  reads (case studies, essays):

  ```tsx
  <ZoomProvider layout="stream" flyHome="visible" groupOpacity={0.35} ...>
  ```

  Stream cards carry `data-zoom-section`, and `data-zoom-section-start` / `-end` at a
  section's first and last card; the column sets `--zoom-gap`. That's enough to join a
  section into one card in your own CSS (see `standalone/portfolio-sections`).

  Sections: give sources a section (`data-zoom-section="Writing"`, or `ZoomSource`'s
  `section` prop) and the stream shows that title above the first card of each section,
  so one group can hold projects, writing and an About card in one stream. The title is
  an `h2.zoom-stream-title` by default; `renderSectionTitle={(s) => <h2 className="…">{s}</h2>}`
  draws your own, e.g. the page's own section-title style. Titles fade with the close.
- `orientation` — how a pager's cards are laid out and swiped through:
  - `"horizontal"` (default): side by side. Swipe sideways to page; pull down to close.
  - `"vertical"`: stacked like a feed, one card per page. Swipe, drag or scroll up and
    down to page (Up/Down arrows too); drag a card sideways, either way, to close
    (Escape and the close button still work). A card's own content scrolls first;
    paging takes over at its top and bottom, and as with closing, a swipe that runs
    into the edge doesn't turn the page — a new swipe there does. `dismiss.drag` set to
    `false` turns the sideways drag close off; other edge settings don't apply. Tapping above or below the card pages, beside it closes. Cards don't
    bounce at their ends (a bounce made the next swipe hard to recognise).

  ```tsx
  <ZoomProvider orientation="vertical" geometry={{ top: 8, bottom: 8, side: 8, gap: 8 }} ...>
  ```
- `hideGroupWhileOpen` — hide the whole group on the page while open (default true).
- `groupOpacity` — instead of hiding the group, keep its other items on the page at this
  opacity (e.g. `0.35`); only the visible item's own source is hidden. They follow the
  visible card, dimming as it opens and returning to full as it lands. The page behind
  stays still while open (paging or scrolling on doesn't touch it); on close, the visible
  item's source is hidden at once for its card to land in, and the opened one returns.
- `flyHome` — `"group"` (default): closing sends every card back to its own source.
  `"visible"`: only the visible card flies home; the others stay where they are and fade
  with it (and fade in with it on open). Pair it with `groupOpacity` for a calm close:

  ```tsx
  <ZoomProvider orientation="vertical" flyHome="visible" groupOpacity={0.35} ...>
  ```
- `closeButton` — `true`, `false`, or `(close) => <YourButton/>`. Size and position it with
  `--zoom-close-size` (30px) and `--zoom-close-inset` (14px); to sit it concentric with the
  card's corner, make the inset the card radius minus half its size. In a stream it fades
  out as its card scrolls away.
- `history` — off by default. `{ mode: "session" }`: opening adds one history entry,
  swiping only updates the address, Back closes (for sets people flick through,
  like the books). `{ mode: "item" }`: every item visited adds an entry and Back
  steps back through them, then closes (for items that are places, like projects).
  `url: (id) => "/writing/" + id` gives each item a real address, so a reload or a
  shared link lands on that item's own static page. Defaults to `#id`.
- `container` — portal target; defaults to `document.body` as a fixed overlay (scroll is locked
  while open; where scrollbars take up space, their gutter is kept so the page doesn't shift).
- `background` — element made `inert` while open.
- Reduced motion is automatic: open and close become fades.

## Interrupting

Every transition can be turned around mid-flight, carrying its current speed:

- While opening: Escape, the close button, or a tap outside the card sends it back.
  A touch that starts during the open becomes a swipe or dismiss once it's open.
- While closing: tap any card or cover on its way home (or its source on the
  page) to bring the set back open, with that item as the visible card.

Internally, the shared zoom is folded into each card's own transform at the
moment of interruption (position and velocity), so the next spring starts
from exactly what's on screen.

## Building a new layout

The library owns how things move, so a new layout (portfolio or not) inherits every fix
to the motion. Guarded by `tests/e2e/flight-invariants.spec.ts`, against a plain harness
rather than any prototype:

- the crop between a source's shape and its hero's eases evenly with the motion;
- corner radii tween between source and hero in on-screen px, without a jump at landing;
- the hero's shadow fades with the flight and is never cut by the crop;
- after a tap or click nothing is left focused; keyboard users get focus moved and returned;
- the card's corner, the close button and anything inset on the card stay concentric;
- a backdrop filter is complete whenever a card is open, however light the dim.

What the page still decides, and how to keep it right:

- **Corner geometry: two numbers.** Set `--zoom-radius` (the card's corner, as in Figma)
  and `--zoom-inset` (how far in the image or icon sits). The card's corner, the close button
  (on the corner's centre: radius − `--zoom-close-size` / 2) and `.zoom-concentric`
  (radius − inset) follow. Put `zoom-concentric` on the hero and on the tile it flies from,
  so both ends share a corner; a more specific rule of your own setting `border-radius`
  wins over it, so leave radius off those elements.
- **Inset with padding, not margin**, on the destination's wrapper (`padding: var(--zoom-inset)`).
  The card contains margins too (`flow-root`), but padding keeps the inset part of the card.
- **Reading over the page.** Titles or anything else drawn between stream cards sit on the
  dimmed page; set `--zoom-backdrop-filter` (e.g. `blur(18px)`) so they read cleanly.
- **One-line metadata:** `text-wrap: pretty` (or any `text-wrap`) on paragraphs overrides
  `white-space: nowrap`; give one-line text `text-wrap: nowrap` itself.
- **Gestures:** sideways trackpad scrolling doesn't close by default (`dismiss.wheelSideways`).

## Development

```sh
npm install
npm run typecheck
npm run build:demo     # dist/index.html, the Book Store as one self-contained page
npx playwright install chromium   # once
npm test               # Playwright: builds the demo and harness, serves them, runs tests/e2e
```

## Notes

- The hero flies as a copy with its computed styles frozen, so it looks the
  same outside the card. A playing video will show as its current frame.
- A box-shadow on the hero element itself fades in as it opens and out as it closes,
  since the source it flies from usually has none.
- Corner radii (plain px, on the source and on the hero or their first child) blend from
  one end's to the other's in flight, in on-screen pixels, rather than scaling with the copy.
  A crop (e.g. a square thumbnail opening into a wide image) happens inside the flight with
  rounded corners; the hero's shadow wraps the visible shape and is never cut by it.
- Corner smoothing: load `corners.css` after `zoom.css`. It sets `--zoom-smooth` (1.23 where the
  browser draws `corner-shape`, else 1) and `--zoom-smooth-shape` (`superellipse(1.36)`, else
  `round`), a numerical fit to Figma's iOS-style 60% within 0.7% of the radius, falling back to
  the plain Figma radius. Every corner zoom.css derives uses them; for your own elements write
  `border-radius: calc(12px * var(--zoom-smooth)); corner-shape: var(--zoom-smooth-shape)`.
  Flights copy the hero's corner shape.
- Focus: opening moves focus into the card (the close button for keyboard users, the card
  itself after a tap or click, so touch screens don't draw a ring); closing returns it to
  the source for keyboard users and leaves nothing focused otherwise.
- If source and hero have different aspect ratios, the copy is cropped to the
  source and opens out to the hero, so nothing stretches.
- Every item in a group is rendered as a card while open. For very large
  groups, consider limiting the group or rendering lighter content.
