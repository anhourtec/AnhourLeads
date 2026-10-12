import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import type { DomainView } from "@/server/services/domains";

const STYLES: Record<DomainView["status"], { label: string; className: string }> = {
  verified: { label: "Verified", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  failing: { label: "Failing", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
};

export function StatusPill({ domain }: { domain: Pick<DomainView, "status" | "serving"> }) {
  const style = STYLES[domain.status];
  const label = domain.status === "failing" && !domain.serving ? "Switched off" : style.label;
  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-medium",
        domain.status === "failing" && !domain.serving ? "bg-destructive/10 text-destructive" : style.className,
      )}
    >
      {label}
    </Badge>
  );
}
