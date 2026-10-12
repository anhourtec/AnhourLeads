import {
  Award,
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarPlus,
  CircleDollarSign,
  Clock,
  Cpu,
  Download,
  Eye,
  Factory,
  FileSpreadsheet,
  Flag,
  Gauge,
  Globe2,
  Hash,
  Landmark,
  ListChecks,
  type LucideIcon,
  MailCheck,
  MailOpen,
  MailWarning,
  MailX,
  MapPin,
  MessageSquareReply,
  Newspaper,
  Radar,
  Send,
  Sigma,
  Signal,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  UserCircle2,
  UserRound,
  UserSearch,
  Users,
} from "lucide-react";

import type { FilterState, SearchEntity } from "@/lib/search/filters";

/**
 * Every filter the rail and the filters modal know about: which URL keys it owns, which editor
 * renders it, and where it sits in the modal. Provider-only filters are listed but disabled.
 */

export type FilterGroup = "person" | "company" | "engagement" | "source" | "misc";

export const GROUP_LABELS: Record<FilterGroup, string> = {
  person: "Person info",
  company: "Company info",
  engagement: "Engagement activity",
  source: "Created source",
  misc: "Misc.",
};

export type EditorKind =
  | "jobTitles"
  | "persona"
  | "emailStatus"
  | "name"
  | "location"
  | "timezone"
  | "company"
  | "companyLocation"
  | "employees"
  | "industryKeywords"
  | "technologies"
  | "revenue"
  | "founded"
  | "sequence"
  | "lastActivity"
  | "engagementFlag"
  | "source"
  | "importId"
  | "created"
  | "lists"
  | "owner"
  | "stage"
  | "customFields"
  | "disabled";

export interface FilterDef {
  id: string;
  label: string;
  icon: LucideIcon;
  group: FilterGroup;
  entities: SearchEntity[];
  /** URL keys this filter owns (custom fields: keys starting with `cf.`). */
  keys: string[];
  editor: EditorKind;
  /** For engagement flags: the yes/no key. */
  flag?: string;
  hint?: string;
}

export const FILTERS: FilterDef[] = [
  // Person info
  {
    id: "jobTitles",
    label: "Job titles",
    icon: Award,
    group: "person",
    entities: ["contact"],
    keys: ["titles", "titlesExclude", "title", "seniority", "department"],
    editor: "jobTitles",
  },
  {
    id: "persona",
    label: "Persona",
    icon: UserSearch,
    group: "person",
    entities: ["contact"],
    keys: ["personaId"],
    editor: "persona",
  },
  {
    id: "emailStatus",
    label: "Email status",
    icon: MailCheck,
    group: "person",
    entities: ["contact"],
    keys: ["emailStatus"],
    editor: "emailStatus",
  },
  {
    id: "name",
    label: "Name",
    icon: UserRound,
    group: "person",
    entities: ["contact"],
    keys: ["name"],
    editor: "name",
  },
  {
    id: "location",
    label: "Location",
    icon: MapPin,
    group: "person",
    entities: ["contact", "company"],
    keys: ["location", "locationExclude", "country"],
    editor: "location",
  },
  {
    id: "timezone",
    label: "Time zone",
    icon: Clock,
    group: "person",
    entities: ["contact"],
    keys: ["timezone"],
    editor: "timezone",
  },
  // Company info
  {
    id: "company",
    label: "Company",
    icon: Building2,
    group: "company",
    entities: ["contact", "company"],
    keys: ["company", "companyExclude", "companyId", "domains"],
    editor: "company",
  },
  {
    id: "companyLocation",
    label: "Company location",
    icon: Landmark,
    group: "company",
    entities: ["contact"],
    keys: ["companyLocation"],
    editor: "companyLocation",
  },
  {
    id: "employees",
    label: "# Employees",
    icon: Users,
    group: "company",
    entities: ["contact", "company"],
    keys: ["employeeRanges", "employeesMin", "employeesMax", "employeesUnknown"],
    editor: "employees",
  },
  {
    id: "industryKeywords",
    label: "Industry & keywords",
    icon: Factory,
    group: "company",
    entities: ["contact", "company"],
    keys: ["industry", "industryExclude", "keywords", "keywordsExclude"],
    editor: "industryKeywords",
  },
  {
    id: "technologies",
    label: "Technologies",
    icon: Cpu,
    group: "company",
    entities: ["contact", "company"],
    keys: ["technologies"],
    editor: "technologies",
  },
  {
    id: "revenue",
    label: "Revenue",
    icon: CircleDollarSign,
    group: "company",
    entities: ["contact", "company"],
    keys: ["revenueMin", "revenueMax"],
    editor: "revenue",
  },
  {
    id: "founded",
    label: "Founded year",
    icon: Flag,
    group: "company",
    entities: ["contact", "company"],
    keys: ["foundedMin", "foundedMax"],
    editor: "founded",
  },
  // Engagement
  {
    id: "sequence",
    label: "Sequence",
    icon: Send,
    group: "engagement",
    entities: ["contact", "company"],
    keys: ["sequenceId", "sequenceExclude"],
    editor: "sequence",
  },
  {
    id: "lastActivity",
    label: "Last activity",
    icon: CalendarClock,
    group: "engagement",
    entities: ["contact", "company"],
    keys: ["lastActivityFrom", "lastActivityTo"],
    editor: "lastActivity",
  },
  ...(
    [
      ["emailSent", "Email sent", Send],
      ["emailOpened", "Email opened", MailOpen],
      ["emailReplied", "Email replied", MessageSquareReply],
      ["emailBounced", "Email bounced", MailWarning],
      ["emailUnsubscribed", "Email unsubscribed", MailX],
    ] as const
  ).map(
    ([key, label, icon]): FilterDef => ({
      id: key,
      label,
      icon,
      group: "engagement",
      entities: ["contact"],
      keys: [key],
      editor: "engagementFlag",
      flag: key,
    }),
  ),
  // Created source
  {
    id: "source",
    label: "Source",
    icon: Download,
    group: "source",
    entities: ["contact", "company"],
    keys: ["source"],
    editor: "source",
  },
  {
    id: "importId",
    label: "CSV import",
    icon: FileSpreadsheet,
    group: "source",
    entities: ["contact", "company"],
    keys: ["importId"],
    editor: "importId",
  },
  {
    id: "created",
    label: "Created date",
    icon: CalendarPlus,
    group: "source",
    entities: ["contact", "company"],
    keys: ["createdFrom", "createdTo"],
    editor: "created",
  },
  // Misc
  {
    id: "lists",
    label: "Lists",
    icon: ListChecks,
    group: "misc",
    entities: ["contact", "company"],
    keys: ["listId", "listExclude"],
    editor: "lists",
  },
  {
    id: "owner",
    label: "Owner",
    icon: UserCircle2,
    group: "misc",
    entities: ["contact", "company"],
    keys: ["ownerId"],
    editor: "owner",
  },
  {
    id: "stage",
    label: "Stage",
    icon: BadgeCheck,
    group: "misc",
    entities: ["contact", "company"],
    keys: ["stage"],
    editor: "stage",
  },
  {
    id: "customFields",
    label: "Custom fields",
    icon: SlidersHorizontal,
    group: "misc",
    entities: ["contact", "company"],
    keys: [],
    editor: "customFields",
  },
  // Need a data provider
  ...(
    [
      ["lookalikes", "Lookalikes", Sparkles, "company"],
      ["buyingIntent", "Buying intent", Gauge, "company"],
      ["funding", "Funding", Briefcase, "company"],
      ["headcountGrowth", "Headcount growth", TrendingUp, "company"],
      ["jobPostings", "Job postings", Hash, "company"],
      ["news", "News", Newspaper, "company"],
      ["websiteVisitors", "Website visitors", Eye, "company"],
      ["signals", "Signals", Signal, "misc"],
      ["scores", "Scores", Sigma, "misc"],
      ["marketSegments", "Market segments", Globe2, "company"],
      ["intentTopics", "Research intent", Radar, "company"],
    ] as const
  ).map(
    ([id, label, icon, group]): FilterDef => ({
      id,
      label,
      icon,
      group,
      entities: ["contact", "company"],
      keys: [],
      editor: "disabled",
      hint: "Needs a data provider",
    }),
  ),
];

export const DEFAULT_PINS: Record<SearchEntity, string[]> = {
  contact: ["jobTitles", "company", "location", "industryKeywords", "employees", "emailStatus", "lists"],
  company: ["lists", "company", "location", "employees", "industryKeywords", "technologies", "stage", "owner"],
};

export function filtersFor(entity: SearchEntity): FilterDef[] {
  return FILTERS.filter((f) => f.entities.includes(entity));
}

export function filterById(id: string): FilterDef | undefined {
  return FILTERS.find((f) => f.id === id);
}

/** How many of this filter's keys are set. */
export function activeCountFor(def: FilterDef, state: FilterState): number {
  if (def.editor === "customFields") return Object.keys(state).filter((k) => k.startsWith("cf.")).length;
  return def.keys.filter((k) => {
    const v = state[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  }).length;
}
