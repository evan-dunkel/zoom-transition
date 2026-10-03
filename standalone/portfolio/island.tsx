// The one script the page needs. It reads the sources (data-zoom-source) and the
// pieces (<template data-zoom-destination>) from the page; nothing else is React.
import { createRoot } from "react-dom/client";
import { TemplateDestination, ZoomProvider } from "../../src/zoom";

createRoot(document.getElementById("zoom")!).render(
  <ZoomProvider
    scan // pick up data-zoom-source elements; a click on the link around one opens it
    renderDestination={(id) => <TemplateDestination id={id} />}
    background={() => document.querySelector("main")} // made inert while open
    // Layout: one continuous column, each piece as tall as its content. No paging.
    layout="stream"
    geometry={({ width }) =>
      width < 600 ? { top: 8, side: 8, gap: 12 } : { top: 24, side: 24, gap: 24, maxCardWidth: 680 }
    }
    // Animation: the card starts just behind the image (a little narrower, its top a
    // touch higher) and grows out from there while the image flies to its place.
    landing={{ widthRatio: 0.86, topOffset: 0.05 }}
    // Closing: only the piece being read flies home; the rest of the index waits behind, dimmed.
    flyHome="visible"
    groupOpacity={0.35}
    // Opening adds one history entry, so Back closes.
    history={{ mode: "session" }}
    getLabel={(id) => document.querySelector(`template[data-zoom-destination="${id}"] h2`)?.textContent ?? id}
  />,
);
