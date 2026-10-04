import { createElement, useContext, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { ZoomContext } from "./ZoomProvider";

export type ZoomSourceProps = Omit<HTMLAttributes<HTMLElement>, "id"> & {
  /** Unique id; it's what renderDestination receives. */
  id: string;
  /** Sources in the same group become one swipeable set, ordered as they appear on the page. */
  group?: string;
  /** Stream layout: the section this item belongs to; a title is shown above its first card. */
  section?: string;
  /** Element to render. Defaults to a div. */
  as?: keyof HTMLElementTagNameMap;
  children?: ReactNode;
};

/**
 * Wraps any content the zoom starts from and returns to: an image, a card, a video
 * poster, a block of text. Its box is what gets measured, hidden and flown from.
 * Open it with useZoom().open(id), usually from a surrounding button or link.
 */
export function ZoomSource({ id, group = "default", section, as = "div", children, ...rest }: ZoomSourceProps) {
  const ctx = useContext(ZoomContext);
  const ref = useRef<HTMLElement>(null);
  const register = ctx?.register;
  useLayoutEffect(() => {
    if (!register || !ref.current) return;
    return register({ id, group, el: ref.current, section });
  }, [register, id, group, section, as]); // a new `as` is a new element
  return createElement(as, { ...rest, ref, "data-zoom-react-source": id }, children);
}
