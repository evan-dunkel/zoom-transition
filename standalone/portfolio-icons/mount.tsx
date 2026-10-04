// The icon prototype's zoom: settings and the About card's copy-email button, shared by
// the prototypes that use this content (portfolio-icons, portfolio-sections). All
// sources share one group, so everything opens into one stream, and each section's
// title is drawn above its first card in the page's own section-title style.
import { createRoot } from "react-dom/client";
import { TemplateDestination, ZoomProvider, type ZoomProviderProps } from "../../src/zoom";

/** Mounts the zoom on #zoom with this portfolio's settings; props override them. */
export function mountPortfolio(props: Partial<ZoomProviderProps> = {}) {
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
      dim={0.3} // over the blurred page (--zoom-backdrop-filter in style.css)
      landing={{ widthRatio: 0.86, topOffset: 0.05 }}
      flyHome="visible"
      groupOpacity={0.35}
      history={{ mode: "session" }}
      getLabel={(id) => document.querySelector(`template[data-zoom-destination="${id}"] h2`)?.textContent ?? id}
      // Development: ?slow=5 plays every transition 5x slower (for inspecting frames).
      timeScale={1 / (Number(new URLSearchParams(location.search).get("slow")) || 1)}
      {...props}
    />,
  );
  document.addEventListener("click", copyEmail);
}

// About's call to action: copy the address (the button's only job), falling back to
// selecting it so the reader can copy it themselves.
function copyEmail(e: MouseEvent) {
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
}
