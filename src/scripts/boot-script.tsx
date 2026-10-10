"use client";

import { useLayoutEffect } from "react";

const isServer = typeof window === "undefined";

/**
 * Renders an inline script that runs before hydration on server-rendered documents.
 *
 * When React renders the document on the client instead (for example the error shell Next.js sends for a
 * `notFound()` thrown before the shell is ready), a `<script>` element would never run and React warns about it.
 * In that case the element is inert (`type="text/plain"`) and the code runs from a layout effect instead.
 */
export function BootScript({ code }: Readonly<{ code: string }>) {
  useLayoutEffect(() => {
    const script = document.createElement("script");
    script.text = code;
    document.head.appendChild(script);
    script.remove();
  }, [code]);

  return (
    <script
      type={isServer ? undefined : "text/plain"}
      suppressHydrationWarning
      /* biome-ignore lint/security/noDangerouslySetInnerHtml: required for pre-hydration boot script */
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}
