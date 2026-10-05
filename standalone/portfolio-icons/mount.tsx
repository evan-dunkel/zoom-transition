// The icon prototype's zoom: settings and the About card's copy-email button, shared by
// the prototypes that use this content (portfolio-icons, portfolio-sections). All
// sources share one group, so everything opens into one stream, and each section's
// title is drawn above its first card in the page's own section-title style.
import { createRoot } from "react-dom/client";
import { TemplateDestination, ZoomProvider, type ZoomProviderProps } from "../../src/zoom";

/** Mounts the zoom on #zoom with this portfolio's settings; props override them. */
export function mountPortfolio(props: Partial<ZoomProviderProps> = {}) {
  // Development: try options from the address, e.g. ?close=shared&target=visible&fit=contain.
  const q = new URLSearchParams(location.search);
  const landing: ZoomProviderProps["landing"] = {
    widthRatio: 0.86,
    topOffset: 0.05,
    ...(q.get("fit") === "contain" ? { fit: "contain" as const, topOffset: 0 } : {}),
    ...(q.get("clip") === "image" ? { clip: "image" as const } : {}),
  };
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
      landing={landing}
      closeButton={q.get("close") === "shared" ? "shared" : true}
      closeTarget={q.get("target") === "visible" ? "visible" : "requested"}
      flyHome="visible"
      groupOpacity={0.35}
      history={{ mode: "session" }}
      getLabel={(id) => document.querySelector(`template[data-zoom-destination="${id}"] h2`)?.textContent ?? id}
      // Development: ?slow=5 plays every transition 5x slower (for inspecting frames).
      timeScale={1 / (Number(new URLSearchParams(location.search).get("slow")) || 1)}
      // When the page behind follows the piece being read (?reveal=read|close|off to try them).
      revealSource={({ read: "read", off: false } as const)[new URLSearchParams(location.search).get("reveal") as "read" | "off"] ?? "close"}
      {...props}
    />,
  );
  document.addEventListener("click", copyEmail);
}

// About's call to action: copy the address (the button's only job). The clipboard API
// needs a secure page (https, or localhost), so elsewhere (a phone on a dev server's LAN
// address) it falls back to copying a selection, which works during the tap. Only if
// both fail does it select the address and say how to copy it on this device.
function copyEmail(e: MouseEvent) {
  const button = (e.target as Element).closest<HTMLButtonElement>("[data-copy-email]");
  if (!button) return;
  const email = button.parentElement!.querySelector<HTMLElement>("[data-email]")!;
  const text = email.textContent!.trim();
  const done = (label: string) => {
    button.textContent = label;
    clearTimeout(Number(button.dataset.reset));
    button.dataset.reset = String(setTimeout(() => (button.textContent = "Copy email"), 2000));
  };
  const fallback = () => {
    if (copyBySelection(text)) return done("Copied");
    getSelection()?.selectAllChildren(email);
    const touch = matchMedia("(pointer: coarse)").matches;
    done(touch ? "Hold to copy" : /Mac|iP/.test(navigator.platform) ? "Press ⌘C" : "Press Ctrl+C");
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done("Copied"), fallback);
  else fallback();
}

/** The older route: select the text in an off-screen field and copy that. */
function copyBySelection(text: string) {
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true; // no keyboard on phones
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;pointer-events:none";
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, text.length); // iOS
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {}
  field.remove();
  return ok;
}
