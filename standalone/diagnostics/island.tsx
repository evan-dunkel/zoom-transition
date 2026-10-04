// Diagnostics: the icon prototype, plus a log of the zoom's state after each tap, for
// reading on a device (first open vs reopen). Each open logs at fixed times after the
// tap; the panel keeps the last two opens.
import { mountPortfolio } from "../portfolio-icons/mount";

const panel = document.querySelector<HTMLElement>(".diag")!;
const errors: string[] = [];
addEventListener("error", (e) => errors.push(String(e.message)));
addEventListener("unhandledrejection", (e) => errors.push("promise: " + String(e.reason)));

mountPortfolio();

const r = (n: number) => Math.round(n);
const state = () => {
  const root = document.querySelector<HTMLElement>(".zoom-root");
  const z = document.querySelector<HTMLElement>(".zoom-zoomer");
  const sc = document.querySelector<HTMLElement>(".zoom-stream");
  const title = document.querySelector<HTMLElement>("[data-zoom-section-title]");
  const rr = root?.getBoundingClientRect();
  const vv = window.visualViewport;
  return [
    `phase=${root?.dataset.phase ?? "-"} clones=${document.querySelectorAll(".zoom-clone").length}`,
    `zoomer=${(z?.style.transform || "none").replace(/px/g, "").replace(/translate/g, "t").slice(0, 46)}`,
    `root top=${rr ? r(rr.top) : "-"} h=${rr ? r(rr.height) : "-"} | inner=${innerWidth}x${innerHeight} vv=${vv ? `${r(vv.width)}x${r(vv.height)}@${r(vv.offsetTop)}` : "-"}`,
    `title=${title ? r(title.getBoundingClientRect().top) : "-"} streamTop=${sc ? r(sc.scrollTop) : "-"} pageY=${r(scrollY)} htmlOverflow=${document.documentElement.style.overflow || "-"}`,
  ].join("\n  ");
};

let opens = 0;
let log: string[] = [];
const render = () => (panel.textContent = [...log, errors.length ? "errors: " + errors.join(" | ") : ""].join("\n"));
document.addEventListener(
  "click",
  (e) => {
    if (!(e.target as Element).closest("[data-zoom-source], .tile, .item")) return;
    opens += 1;
    const t0 = performance.now();
    if (log.length > 14) log = log.slice(-7);
    log.push(`— open ${opens} (${opens === 1 ? "first after load" : "again"})`);
    for (const at of [0, 150, 400, 800, 1500, 3000]) {
      setTimeout(() => {
        log.push(`+${r(performance.now() - t0)}ms ${state()}`);
        render();
      }, at);
    }
  },
  true,
);
panel.textContent = `ready: ${navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 90)}`;
