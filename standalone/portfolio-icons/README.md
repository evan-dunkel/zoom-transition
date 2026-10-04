# Portfolio icons, standalone

A second prototype of the portfolio, kept beside `standalone/portfolio/` (unchanged) so
the two can be compared or combined. Same markup contract and settings; what differs:

- **One stream.** Every source is in one group (`data-zoom-group="portfolio"`), so
  opening anything lets you scroll on through projects, writing, then About.
- **Section titles.** Each source names its section (`data-zoom-section="Projects"`); the
  stream draws that title above the section's first card with `renderSectionTitle`, using
  the page's own `.section-title`. A piece that starts a section opens with its title in
  view. The page behind is blurred as it dims (`.zoom-dim` backdrop filter, with `dim={1}`
  and the strength in `--zoom-dim-color`) so the titles read over it.
- **Icon-led cards.** The hero is a square icon at the card's top-left corner (10 px in on
  both sides, an 18 px corner concentric with the card's 28 px), the title and one line of
  metadata beside it, then the lede, facts and text. The list on the page uses the same
  icon and corner, so the image only moves and scales on the way.
- **About + call to action** last: what I do, facts, what I'm looking for, three lines of
  proof, and the email with a Copy email button (`island.tsx`; falls back to selecting it).

`npm run build:portfolio` builds both prototypes (`dist/portfolio-icons.html`). Images are
shared with `standalone/portfolio/images/`, plus `images/portrait.svg`.
