# Portfolio zoom, standalone

The portfolio prototype at its simplest: plain markup, one stylesheet, one script.
`npm run build:portfolio` inlines it all into `dist/portfolio.html` (via `standalone/build.py`).

## The three parts

| File | What it is | On an Astro site |
| --- | --- | --- |
| `index.html` | The index (tiles and rows) and one `<template>` per piece | Your page and content collection, rendered as today |
| `island.tsx` | The only script: mounts the zoom and reads both from the page | One React island, `<ZoomRoot client:idle />` |
| `style.css` | Page layout, and how a piece looks open | Your existing styles, plus `--zoom-radius` and `--zoom-inset` |

Plus `src/zoom/` (the library), `src/zoom/zoom.css` and, for smoothed corners, `src/zoom/corners.css`.

## Markup contract

```html
<!-- A tile: the element that grows. The link still works without JavaScript. -->
<a href="/work/kiln">
  <div data-zoom-source="kiln" data-zoom-group="work"><img src="…" alt=""></div>
  <h3>Kiln</h3>
</a>

<!-- The piece, rendered server-side and kept inert until opened. -->
<template data-zoom-destination="kiln">
  <article class="piece">
    <div class="piece-image" data-zoom-hero><img src="…" alt="…"></div>
    …the case study…
  </article>
</template>
```

- `data-zoom-group`: every piece in a group opens into the same continuous column, in
  page order. Projects and writing are two groups, so two separate streams.
- `data-zoom-hero`: the image that flies from the tile. It sits inset on the card;
  give it and the tile `class="zoom-concentric"` so they share a corner and the hand-over
  is invisible.

## The settings that make this layout and animation

```tsx
<ZoomProvider
  scan                                  // sources are the page's own markup
  renderDestination={(id) => <TemplateDestination id={id} />}
  layout="stream"                       // one column, each card as tall as its content
  landing={{ widthRatio: 0.86, topOffset: 0.05 }}  // the card starts just behind the image
  flyHome="visible"                     // on close, only the piece being read flies home
  groupOpacity={0.35}                   // the rest of the index waits behind, dimmed
  history={{ mode: "session" }}         // Back closes
/>
```

Corners come from the library: `style.css` sets two Figma values, `--zoom-radius: 28px` (the
card) and `--zoom-inset: 10px` (the image's inset, as padding so it stays inside the card).
`zoom.css` derives the rest: the card's corner, the close button on the same centre, and
`.zoom-concentric` (18 px) on the image and its tile. `corners.css` smooths them like Figma's
iOS corners (60%) where the browser draws `corner-shape`, falling back to the plain radius.

Everything else is a default: the spring timing (open 0.5 s, close 1.75× faster),
closing with ✕, Escape, or a sideways drag (a sideways trackpad scroll too, with
`dismiss={{ wheelSideways: true }}`), and reduced motion becoming a fade.
On a real site, give `history` your real URLs (`url: (id) => "/work/" + id`), so a
reload or a shared link lands on that piece's own page.
