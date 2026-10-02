import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BookStore } from "./BookStore";
import { BookFeed } from "./BookFeed";
import { Portfolio } from "./Portfolio";

export type Layout = "shelves" | "feed" | "portfolio";
const LAYOUTS: Layout[] = ["shelves", "feed", "portfolio"];
const LAYOUT_KEY = "bookzoom-layout";

function loadLayout(): Layout {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY) as Layout | null;
    return saved && LAYOUTS.includes(saved) ? saved : "shelves";
  } catch {
    return "shelves";
  }
}

/** Three prototypes: the store as shelves that page sideways, the store as a feed that pages
 *  up and down, and that feed adapted to a design portfolio. */
function App() {
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const choose = (next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {}
  };
  const switcher = (
    <div className="layout-switch" role="group" aria-label="Layout">
      <button type="button" aria-pressed={layout === "shelves"} onClick={() => choose("shelves")}>
        Shelves
      </button>
      <button type="button" aria-pressed={layout === "feed"} onClick={() => choose("feed")}>
        Feed
      </button>
      <button type="button" aria-pressed={layout === "portfolio"} onClick={() => choose("portfolio")}>
        Portfolio
      </button>
    </div>
  );
  if (layout === "portfolio") return <Portfolio switcher={switcher} />;
  return layout === "feed" ? <BookFeed switcher={switcher} /> : <BookStore switcher={switcher} />;
}

createRoot(document.getElementById("root")!).render(<App />);
