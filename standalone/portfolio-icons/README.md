# Portfolio, current work first (standalone)

A second portfolio prototype, kept beside `standalone/portfolio/` (unchanged) so the two
can be compared. Same markup contract and settings; what differs:

- **One stream, current work first.** Every source is in one group
  (`data-zoom-group="portfolio"`), so opening anything lets you scroll on through
  Air Apps, personal projects, writing and experiments, then About.
- **Section titles.** Each source names its section (`data-zoom-section="Air Apps"`); the
  stream draws that title above the section's first card with `renderSectionTitle`, using
  the page's own `.section-title`. A piece that starts a section opens with its title in
  view. The page behind is blurred as it dims (`.zoom-dim` backdrop filter, with `dim={1}`
  and the strength in `--zoom-dim-color`) so the titles read over it.
- **Two card styles, by how closely a piece is read.** Air Apps case studies are large
  tiles that open into image-led cards (`.piece-feature`: the image inset across the
  card, then the title and one line of metadata). Personal projects, writing and About
  are icon rows that open into icon-led cards (`.piece-head`: a square icon at the
  top-left corner, 10 px in on both sides with an 18 px corner concentric with the card's
  28 px, the title and one line of metadata beside it).
- **About + call to action** last: what you do, facts, what you're looking for, three lines
  of proof, and the email with a Copy email button (`island.tsx`; falls back to selecting it).

Text in [brackets] is a placeholder: the Air Apps case studies, the second personal
project, two proof lines, your name and email. The Air Apps and personal-project images
are placeholders too (`images/`); the writing reuses `standalone/portfolio/images/`.

`npm run build:portfolio` builds both prototypes (`dist/portfolio-icons.html`).
