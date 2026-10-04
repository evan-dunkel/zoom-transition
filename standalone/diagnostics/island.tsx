// Diagnostics: the icon prototype, plus a log of the zoom's state after each tap, for
// reading on a device (first open vs reopen). Newest first; the panel scrolls.
import { mountPortfolio } from "../portfolio-icons/mount";

const panel = document.querySelector<HTMLElement>(".diag")!;
const errors: string[] = [];
addEventListener("error", (e) => errors.push(String(e.message)));
addEventListener("unhandledrejection", (e) => errors.push("promise: " + String(e.reason)));

mountPortfolio();

const r = (n: number) => Math.round(n);
/** One dense line of state. */
const state = () => {
  const root = document.querySelector<HTMLElement>(".zoom-root");
  const z = document.querySelector<HTMLElement>(".zoom-zoomer");
  const sc = document.querySelector<HTMLElement>(".zoom-stream");
  const title = document.querySelector<HTMLElement>("[data-zoom-section-title]");
  const rr = root?.getBoundingClientRect();
  const vv = window.visualViewport;
  const zt = (z?.style.transform || "none").match(/translateY\(([-\d.]+)px\)/);
  return [
    `${root?.dataset.phase ?? "-"}`,
    `clones=${document.querySelectorAll(".zoom-clone").length}`,
    `zY=${zt ? r(Number(zt[1])) : 0}`,
    `title=${title ? r(title.getBoundingClientRect().top) : "-"}`,
    `col=${sc ? r(sc.scrollTop) : "-"}`,
    `root=${rr ? `${r(rr.top)}/${r(rr.height)}` : "-"}`,
    `win=${innerHeight}`,
    `doc=${document.documentElement.clientHeight}`,
    `vv=${vv ? `${r(vv.height)}@${r(vv.offsetTop)}/${r(vv.pageTop)}` : "-"}`,
    `scr=${screen.height}`,
    `pageY=${r(scrollY)}`,
  ].join(" ");
};

const events: string[][] = []; // newest first; each: a heading, then timed lines
let opens = 0;
const render = () => {
  panel.textContent = [
    `now ${state()}`,
    errors.length ? `errors: ${errors.join(" | ")}` : "",
    ...events.flatMap((e) => e),
  ]
    .filter(Boolean)
    .join("\n");
};
const record = (heading: string, at: number[]) => {
  const lines = [heading];
  events.unshift(lines);
  events.length = Math.min(events.length, 6);
  const t0 = performance.now();
  for (const ms of at)
    setTimeout(() => {
      lines.push(` +${r(performance.now() - t0)} ${state()}`);
      render();
    }, ms);
};
document.addEventListener(
  "click",
  (e) => {
    const t = e.target as Element;
    const root = document.querySelector<HTMLElement>(".zoom-root");
    if (t.closest("[data-zoom-close]")) record("— close (✕)", [0, 600]);
    else if (t.closest(".tile, .item") && root?.dataset.phase !== "open") {
      opens += 1;
      record(`— open ${opens}${opens === 1 ? " (first after load)" : ""}`, [0, 150, 400, 1500, 3000]);
    }
  },
  true,
);
addEventListener("keydown", (e) => e.key === "Escape" && record("— close (Esc)", [0, 600]), true);
setInterval(render, 500);
render();
