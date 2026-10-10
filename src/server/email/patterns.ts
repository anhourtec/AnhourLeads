/**
 * Company email formats: detect the pattern from known addresses and generate candidates. Pure.
 */

/** In rough order of how common they are in B2B; used to break ties and to order guesses. */
export const EMAIL_PATTERNS = [
  "{first}.{last}",
  "{first}",
  "{f}{last}",
  "{first}{last}",
  "{first}_{last}",
  "{first}{l}",
  "{f}.{last}",
  "{last}.{first}",
  "{first}-{last}",
  "{last}{f}",
  "{last}",
  "{f}{l}",
  "{last}{first}",
  "{last}_{first}",
] as const;
export type EmailPattern = (typeof EMAIL_PATTERNS)[number];

export function isEmailPattern(value: unknown): value is EmailPattern {
  return typeof value === "string" && (EMAIL_PATTERNS as readonly string[]).includes(value);
}

/** Lowercase ASCII letters only: "José-María" → "josemaria". */
export function namePart(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function renderPattern(pattern: EmailPattern, firstName: string, lastName: string): string | null {
  const first = namePart(firstName);
  const last = namePart(lastName);
  const needsFirst = pattern.includes("{first}") || pattern.includes("{f}");
  const needsLast = pattern.includes("{last}") || pattern.includes("{l}");
  if ((needsFirst && !first) || (needsLast && !last)) return null;
  return pattern
    .replace("{first}", first)
    .replace("{last}", last)
    .replace("{f}", first.slice(0, 1))
    .replace("{l}", last.slice(0, 1));
}

/** Every pattern that turns this name into this local part. */
export function patternsFor(email: string, firstName: string, lastName: string): EmailPattern[] {
  const local = email.toLowerCase().split("@")[0]?.split("+")[0] ?? "";
  return EMAIL_PATTERNS.filter((p) => renderPattern(p, firstName, lastName) === local);
}

export interface PatternSample {
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export interface DetectedPattern {
  pattern: EmailPattern;
  /** Samples that fit the pattern. */
  matches: number;
  /** Samples with a name that fit any pattern. */
  total: number;
  confidence: number;
}

/**
 * The most likely pattern for a domain from known addresses. Each sample votes for every pattern it
 * fits; ties go to the more common pattern. Confidence grows with agreement and sample size.
 */
export function detectPattern(samples: PatternSample[]): DetectedPattern | null {
  const votes = new Map<EmailPattern, number>();
  let total = 0;
  for (const s of samples) {
    if (!s.firstName || !s.lastName) continue;
    const fits = patternsFor(s.email, s.firstName, s.lastName);
    if (!fits.length) continue;
    total += 1;
    for (const p of fits) votes.set(p, (votes.get(p) ?? 0) + 1);
  }
  if (!total) return null;
  let best: EmailPattern | null = null;
  let bestVotes = 0;
  for (const p of EMAIL_PATTERNS) {
    const v = votes.get(p) ?? 0;
    if (v > bestVotes) {
      best = p;
      bestVotes = v;
    }
  }
  if (!best) return null;
  const agreement = bestVotes / total;
  const sizeFactor = Math.min(1, 0.55 + 0.15 * bestVotes);
  return { pattern: best, matches: bestVotes, total, confidence: Math.round(agreement * sizeFactor * 100) / 100 };
}

/** Candidate addresses for a person, best guess first (the known pattern, then common formats). */
export function generateCandidates(
  firstName: string,
  lastName: string,
  domain: string,
  preferred?: EmailPattern | null,
  limit = 6,
): string[] {
  const order = preferred ? [preferred, ...EMAIL_PATTERNS.filter((p) => p !== preferred)] : [...EMAIL_PATTERNS];
  const out: string[] = [];
  for (const p of order) {
    const local = renderPattern(p, firstName, lastName);
    if (local && !out.includes(`${local}@${domain}`)) out.push(`${local}@${domain}`);
    if (out.length >= limit) break;
  }
  return out;
}
