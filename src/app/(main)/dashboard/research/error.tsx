"use client";

import { ResearchError } from "./_components/research-error";

export default function ResearchRouteError({ reset }: { reset: () => void }) {
  return <ResearchError retry={reset} />;
}
