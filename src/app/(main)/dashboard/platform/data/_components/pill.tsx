import { Badge } from "@/components/ui/badge";

import { PILL } from "./tabs";

export function Pill({ tone, children }: { tone: keyof typeof PILL; children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className={`font-medium ${PILL[tone]}`}>
      {children}
    </Badge>
  );
}
