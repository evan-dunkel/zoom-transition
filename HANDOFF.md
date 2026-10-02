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
demo/                Book Store demo (BookStore.tsx, books.ts, demo.css, main.tsx)
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
  origin 0 0) + `trackX` on `.zoom-track`. Used for the first open from idle,
  the resting open state, drag-to-dismiss, cancel.
- **cards**: each card has its own `cv.x/y/s/o` (origin 0 0, relative to its
  untransformed slot `P = (trackX + j*step, L.top)`). Used for closing and
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
- `offset()` (added every frame): follows **content scrolled mid-flight**
  (`y = -(scrollNow - scroll0) * zs * cv.s`) and **paging mid-flight**
  (`x = (trackX - track0) * zs`), so the hand-over is pixel-exact.
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
- Drag dismiss from **top (pull down) and bottom (pull up)** (`dismiss.drag`),
  only if the drag starts at that edge. Pivot mirrors for bottom pulls.
- Per-edge options: `dismiss.drag` and `dismiss.wheel` take `ZoomEdges` (`true`/`false`,
  `"top"`/`"bottom"`/`"both"`, or `{ top?, bottom? }` where a missing edge stays on).
  The provider resolves them once per `dismiss` prop (`resolveEdges`, cached by
  identity) to `{ top, bottom }`; gestures only ever see that form. A disabled edge
  never arms or pulls; the gesture is left to native scrolling.
  Release hands the spring the **full zoom velocity incl. scale**.
- Paging: rubber band at ends, projection picks the page (±1), keyboard arrows
  page **also while opening** (flights follow the track), trackpad horizontal
  swipe pages once per swipe (40 px of travel).
- `swipeTail()` follows a swipe that has already acted (turned a page, closed the
  card) so its leftover momentum is ignored but a **new swipe acts at once**, even
  mid-momentum: speed dipping ≤ DIP then rising (fingers back down), or QUIET_MS of
  quiet. Movement the other way is never part of the tail (so swiping back turns
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

## 5. Demo specifics (`demo/BookStore.tsx`)
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

## 6. Public API (summary)
`ZoomProvider` props: `renderDestination`, `container`, `background`, `timing`,
`timeScale`, `geometry`, `dim`, `scan`, `landing`, `dismiss`, `paging`,
`hideGroupWhileOpen`, `closeButton`, `history`, `debug`, `getLabel`, `closeLabel`.
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
