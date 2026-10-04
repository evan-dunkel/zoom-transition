// The one script the page needs, as in standalone/portfolio. What's different here: all
// sources share one group, so everything opens into one stream, and each section's
// title is drawn above its first card in the page's own section-title style.
import { createRoot } from "react-dom/client";
import { TemplateDestination, ZoomProvider } from "../../src/zoom";

createRoot(document.getElementById("zoom")!).render(
  <ZoomProvider
    scan // pick up data-zoom-source elements; a click on the link around one opens it
    renderDestination={(id) => <TemplateDestination id={id} />}
    background={() => document.querySelector("main")} // made inert while open
    layout="stream"
    geometry={({ width }) =>
      width < 600 ? { top: 8, side: 8, gap: 12 } : { top: 24, side: 24, gap: 24, maxCardWidth: 680 }
    }
    // Sections come from data-zoom-section; the title matches the page's .section-title.
    renderSectionTitle={(section) => <h2 className="section-title">{section}</h2>}
    // The dim runs all the way up so the page's blur behind it (style.css) is complete;
    // how dark it gets is --zoom-dim-color.
    dim={1}
    landing={{ widthRatio: 0.86, topOffset: 0.05 }}
    flyHome="visible"
    groupOpacity={0.35}
    history={{ mode: "session" }}
    getLabel={(id) => document.querySelector(`template[data-zoom-destination="${id}"] h2`)?.textContent ?? id}
  />,
);

// About's call to action: copy the address (the button's only job), falling back to
// selecting it so the reader can copy it themselves.
document.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>("[data-copy-email]");
  if (!button) return;
  const email = button.parentElement!.querySelector<HTMLElement>("[data-email]")!;
  const done = (label: string) => {
    button.textContent = label;
    setTimeout(() => (button.textContent = "Copy email"), 2000);
  };
  const select = () => {
    getSelection()?.selectAllChildren(email);
    done("Selected: press ⌘C");
  };
  if (navigator.clipboard) navigator.clipboard.writeText(email.textContent!.trim()).then(() => done("Copied"), select);
  else select();
});
