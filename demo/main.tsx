import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BookStore } from "./BookStore";
import { BookFeed } from "./BookFeed";

export type Layout = "shelves" | "feed";
const LAYOUT_KEY = "bookzoom-layout";

function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "feed" ? "feed" : "shelves";
  } catch {
    return "shelves";
  }
}

/** Two prototypes of the same store: shelves that page sideways, and a feed that pages up and down. */
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
    </div>
  );
  return layout === "feed" ? <BookFeed switcher={switcher} /> : <BookStore switcher={switcher} />;
}

createRoot(document.getElementById("root")!).render(<App />);
