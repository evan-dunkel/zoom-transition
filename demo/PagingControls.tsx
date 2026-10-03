import { useMemo, useState } from "react";
import type { ZoomPaging, ZoomTiming } from "../src/zoom";

// Tuning for moving between cards in a pager: how fast a page turn settles, how far a
// trackpad swipe travels before it turns, and what scrolling into a card's end does.

type Tuning = { duration: number; bounce: number; swipe: number; atEdge: ZoomPaging["atEdge"] };
const DEFAULTS: Tuning = { duration: 0.5, bounce: 0, swipe: 40, atEdge: "new-swipe" };
type Fields = Record<keyof Tuning, string>;

const num = (v: string, fallback: number, min: number, max: number) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const resolve = (f: Fields): Tuning => ({
  duration: num(f.duration, DEFAULTS.duration, 0.1, 2),
  bounce: num(f.bounce, DEFAULTS.bounce, 0, 0.6),
  swipe: num(f.swipe, DEFAULTS.swipe, 4, 400),
  atEdge: f.atEdge === "continue" ? "continue" : "new-swipe",
});
const asFields = (t: Tuning): Fields => ({ duration: String(t.duration), bounce: String(t.bounce), swipe: String(t.swipe), atEdge: t.atEdge });

/** The panel's state, persisted per browser, and the provider props it maps to. */
export function usePagingTuning(storageKey: string) {
  const [fields, setFields] = useState<Fields>(() => {
    let saved: Partial<Tuning> = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || "null") ?? {};
    } catch {}
    return asFields({ ...DEFAULTS, ...saved });
  });
  const t = resolve(fields);
  const update = (key: keyof Tuning, value: string) => {
    const next = { ...fields, [key]: value };
    setFields(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(resolve(next)));
    } catch {}
  };
  const reset = () => {
    setFields(asFields(DEFAULTS));
    try {
      localStorage.removeItem(storageKey);
    } catch {}
  };
  const timing: Partial<ZoomTiming> = useMemo(() => ({ page: { duration: t.duration, bounce: t.bounce } }), [t.duration, t.bounce]);
  const paging: Partial<ZoomPaging> = useMemo(() => ({ swipeDistance: t.swipe, atEdge: t.atEdge }), [t.swipe, t.atEdge]);
  return { fields, update, reset, timing, paging };
}

export function PagingControls({ tuning }: { tuning: ReturnType<typeof usePagingTuning> }) {
  const { fields, update, reset } = tuning;
  return (
    <fieldset className="tune paging-tune">
      <legend>Moving between cards</legend>
      <label>
        Page turn{" "}
        <input id="paging-duration" type="number" inputMode="decimal" min={0.1} max={2} step={0.05} value={fields.duration} onChange={(e) => update("duration", e.target.value)} /> s
      </label>
      <label>
        Bounce{" "}
        <input id="paging-bounce" type="number" inputMode="decimal" min={0} max={0.6} step={0.05} value={fields.bounce} onChange={(e) => update("bounce", e.target.value)} />
      </label>
      <label>
        Swipe to turn{" "}
        <input id="paging-swipe" type="number" inputMode="numeric" min={4} max={400} step={5} value={fields.swipe} onChange={(e) => update("swipe", e.target.value)} /> px
      </label>
      <label>
        At a card’s end
        <select id="paging-edge" value={fields.atEdge} onChange={(e) => update("atEdge", e.target.value)}>
          <option value="new-swipe">Stop; a new swipe turns</option>
          <option value="continue">Keep going</option>
        </select>
      </label>
      <button type="button" className="paging-reset" onClick={reset}>
        Reset
      </button>
    </fieldset>
  );
}
