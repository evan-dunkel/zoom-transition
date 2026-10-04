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
- `demo/` — three prototypes: the Book Store as shelves that page sideways
  (`BookStore.tsx`), the Book Store as a feed that pages up and down (`BookFeed.tsx`),
  and a design portfolio of long reads that opens into one continuous stream
  (`Portfolio.tsx`)
- `standalone/portfolio/` — the portfolio at its simplest: plain markup, one island, one
  stylesheet (`npm run build:portfolio` → `dist/portfolio.html`). Start here to map it onto a site.
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
  dragging or scrolling sideways. Made for long reads (case studies, essays):

  ```tsx
  <ZoomProvider layout="stream" flyHome="visible" groupOpacity={0.35} ...>
  ```
- `orientation` — how a pager's cards are laid out and swiped through:
  - `"horizontal"` (default): side by side. Swipe sideways to page; pull down to close.
  - `"vertical"`: stacked like a feed, one card per page. Swipe, drag or scroll up and
    down to page (Up/Down arrows too); drag or scroll a card sideways, either way, to
    close (Escape and the close button still work). A card's own content scrolls first;
    paging takes over at its top and bottom, and as with closing, a swipe that runs
    into the edge doesn't turn the page — a new swipe there does. `dismiss.drag` and
    `dismiss.wheel` set to `false` turn the sideways close off; other edge settings
    don't apply. Tapping above or below the card pages, beside it closes. Cards don't
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
- `closeButton` — `true`, `false`, or `(close) => <YourButton/>`.
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
- If source and hero have different aspect ratios, the copy is cropped to the
  source and opens out to the hero, so nothing stretches.
- Every item in a group is rendered as a card while open. For very large
  groups, consider limiting the group or rendering lighter content.
