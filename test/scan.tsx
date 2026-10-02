import { createRoot } from "react-dom/client";
import { ZoomProvider, TemplateDestination } from "../src/zoom";
createRoot(document.getElementById("island")!).render(
  <ZoomProvider scan background={() => document.querySelector("main")} renderDestination={(id) => <TemplateDestination id={id} />} geometry={{ maxCardWidth: 640, top: 32, bottom: 0 }} />
);
