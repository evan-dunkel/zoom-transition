// The icon prototype's zoom (same content, same settings), plus a switcher for how
// the works in a section are divided once they're joined into one card.
import { mountPortfolio } from "../portfolio-icons/mount";

mountPortfolio();

/**
 * Delineations between works, from basic to playful. To add one: write a block for
 * [data-delineation="name"] in variants.css and add [name, label] here.
 */
const VARIANTS: [string, string][] = [
  ["line", "Line"],
  ["space", "Space"],
  ["receipt", "Receipt"],
  ["gradient", "Gradient"],
  ["fade", "Fade"],
];

const KEY = "portfolio-sections:delineation";
const nav = document.querySelector<HTMLElement>(".variants")!;
const label = document.createElement("span");
label.textContent = "Between works";
nav.append(label);
const set = (name: string) => {
  document.documentElement.dataset.delineation = name;
  nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.value === name)));
  try {
    localStorage.setItem(KEY, name);
  } catch {}
};
for (const [name, text] of VARIANTS) {
  const b = document.createElement("button");
  b.type = "button";
  b.value = name;
  b.textContent = text;
  b.addEventListener("click", () => set(name));
  nav.append(b);
}
let saved: string | null = null;
try {
  saved = localStorage.getItem(KEY);
} catch {}
set(VARIANTS.some(([n]) => n === saved) ? saved! : VARIANTS[0][0]);
