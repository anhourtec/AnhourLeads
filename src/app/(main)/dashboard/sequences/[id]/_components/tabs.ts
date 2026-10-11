export const SEQUENCE_TABS = ["editor", "contacts", "activity", "health", "report", "settings"] as const;
export type SequenceTab = (typeof SEQUENCE_TABS)[number];
