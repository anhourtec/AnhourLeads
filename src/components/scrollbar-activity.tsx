"use client";

import { useEffect } from "react";

/** How long a scrollbar stays visible after the last scroll event. */
const VISIBLE_MS = 1000;

/**
 * Scrollbars stay hidden until the user scrolls (globals.css hides the thumb). While an element is
 * scrolling it carries `data-scrolling`, which shows its own scrollbar only; the page itself is the
 * `<html>` element. One capturing listener covers every scroll container, including ones rendered later.
 */
export function ScrollbarActivity() {
  useEffect(() => {
    const timers = new Map<Element, number>();
    const onScroll = (event: Event) => {
      const target = event.target === document ? document.documentElement : event.target;
      if (!(target instanceof Element)) return;
      if (!timers.has(target)) target.setAttribute("data-scrolling", "");
      window.clearTimeout(timers.get(target));
      timers.set(
        target,
        window.setTimeout(() => {
          target.removeAttribute("data-scrolling");
          timers.delete(target);
        }, VISIBLE_MS),
      );
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      for (const [element, timer] of timers) {
        window.clearTimeout(timer);
        element.removeAttribute("data-scrolling");
      }
    };
  }, []);
  return null;
}
