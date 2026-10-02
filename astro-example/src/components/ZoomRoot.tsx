import { TemplateDestination, ZoomProvider } from "../zoom";

/**
 * The one React island the page needs. Sources stay plain Astro markup
 * (data-zoom-source), and each destination is a server-rendered <template>.
 */
export default function ZoomRoot() {
  return (
    <ZoomProvider
      scan
      background={() => document.querySelector("main")}
      renderDestination={(id) => <TemplateDestination id={id} className="project" />}
      getLabel={(id) => document.querySelector(`[data-zoom-source="${CSS.escape(id)}"]`)?.getAttribute("data-zoom-label") ?? id}
      geometry={({ width }) => (width < 640 ? { top: 12, bottom: 0, side: 12 } : { top: 40, bottom: 0, side: 32, maxCardWidth: 880 })}
    />
  );
}
