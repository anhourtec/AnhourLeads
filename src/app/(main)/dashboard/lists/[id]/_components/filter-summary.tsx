import { Badge } from "@/components/ui/badge";
import { CONTACT_STAGE_LABELS, EMAIL_STATUS_LABELS, SENIORITY_LABELS } from "@/lib/records-vocabulary";

import type { ListRow } from "../../_components/types";

const LABELS: Record<string, string> = {
  q: "Keyword",
  stage: "Stage",
  emailStatus: "Email status",
  country: "Country",
  seniority: "Seniority",
  industry: "Industry",
  employeeMin: "Employees from",
  employeeMax: "Employees to",
};

function display(key: string, value: unknown): string {
  const text = String(value);
  if (key === "stage") return CONTACT_STAGE_LABELS[text as keyof typeof CONTACT_STAGE_LABELS] ?? text;
  if (key === "emailStatus") return EMAIL_STATUS_LABELS[text as keyof typeof EMAIL_STATUS_LABELS] ?? text;
  if (key === "seniority") return SENIORITY_LABELS[text as keyof typeof SENIORITY_LABELS] ?? text;
  return text;
}

/** The saved filters a dynamic list resolves its members from. */
export function FilterSummary({ list, canEdit }: { list: ListRow; canEdit: boolean }) {
  const entries = Object.entries(list.filters ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <p className="font-medium text-sm">Filters</p>
      {entries.length ? (
        <div className="flex flex-wrap gap-2">
          {entries.map(([key, value]) => (
            <Badge key={key} variant="outline" className="h-auto max-w-full whitespace-normal break-words font-normal">
              <span className="text-muted-foreground">{LABELS[key] ?? key}:</span> {display(key, value)}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No filters, so every record is a member.</p>
      )}
      <p className="text-muted-foreground text-xs">
        Members update automatically as records change.{canEdit ? " Use Edit to change the filters." : ""}
      </p>
    </div>
  );
}
