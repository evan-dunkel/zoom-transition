# Zoom transition library — handoff notes

Read this first when continuing work in a new chat. `README.md` is the user-facing
API guide; this file is the "how it works, why, and what's left" companion.

## 1. Goal and context

- Owner: a designer (comfortable reading code at a high level) building a personal
  portfolio: 3–4 projects and 4–10 writings, all opened with this transition.
- Stack decided: **Astro** (static output) + one **React** island + **Motion**
  (`motion` npm package, v13.x, imported from `motion/react`), **TypeScript**.
  Hosting: Cloudflare static assets (Pages or Workers static assets; the user
  calls it "Cloudflare Sites" — no product by that name was found). Goal: minimal
  JS, understandable code, free hosting.
- Reference: Apple Books store "zoom" transition (iOS). The user supplied screen
  recordings; key observations: the whole card (with metadata) scales uniformly
  from the source; the cover flies on its own path; neighbours zoom with the
  pager; closing sends every card back to its own slot.
- The live demo is the "Book Store" (`demo/`), published as a claude.ai artifact.
  It is a single page that fills the window; `.phone` (no longer drawn as a phone) is the `container`.
  A Shelves / Feed / Portfolio switch picks one of three prototypes: shelves paging
  sideways (the original), a grid of every book opening into a vertical, TikTok-style
  feed, and the feed adapted to a sample design portfolio (projects + writing).

## 2. Repository layout

```
src/zoom/            the library (copy into a project)
  ZoomProvider.tsx   overlay, pager, all choreography, history, contexts/hooks (~1.5k lines)
  gestures.ts        touch/mouse drag, paging, wheel/trackpad dismiss, clicks, debug flags
  flight.ts          flying hero copies (fit/crop, retarget, offset, clip, snapshots)
  springs.ts         SwiftUI-style spring specs -> Motion physics; rubber band; projection
  ZoomSource.tsx     React source wrapper (registers element, data-zoom-react-source)
  ZoomHero.tsx       marks the destination's shared element; registers React content (live)
  TemplateDestination.tsx  destination from <template data-zoom-destination="id">
  zoom.css           required styles + debug styles; theme with --zoom-* vars
  index.ts           public exports
demo/                main.tsx (layout switch), BookStore.tsx (shelves), BookFeed.tsx (vertical
                     feed), BookParts.tsx (covers, 3D book), books.ts, Portfolio.tsx +
                     portfolioContent.ts (portfolio prototype), demo.css
standalone/portfolio/ the portfolio at its simplest (plain HTML + templates + one island), built
                     to dist/portfolio.html by its build.py; the reference for mapping onto a site
astro-example/       untested sketch: Astro page + ZoomRoot island using `scan` + templates
test/scan.*          plain-HTML (Astro-style) harness for scan + templates (fixed overlay)
tests/e2e/           Playwright test suite (`npm test`), asserting (see §9)
tests/playwright/    ad-hoc regression scripts used during development (see §9)
build.py             esbuild bundle -> single self-contained HTML (dist/index.html)
playwright.config.ts builds demo + harness, serves the repo root on :8765
```

Build: `npm install`, `npm run typecheck`, `npm run build:demo` (demo HTML), `npm test`.

## 3. Architecture (layers)

1. **Engine** (generic "how things move"): choreography in `ZoomProvider`,
   `flight.ts`, `gestures.ts`, `springs.ts`.
2. **Adapters**: React components/hooks; Astro path via `scan` (plain-HTML sources
   with `data-zoom-source` / `data-zoom-group`) and `TemplateDestination`.
3. **App/content** (never in the library): destination design, hero-internal
   motion (e.g. the book opening), data, theme values, tuning UI.

Rule of thumb agreed with the user: if it would behave the same for a portfolio
project tile, it's library; if it mentions books, it's app.

## 4. Core mechanics and invariants

### Springs (`springs.ts`)
- Specs are SwiftUI `{ duration, bounce }`. `springPhysics` converts to
  stiffness `(2π/d)²`, damping `4π(1−bounce)/d` (mass 1). **Always pass
  stiffness/damping to Motion** — Motion's own `duration` means total settle
  time (different curve).
- `springTo(value, to, spec, {velocity, restDelta, speed})` wraps `animate()`.
  Omit `velocity` to keep the value's current velocity (used for retargeting).
- Rest thresholds `REST`: px 0.25, scale 0.0008; closing lands at 0.5 px /
  0.0015 (shorter tail). Opacity 0.002.
- Rubber band = UIScrollView constant 0.55; flick projection with rate 0.998.
- Motion animations that are stopped/replaced **never resolve** their promise.

### Two motion "modes" (in `S.mode`)
- **zoom**: one transform on the whole pager (`zx`, `zy`, `zs` on `.zoom-zoomer`,
  origin 0 0) + `track` on `.zoom-track` (its x, or its y in a vertical pager). Used for the first open from idle,
  the resting open state, drag-to-dismiss, cancel.
- **cards**: each card has its own `cv.x/y/s/o` (origin 0 0, relative to its
  untransformed slot `P = slot(j)`: `(track + j*step, L.top)`, or `(L.side, track + j*step)` vertically). Used for closing and
  turning transitions around.
- `bake(zoomVelocity?)` folds the zoom (and the track) into each card's values,
  **preserving on-screen position and velocity** (product rule), then resets the
  zoom to identity. This is what makes interruptions seamless.
- `transitionCards(target: "sources" | "open", index, zoomVelocity?, {towardTargetOnly})`
  is the universal "go from wherever you are to the sources / to open". Used by
  close, reopen (turn a close around), and re-aiming when the page scrolls
  mid-close. Landed cards are skipped when target is "sources".

### Generations
- Every transition does `gen = ++S.gen`; completion callbacks check `gen === S.gen`.
  Required because replaced Motion animations never resolve.

### Phases
`idle → opening → open → closing → idle`, plus `closing → opening` (reopen) and
`opening → closing` (close mid-open). `root.dataset.phase` mirrors it (CSS uses it:
during `closing` the root ignores pointer events except cards/clones so the page
behind is live and a tap can reopen).

### Geometry
- `computeLayout()` from the root's size + `geometry` (side/gap/top/bottom/maxCardWidth).
- `zoomOnto(rect)` = where a whole card sits when "on" a source: width
  `rect.w * landing.widthRatio`, top `rect.y - rect.w * landing.topOffset`.
  Library default `{1, 0}`; demo uses `{0.86, 0.1}` (matches the recording).

### Flights (`flight.ts`)
- A flight is a copy of the destination hero drawn in `.zoom-flight`, moved with
  `cx, cy, s` (centre + uniform scale). `fit(rect)` = cover-fit scale + crop
  insets, so a square source can open into a wide hero without stretching.
- `retarget(rect)` re-bases from the current state (springs keep velocity).
- Flight DOM: `.zoom-clone` > `.zoom-clone-shadow` + `.zoom-clone-window` > copy (and live
  host). The crop (aspect change between source and hero) shrinks the window to the
  visible part with `overflow: hidden`, the blended radius and the hero's `corner-shape`;
  the shadow layer takes the same inset, so it wraps the visible shape. Uncropped, the
  window clips nothing (3D overhangs survive). The only clip-path left on the clone is the
  scroll-follow band. (The crop used to be a clip-path on the clone: it cut the shadow and
  squared the cropped corners, visible on writing thumbnails.)
- Shadow: the hero element's own `box-shadow` (read in `measureHero`) is moved off the
  copy onto a `.zoom-clone-shadow` layer behind it, whose opacity follows the item's
  `progress` (`shadowOpacity`). Sources rarely have the hero's shadow, so carried at
  full strength it popped on at take-off and off at landing; now it fades in with the
  open and out with the close, continuously through reversals. Only the hero's own
  shadow; shadows on elements inside it fly as they are.
- Corners: the copy is scaled as a whole, which scaled its corners too (a 14 px corner
  read ~10 px mid-flight, 1 px for a thumbnail, then jumped on landing). The provider
  passes each end's on-screen radius (`radiusOf`: the element's own px radius, else its
  first child's; the source on the page, the hero at its card's scale) and the flight
  blends them by the same scale progress as the crop, writing `radius / scale` to the
  copy, live host, shadow layer and clip. `retarget(rect, radius)` carries on from the
  current corner. Non-px radii (percentages) are left alone.
- `offset()` (added every frame): follows **content scrolled mid-flight**
  (`y = -(scrollNow - scroll0) * zs * cv.s`) and **paging mid-flight**
  (`(track - track0) * zs` along the pager's axis), so the hand-over is pixel-exact.
  Scroll positions are read only in scroll events (`flightScrollNow`), never mid-frame.
- `clip()` band: once following scrolled content, cut at the card's top/bottom.
- Clip-path rule: only clip sides meant to be clipped; other sides use
  `-OUTSIDE` (negative inset) so overhangs/shadows/3D aren't cut (this fixed a
  flicker of the book's open cover).
- Writes are coalesced to one per frame via Motion's `frame.render`.
- Snapshots: live heroes get a plain `cloneNode` (shown ~1 frame until the live
  React content mounts, then `dropSnapshot`). Static heroes get a **frozen**
  snapshot (all computed styles inlined; expensive) cached per hero via
  `prepareSnapshot`, pre-built in idle time after open (`prefreezeStaticHeroes`).
- **Live heroes**: `ZoomHero` registers its React children; while flying they're
  rendered via portal into the flight (`LiveFlights` component — its own state,
  so adding/removing a flight doesn't re-render every card; this removed a
  dropped frame per landing).

### Progress, focus, events, shared values (content signals)
- `useZoomProgress()` → `{progress, focus, phase, inFlight}` (Motion values).
  `progress` is **card-based**: `(cardScale − sLand)/(1 − sLand)` (flight-based
  progress jumped at the zoom→cards hand-over). `focus` = 1 when centred page,
  falls to 0 one page away (follows the swipe).
- `useZoomEvent(handler)`: `opening | opened | closing | closed | activated |
  deactivated`, with `interrupted`, `active`, `reducedMotion`, `timeScale`.
  Handlers run **once per item** (only the card instance subscribes, never the
  flying copy).
- `useZoomValue(name, initial)`: Motion value shared by the card and its flying
  copy; reset to `initial` on open from rest.

### Performance discipline
- In transitions: **read everything first, then write** (rects, metrics,
  snapshots, root rect once). Interleaving caused per-card layout recalcs.
- Release of a drag previously blocked ~90 ms (style freezing for every hero);
  now no long task in headless Chrome.
- `will-change` only on `.zoom-clone`; zoomer/track rely on transforms
  (avoids blurry text after scaling up).
- Cards are a memoised `ZoomCard`: paging re-renders only the two cards whose
  `active` changed, not every destination. Card/hero context values are memoised per
  card. A new `renderDestination` (parent re-render) still re-renders all cards,
  which is what makes content changes show.
- Closures created once (`close`, via `useCallback([])`) must read state from `S` or
  `latest`, never from render-scoped values. `fixed` used to be read that way, so
  closing a fixed overlay never unlocked page scrolling; it now lives in `S.fixed`.

### Sources on the page
- While open, the whole group is hidden on the page (`hideGroupWhileOpen`,
  default true); during close every source stays hidden until its card lands.
- `groupOpacity` (captured per session in `S.groupOpacity`): the visible item's source
  gets `data-zoom-hidden`, the others `data-zoom-dimmed` with `--zoom-group-opacity`
  (CSS in zoom.css). `followVisible()`, called from `updateDerived`, sets the variable
  to `1 − (1 − g) · p` where p is the visible card's progress (the fade with reduced
  motion), so the group dims as a card opens and returns as it lands. `markGroup` /
  `unmarkGroup` apply and clean up. Each source also has a share (`presenceOf(id)`, a
  motion value multiplied in): 0 for the hidden one, 1 for the rest. The page behind
  stays still while open: changing the visible item (a page turn, scrolling a stream
  on) doesn't touch it (a fading swap was distracting while reading). On close,
  `showHiddenSourceFor(S.index)` swaps at once: the visible item's source is hidden for
  its card to land in and the one hidden since opening (`S.hiddenAt`) comes back. A
  landing card's source gets its share back at once.
- `flyHome: "visible"` (`S.flyVisible`): in `transitionCards`, cards other than the
  visible one don't fly. Closing leaves them where the bake put them; reopening
  springs them back to their slots. `followVisible()` sets their `cv.o` to p², so they
  fade in on open, fade under a dismiss drag, and fade out on close.
- `revealSource` only scrolls if the active source is cut off, **never toggles
  scroll-snap** (re-enabling snap caused a ~10 px jump after landing in Safari).
- Sources ordered by DOM position (`compareDocumentPosition`).

### Page state while open (fixed overlay)
- `lockScroll`/`unlockScroll`: `overflow: hidden` on `<html>`, plus
  `scrollbar-gutter: stable` when scrollbars take up space, so the page (and the
  sources cards land on) don't shift sideways. Previous inline styles are restored.
- Unmounting the provider while not idle (route change, Astro page swap) restores
  scrolling, the background's `inert`, hidden sources, and removes flights.

### Card DOM
```
.zoom-card            transparent rounded clip (transforms, opacity)
  .zoom-card-scroll   scroller (container-type: inline-size)
    .zoom-card-content  card surface: background + radius + overflow: clip
      .zoom-close-bar   sticky, zero-height; holds the close button
      {renderDestination(id)}
      [debug edge-zone bands]
```
The surface lives inside the scroller so the browser's native overscroll bounce
moves the whole card (no seam). Do not move the background back onto `.zoom-card`.

### History (`history` prop)
- `session`: one entry on open; paging replaces the URL; Back closes.
- `item`: one entry per item visited; Back steps back, then closes.
- UI close calls `history.go(-depth)` and ignores the resulting popstate;
  `pendingPush` defers pushes until our own Back lands. Default URL `#id`; on the
  portfolio use real paths (`/writing/slug`) so reload lands on the static page.

### Gestures (`gestures.ts`)
- Touch uses touch events (decide axis on first move so native scroll and
  dismiss can coexist); mouse uses pointer events. Motion's drag can't do this.
- Drag dismiss from **top (pull down) and, when enabled, bottom (pull up)** (`dismiss.drag`),
  only if the drag starts at that edge. Pivot mirrors for bottom pulls.
- Per-edge options: `dismiss.drag` and `dismiss.wheel` take `ZoomEdges` (`true`/`false`,
  `"top"`/`"bottom"`/`"both"`, or `{ top?, bottom? }` where a missing edge keeps its
  default). **Default is top only** (`DEFAULT_EDGES`) for both: bottom pulls are easy
  to trigger at the end of a long read and compete with the iPhone home indicator.
  The provider resolves them once per `dismiss` prop (`resolveEdges`, cached by
  identity) to `{ top, bottom }`; gestures only ever see that form. A disabled edge
  never arms or pulls; the gesture is left to native scrolling.
  Release hands the spring the **full zoom velocity incl. scale**.
- Paging: rubber band at ends, projection picks the page (±1), keyboard arrows
  page **also while opening** (flights follow the track), trackpad horizontal
  swipe pages once per swipe (40 px of travel).
- Stream (`layout: "stream"`, `L.stream`, implies `L.vertical`): the cards render in a
  `.zoom-stream` column (absolute, inset 0, the only scroller; flex column; padding
  `top`, `rowGap` = gap) instead of the track; cards are `position: relative`, content
  height, `overflow: clip` (so each card's sticky close bar sticks to the column), none
  inert. `slot(j)` = the card's `offsetLeft/offsetTop` less the column's `scrollTop`
  (so bake and transitionCards work unchanged); `trackAt` = 0; the open scrolls the
  column so the card is at `top` (`scrollStreamTo`) and zooms from `slot(index)`.
  A scroll listener (once per frame, only while open) makes the card under the top
  third the visible one via `setIndex(i, quiet)`: no focus move or announcement, and
  history replaces rather than pushes. `page(d)` scrolls instead (popstate). Flights
  following scroll use the column (`scrollerOf`); their clip is the column's band.
  Each card's sticky close bar fades over the last 64 px as its card's bottom edge
  reaches the button (set in the same per-frame scroll handler), instead of being cut
  off. `.zoom-card-content` is `display: flow-root` so a destination's top margin stays
  inside its card (in a stream nothing else contains it, and the card's surface started
  below the margin, leaving the image flush with the top).
  Wheel gestures in vertical layouts are locked to one axis (`wheelAxis`: decided on a
  gesture's first event, released after 120 ms quiet, switched to sideways by a clearly
  sideways event), and the stream has `overscroll-behavior-x: none`: a diagonal start
  used to scroll the column, rubber-band sideways, then pull, which read as a jump.
  A wheel pull that starts while a drag's spring-back is running picks up from there.
  Gestures: vertical drags and wheel are left native; sideways closes; a tap off every
  card closes; arrows scroll. The column stops scrolling while dragged or closing.
- Vertical pager (`orientation: "vertical"`): the axes swap. Drag axis is decided
  the same way (first move): sideways = dismiss (either direction, `G.dir` = ±1,
  pivot a third of the way down, span `W * 0.9`); vertical = paging, but only when
  the card's content is at that edge (else native scroll). Wheel: vertical swipes
  page once the content is at an edge, armed exactly like wheel dismiss
  (`armEdges`, shared), and a page turn's momentum is swallowed (`pageTail`) so it
  can't scroll the new card. `paging.atEdge: "continue"` skips the arming (reaching the
  edge pages at once) and the tail (the swipe carries on into the new card: one stream); `paging.swipeDistance` replaces the old fixed 40 px. Scrolling
  off the visible card (the inert card being left mid page turn, a gap, the backdrop)
  scrolls the visible card by hand (`offCard`): inert cards aren't hit-testable, so
  native scrolling there did nothing until the new card slid under the pointer, which
  felt like waiting for the page turn (worst paging up with the pointer low). Touch:
  a vertical drag that lands off the card gets axis "scroll" and drives `scrollTop`,
  then glides with UIScrollView deceleration (`glideScroll`). While a page turn is still
  settling (`turning()`), every vertical scroll goes to the new card by hand, wherever the
  pointer is. Manual scrolling uses plain `scrollTop` (older Safari throws on behavior
  "instant"; restarting a smooth scroll per event barely moves).
  Edges: cards in a vertical pager have `overscroll-behavior-y: none` (root class
  `zoom-vertical`), and paging arms with `armEdges(..., eager)`: a new swipe is any clear
  rise in speed at the edge (step ≥ min·1.5 + 4), not dip-to-near-zero-then-rise.
  Previously a swipe made while the last one's momentum (or the browser's bounce) was
  still running at the edge never counted, so the page was hard to turn. Dismiss arming
  (horizontal pager) is unchanged. Sideways swipes pull the card (same `pull` spring and
  `pullBy`/`commitWheelDismiss`, mapped to x). Edge settings collapse to on/off
  (`sidewaysOn`). Debug edge zones aren't drawn.
- `swipeTail()` follows a swipe that has already acted (turned a page, closed the
  card) so its leftover momentum is ignored but a **new swipe acts at once**, even
  mid-momentum: once the swipe has started slowing (two falls in a row), any clear
  rise (step ≥ min·1.5 + 4) is a new swipe; before that only speed dipping ≤ DIP then
  rising counts (the swipe is often still speeding up when it turns the page, and that
  mustn't read as new); or QUIET_MS of quiet. The dip-only rule swallowed quick flicks
  in a row after a page turn until the reader paused. Movement the other way is never part of the tail (so swiping back turns
  back) but doesn't end it. Used by trackpad paging and by the post-dismiss
  momentum swallowing. Previously both locks were extended by every event, so they
  held until macOS stopped sending events, i.e. until the pointer moved.
- Wheel/trackpad dismiss (`dismiss.wheel`, `wheelDistance` 240, `wheelEdgeSlop` 32):
  a swipe that runs into an edge never closes. A pull is armed only by a
  new swipe at the edge: after QUIET_MS 250 of stillness (and within slop), or
  immediately for a quick retry — trackpad "dip then rise" (DIP 8 px), mouse
  re-spin gap ≥ MOUSE_GAP_MS 140 with equal notch size. Content must be still
  STILL_MS 50. Release = END_MS 350 quiet (macOS pauses ~200 ms between finger
  lift and momentum). Pull is smoothed by a 0.16 s spring; on commit only
  velocity heading home is kept (`towardTargetOnly`); leftover momentum is
  swallowed (a non-passive window `wheel` listener attached only for that moment)
  until a new scroll starts (`swipeTail`), the wheel is quiet for QUIET_MS, or 2 s pass. Root data flags `zoneTop/Bottom`, `armedTop/Bottom`
  drive the debug bands; they're only tracked when `debug` is on.
- Window listeners are attached only while needed: `pointermove`/`pointerup` during
  a mouse drag, the momentum-swallowing `wheel` after a wheel dismiss. Nothing on
  the window costs anything while the zoom is idle.

### Interruptions supported
- Opening → closing (Escape, close button, tap outside card).
- Closing → opening (tap a flying card/cover, or its source on the page;
  becomes the visible item).
- Arrow keys during opening (and during a turned-around close).
- Scroll inside the card during opening (flight follows + clips).
- Page scroll during closing (cards re-aim).
- Not yet: grabbing a card mid-flight with a drag; swiping between items while
  opening; paging during closing.

### Reduced motion
Open/close become opacity fades; no flights; `progress` reads 1; keyboard
paging jumps; the group is hidden only once the fade-in completes.

## 5. Demo specifics (`demo/`)
- Tuned values (also library defaults where applicable): open 0.5 s / bounce
  0.15; close 1.75× faster (≈0.29 s) / bounce 0.15; landing `{0.86, 0.1}`;
  edge zone 32 px. Tuning panel persists in localStorage key
  `bookzoom-timing-v3` (bump the key when defaults change).
- "Book in flight" modes (default **synced**): **own timing** (events + `useZoomValue`; only the
  active book opens; activated/deactivated open/close; closing finishes in 0.2 s,
  before landing), **synced** (`angle = -105 * clamp(progress) * clamp(focus)`),
  **static** (`ZoomHero live={false}`).
- History selector (session / item / off), "Show edge zones" (debug), slow motion
  (`timeScale` 0.2).
- Book is a CSS 3D model: `.book3d` (perspective) > page + `.front`
  (preserve-3d, front/back faces). Covers are generated with CSS (cqw units).
- Feed (`BookFeed.tsx`): all 15 books in one group, a 3-column grid, `orientation:
  "vertical"`, `flyHome: "visible"`, `groupOpacity: 0.35`, landing `{1, 0.3}`, geometry 8 px all round on phones (no peek, like
  TikTok) and a 460 px column with a peek on wider screens. Each card is a dark,
  tinted "reel" (`.reel`, `position: absolute; inset: 0; container-type: size`, so
  it fits the card instead of scrolling): cover sized by `cqw`/`cqh`, set a little
  right of centre because the front cover swings open to the left; title, blurb
  and a stats rail along the bottom. The layout choice persists in localStorage
  (`bookzoom-layout`).
- Portfolio (`Portfolio.tsx`, content in `portfolioContent.ts`, all invented sample
  content): 4 projects (group "work", 4:3 tiles) and 5 pieces of writing (group
  "writing", 68 px square thumbnails opening into 16:9 heroes: the flight crops).
  `layout: "stream"` (no paging: every piece at its content's height, one column),
  `flyHome: "visible"`, `groupOpacity: 0.35`, history `session`, cards in the page
  theme, 680 px wide on desktop. Like the books, the image sits on the card, inset over
  a band tinted with its ground (`.pf-stage`), and the card grows out from behind it:
  landing `{0.86, 0.05}`. Each piece ends by naming the next (it follows directly),
  or offers a way back on the last. Imagery is generated with CSS (`Art`, kinds like phones,
  bars, tiles, shelf, spring). Fonts: Bricolage Grotesque (display), Newsreader
  (reading).
- The Feed tab has a "Moving between cards" panel (`PagingControls.tsx`) tuning
  `timing.page` (duration, bounce), `paging.swipeDistance` and `paging.atEdge`,
  persisted in `feed-paging-v1`. (It started on the portfolio, before that became a stream.)

## 6. Public API (summary)
`ZoomProvider` props: `renderDestination`, `container`, `background`, `timing`,
`timeScale`, `geometry`, `dim`, `scan`, `landing`, `dismiss`, `paging`, `layout`, `orientation`,
`hideGroupWhileOpen`, `groupOpacity`, `flyHome`, `closeButton`, `history`, `debug`, `getLabel`, `closeLabel`.
Components: `ZoomSource`, `ZoomHero` (`live`), `TemplateDestination`.
Types include `ZoomDismiss` and `ZoomEdges` (per-edge `drag` / `wheel` settings).
Hooks: `useZoom`, `useZoomItem`, `useZoomProgress`, `useZoomEvent`, `useZoomValue`.
See README for details.

## 7. Known limitations and caveats
- **Verified only in headless Chromium** (no GPU, simulated input). Needs real
  devices: macOS Safari/Chrome trackpads (wheel heuristics thresholds), iPhone
  (touch, home-indicator conflict for bottom-edge pulls — card ends 8 px above
  the screen edge on phones), Android mid-range performance.
- Native overscroll bounce vs our pull: browsers don't expose the bounce
  offset, so a bounce still settling can briefly overlap our pull; the first
  2–3 events of a quick second swipe aren't prevented.
- First frame of a close still measures and builds every flight (cheap on real
  hardware, exaggerated headless). Possible improvement: pre-measure during a pull.
- Every item in a group renders a card while open (fine for ≤ ~15).
- Bundle ≈ 130 KB gz (React ≈ 70, Motion ≈ 45, library ≈ 8). Options: load the
  island `client:idle`, use Motion's `m` + `LazyMotion`, or a vanilla adapter
  (engine is mostly framework-agnostic; hooks/components aren't).
- Live heroes: styled by their own classes (they leave the card in flight; the
  `ZoomHero` className is kept); rendered twice during flight (card + copy) —
  mind heavy heroes like video. Static heroes fly as a frozen snapshot (video
  shows its current frame).
- Crop of mismatched aspect ratios hides overhangs on cropped sides until it
  opens up. After landing, the card's edges clip any hero overhang.
- Scroll-follow clip is a straight line (fine unless a hero spans the card's width
  and meets its rounded corners).
- Focus management is minimal: background `inert`, neighbour cards `inert`, focus
  to close button on open and back to the source on close; no full focus trap.
- `scan` registers plain-HTML sources once on mount (no MutationObserver; Astro
  view transitions would need a rescan on `astro:page-load`).
- `history`: landing on `#id` does not auto-open; Forward reopens only if the
  source exists on the page.
- `astro-example/` was never run inside a real Astro project.

## 8. Loose ends / suggested next steps
1. Real-device pass (see §7) and tune `QUIET_MS`, `DIP`, `MOUSE_GAP_MS`,
   `END_MS`, `wheelDistance`, `wheelEdgeSlop`.
2. Build the actual Astro site: content collections, `/work/[slug]` and
   `/writing/[slug]` static pages, `ZoomRoot` island with `scan`,
   `history: { mode: "item" | "session", url }`, `client:idle`.
3. Bundle trimming (LazyMotion), then consider the vanilla adapter.
4. Optional interruptions: drag-grab mid-flight; swipe while opening.
5. Port the rest of the ad-hoc Playwright scripts into `tests/e2e` (interruptions,
   history, scroll-follow are still only in `tests/playwright`), and run `npm test` in CI.
6. Option to auto-open from URL hash (`#id`) on load, if wanted.

## 9. Testing notes
- `npm test` runs `tests/e2e` (@playwright/test, Chromium): per-edge dismiss options
  for wheel, touch and mouse drags (each "off" case is paired with the same gesture
  closing by default, so a passing "stays open" means something), debug bands per
  edge, no blocking window wheel listener, paging/inert/focus, and on the fixed-overlay
  harness: scroll unlock, no sideways shift with scrollbars, cleanup on unmount.
  `feed.spec.ts` covers the vertical pager: layout, arrows, wheel and touch paging,
  content scrolling before paging, sideways touch/mouse/wheel close, Escape and X,
  the dimmed group, and only the visible card flying home. `pager-paging.spec.ts`
  (Feed tab, cards made long with injected content): scrolling over the card being
  left mid page turn (both directions, wheel and touch, also where "instant" throws),
  new swipes during momentum, quick flicks reading on, swipe distance, `atEdge` modes,
  no bounce. `portfolio.spec.ts` (stream): content-height cards in one column, scrolling
  straight through pieces with nothing cancelled, the sticky close button, only the
  piece being read flying home, the card growing from behind the image, touch/wheel
  close, writing as its own stream, Back.
  Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to reuse an installed Chromium.
- Development used ad-hoc Python Playwright scripts (`tests/playwright/`) against
  the built demo (`ZOOM_DEMO_URL`, default `http://localhost:8765/dist/`; see its README).
  Useful ones: interruptions (`t14`), drag close/focus/reduced (`t10`), row
  stability after close (`t13`), history (`t27`), wheel dismiss (`t28`, `t30`),
  touch bottom dismiss (`t43`), arrows mid-open (`t44`), scroll mid-flight
  (`t39`, `t40`), release perf (`t24`), plain-HTML path (`t11`).
- Techniques that proved reliable: MutationObserver on style attributes (exact
  per-write values, independent of rAF ordering), PerformanceObserver
  `longtask`, CDP tracing/profiling of a non-minified build.

## 10. Decision log (why things are the way they are)
- **Not Motion `layoutId`**: can't steer the path; non-uniform box morph +
  counter-scaled children is the opposite of the desired uniform zoom; per-card
  return needed custom control.
- **Custom gestures**: need first-move axis decision to coexist with native
  scroll; Motion drag/pan can't.
- **Explicit stiffness/damping**: parity with SwiftUI-tuned values.
- **Card surface inside scroller**: native bounce moves the whole card.
- **Per-card progress, not flight progress**: continuity across bake.
- **Astro over Next.js**: content site, static output, zero-JS reading pages,
  free static hosting; Next ships its runtime on every page.
- **TypeScript for the library**: editor hints document options; no runtime cost.
