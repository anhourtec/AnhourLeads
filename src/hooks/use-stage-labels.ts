"use client";

import { useEffect, useState } from "react";

import { stageLabel } from "@/lib/record-stages";

const cache = new Map<string, Promise<Record<string, string>>>();

function load(entity: "contact" | "company"): Promise<Record<string, string>> {
  let pending = cache.get(entity);
  if (!pending) {
    const url = entity === "contact" ? "/api/v1/contact_stages" : "/api/v1/account_stages";
    pending = fetch(url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : {}))
      .then(
        (body: {
          contact_stages?: { id: string; displayName: string }[];
          account_stages?: { id: string; displayName: string }[];
        }) => Object.fromEntries((body.contact_stages ?? body.account_stages ?? []).map((s) => [s.id, s.displayName])),
      )
      .catch(() => ({}));
    cache.set(entity, pending);
  }
  return pending;
}

/**
 * The workspace's stage names (settings → contact stages). Returns a label function that falls back
 * to the default names until loaded: `const label = useStageLabels(); label("new")` → "Cold".
 */
export function useStageLabels(entity: "contact" | "company" = "contact"): (key: string | null | undefined) => string {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void load(entity).then((l) => live && setLabels(l));
    return () => {
      live = false;
    };
  }, [entity]);
  return (key) => stageLabel(labels, key);
}
