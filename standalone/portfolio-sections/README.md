# Portfolio sections, standalone

A third prototype: the icon prototype's content and settings, with each section opening
as **one continuous card**. The works in a section join into a single surface, divided by a
delineation you can switch from the bar at the bottom of the screen.

## What it's made of

| File | What it is |
| --- | --- |
| `index.html` | A shell: includes `../portfolio-icons/content.html` (same content) |
| `island.tsx` | `mountPortfolio()` from `../portfolio-icons/mount.tsx` (same settings), plus the switcher and its list of variants |
| `style.css` | Joining: no gap inside a section, square joins once open, and the hooks variants use |
| `variants.css` | The delineations, one block each |

It also loads `../portfolio-icons/style.css`, so anything changed there shows here too.

## How joining works

The library marks each stream card with `data-zoom-section`, plus `data-zoom-section-start`
and `data-zoom-section-end` on a section's first and last card, and gives the gap between
cards as `--zoom-gap`. `style.css` cancels the gap between cards of one section and squares
their inner corners while open. As a card opens or flies home its corners ease round
again, so it reads as a card of its own in flight.

## Adding a delineation

1. In `variants.css`, add a block for `[data-delineation="name"]`. The hooks:
   - `--join-space`: extra room above each work (but a section's first);
   - `.zoom-card-content::before`: the divider, absolutely placed at the work's top;
   - `[data-zoom-section-start]` / `[data-zoom-section-end]` for the ends of a section.
2. Add `["name", "Label"]` to `VARIANTS` in `island.tsx`.

Keep `[data-zoom-hero]` elements out of opacity or transform effects: the flying copy is
taken from the hero as it looks at that moment.

The five included: **Line** (a semi-opaque hairline), **Space** (room, nothing drawn),
**Receipt** (a perforated tear line with notches cut from both edges), **Gradient** (a wash
of colour at each work's top) and **Fade** (text fades in and out with scroll; scroll-driven,
so browsers without it skip it).

`npm run build:portfolio` builds it (`dist/portfolio-sections.html`).
