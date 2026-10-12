import type { ReactNode } from "react";

/** Settings shell content area. The settings sidebar is swapped in by the app sidebar on these paths. */
export default function SettingsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="mx-auto w-full max-w-5xl">{children}</div>;
}
