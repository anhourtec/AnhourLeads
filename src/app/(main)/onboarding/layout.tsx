import type { ReactNode } from "react";

import { Radar } from "lucide-react";

import { getAppContext } from "@/server/auth/context";

/** Full-page onboarding, outside the app shell, in the workspace's brand. */
export default async function OnboardingLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { brand, user } = await getAppContext();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between gap-3 border-b px-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-4" aria-hidden="true" />
          </span>
          <span className="truncate font-semibold">{brand.name}</span>
        </div>
        <span className="hidden truncate font-mono text-muted-foreground text-xs sm:block">{user.email}</span>
      </header>
      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">{children}</main>
    </div>
  );
}
