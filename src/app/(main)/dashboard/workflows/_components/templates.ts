import type { WorkflowTemplate } from "@/server/services/workflows";

/** Plain phrases → a template, for the automation prompt (deterministic, no AI needed). */
const RULES: { test: RegExp; templateId: string }[] = [
  { test: /bounce|bad data|invalid/i, templateId: "bounce-cleanup" },
  { test: /repl(y|ied|ies)/i, templateId: "replied-follow-up" },
  { test: /new (hire|role|job)|changed job|job change/i, templateId: "new-hires" },
  { test: /won|close[ds]? (a )?deal|celebrat/i, templateId: "deal-won-notify" },
  { test: /interested|book (a )?(call|meeting)/i, templateId: "interested-to-deal" },
  { test: /enrich|verify|clean/i, templateId: "weekly-enrich" },
  { test: /a\/?b|test (two|2)|split/i, templateId: "ab-test-sequences" },
  { test: /compan(y|ies)|account|large|size/i, templateId: "engaged-companies" },
  { test: /icp|ideal|sequence|list|prospect/i, templateId: "icp-to-sequence" },
];

export function templateForPrompt(prompt: string): string | null {
  return RULES.find((r) => r.test.test(prompt))?.templateId ?? null;
}

export type { WorkflowTemplate };
