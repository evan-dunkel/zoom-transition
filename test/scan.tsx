import { createRoot } from "react-dom/client";
import { ZoomProvider, TemplateDestination } from "../src/zoom";

const root = createRoot(document.getElementById("island")!);
root.render(
  <ZoomProvider scan background={() => document.querySelector("main")} renderDestination={(id) => <TemplateDestination id={id} />} geometry={{ maxCardWidth: 640, top: 32, bottom: 0 }} />
);
// For tests: unmount the island as a page swap would.
(window as unknown as { unmountZoom(): void }).unmountZoom = () => root.unmount();
