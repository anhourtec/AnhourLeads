"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { type FilterState, filtersFromParams, paramsFromFilters, VIEW_KEYS } from "@/lib/search/filters";

import type { FilterPatch } from "./filter-editors";
import type { SearchContext } from "./types";

export type ViewPatch = Partial<Record<(typeof VIEW_KEYS)[number], string | null>>;

/** Filters and view options kept in the URL; every filter change goes back to page 1. */
export function useSearchState(ctx: SearchContext) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const filters = useMemo(() => {
    const all = filtersFromParams(searchParams);
    for (const key of Object.keys(ctx.fixed)) delete all[key];
    return all;
  }, [searchParams, ctx.fixed]);

  const view = useMemo(
    () =>
      Object.fromEntries(VIEW_KEYS.map((k) => [k, searchParams.get(k) ?? ""])) as Record<
        (typeof VIEW_KEYS)[number],
        string
      >,
    [searchParams],
  );

  const hrefFor = useCallback(
    (nextFilters: FilterState, viewPatch: ViewPatch = {}, keepPage = false) => {
      const nextView: Record<string, string | undefined> = {};
      for (const k of VIEW_KEYS) {
        const patched = k in viewPatch ? viewPatch[k] : view[k];
        if (patched) nextView[k] = patched;
      }
      if (!keepPage && !("page" in viewPatch)) delete nextView.page;
      if (ctx.fixedSegment) delete nextView.segment;
      const params = paramsFromFilters(nextFilters, nextView);
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, view, ctx.fixedSegment],
  );

  const go = useCallback((href: string) => startTransition(() => router.replace(href, { scroll: false })), [router]);

  const apply = useCallback(
    (patch: FilterPatch) => {
      const next: FilterState = { ...filters };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || (Array.isArray(value) && !value.length) || value === "") delete next[key];
        else next[key] = value;
      }
      go(hrefFor(next));
    },
    [filters, go, hrefFor],
  );

  const replaceFilters = useCallback(
    (next: FilterState, viewPatch: ViewPatch = {}) => go(hrefFor(next, viewPatch)),
    [go, hrefFor],
  );

  const setView = useCallback(
    (patch: ViewPatch, keepPage = false) => go(hrefFor(filters, patch, keepPage)),
    [filters, go, hrefFor],
  );

  return { filters, view, apply, replaceFilters, setView, hrefFor, pending };
}

/** JSON value in localStorage; starts at `fallback` on the server and first paint, then loads. */
export function useStoredState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Storage blocked or bad JSON: keep the fallback.
    }
  }, [key]);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage blocked: the value still applies for this visit.
      }
    },
    [key],
  );
  return [value, update];
}
