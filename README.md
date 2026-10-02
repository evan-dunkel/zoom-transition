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
- `demo/` — the Book Store, rebuilt on the system
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
  which edges a drag can close from (`drag`: `"top"`, `"bottom"`, `"both"` (default) or `false`;
  at the top you pull down, at the bottom you pull up),
  plus scrolling to dismiss with a mouse wheel or trackpad: `wheel` (`"top"`, `"bottom"`,
  `"both"` (default) or `false`) and `wheelDistance` (px of scrolling past the edge, default 240).
  A swipe that runs into an edge never closes the card; a second swipe made at the
  edge does, and it's recognised right away: on a trackpad by the scroll speed
  dipping and picking up again (momentum only ever slows), on a mouse wheel by a
  short gap before the next spin. After a longer pause, a swipe starting within
  `wheelEdgeSlop` px of the edge (default 32) also counts.
- `debug` — draws tuning aids in each card: striped bands showing the wheel-dismiss
  edge zones (if any of a band is on screen, a swipe toward that edge can close the
  card). They brighten while the content is in the zone and again while a swipe is armed.
- `paging` — swipe between a group's items (default true).
- `hideGroupWhileOpen` — hide the whole group on the page while open (default true).
- `closeButton` — `true`, `false`, or `(close) => <YourButton/>`.
- `history` — off by default. `{ mode: "session" }`: opening adds one history entry,
  swiping only updates the address, Back closes (for sets people flick through,
  like the books). `{ mode: "item" }`: every item visited adds an entry and Back
  steps back through them, then closes (for items that are places, like projects).
  `url: (id) => "/writing/" + id` gives each item a real address, so a reload or a
  shared link lands on that item's own static page. Defaults to `#id`.
- `container` — portal target; defaults to `document.body` as a fixed overlay (scroll is locked while open).
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

## Notes

- The hero flies as a copy with its computed styles frozen, so it looks the
  same outside the card. A playing video will show as its current frame.
- If source and hero have different aspect ratios, the copy is cropped to the
  source and opens out to the hero, so nothing stretches.
- Every item in a group is rendered as a card while open. For very large
  groups, consider limiting the group or rendering lighter content.
