"use client";

import { useCallback, useTransition } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type ParamUpdates = Record<string, string | string[] | null | undefined>;

/** Read and update list filters kept in the URL; any change goes back to page 1. */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const hrefWith = useCallback(
    (updates: ParamUpdates, keepPage = false) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        next.delete(key);
        if (Array.isArray(value)) for (const v of value) next.append(key, v);
        else if (value) next.set(key, value);
      }
      if (!keepPage && !("page" in updates)) next.delete("page");
      const query = next.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  const setParams = useCallback(
    (updates: ParamUpdates) => {
      startTransition(() => router.replace(hrefWith(updates), { scroll: false }));
    },
    [hrefWith, router],
  );

  return { searchParams, hrefWith, setParams, pending };
}
