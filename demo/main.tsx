import { createRoot } from "react-dom/client";
import { BookStore } from "./BookStore";

createRoot(document.getElementById("root")!).render(<BookStore />);
