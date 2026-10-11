/**
 * Values and labels for people and company fields, safe to import from client components.
 * The values mirror the column enums in src/server/db/schema.ts (the services check this at compile time).
 */

export const CONTACT_STAGES = [
  "new",
  "contacted",
  "replied",
  "interested",
  "not_interested",
  "unresponsive",
  "do_not_contact",
  "bad_data",
  "changed_job",
] as const;
export type ContactStage = (typeof CONTACT_STAGES)[number];

export const CONTACT_STAGE_LABELS: Record<ContactStage, string> = {
  new: "Cold",
  contacted: "Approaching",
  replied: "Replied",
  interested: "Interested",
  not_interested: "Not interested",
  unresponsive: "Unresponsive",
  do_not_contact: "Do not contact",
  bad_data: "Bad data",
  changed_job: "Changed job",
};

export const SENIORITIES = [
  "owner",
  "founder",
  "c_suite",
  "partner",
  "vp",
  "head",
  "director",
  "manager",
  "senior",
  "entry",
  "intern",
] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const SENIORITY_LABELS: Record<Seniority, string> = {
  owner: "Owner",
  founder: "Founder",
  c_suite: "C-suite",
  partner: "Partner",
  vp: "VP",
  head: "Head",
  director: "Director",
  manager: "Manager",
  senior: "Senior",
  entry: "Entry",
  intern: "Intern",
};

export const EMAIL_STATUSES = ["unverified", "valid", "invalid", "catch_all", "unknown", "role", "disposable"] as const;
export type ContactEmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_STATUS_LABELS: Record<ContactEmailStatus, string> = {
  unverified: "Unverified",
  valid: "Valid",
  invalid: "Invalid",
  catch_all: "Catch-all",
  unknown: "Unknown",
  role: "Role address",
  disposable: "Disposable",
};

export const COMPANY_STAGES = ["cold", "prospect", "engaged", "customer", "churned"] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];

export const COMPANY_STAGE_LABELS: Record<CompanyStage, string> = {
  cold: "Cold",
  prospect: "Prospect",
  engaged: "Engaged",
  customer: "Customer",
  churned: "Churned",
};

/** Field names as shown next to provenance rows. */
export const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  title: "Title",
  seniority: "Seniority",
  department: "Department",
  phone: "Phone",
  linkedinUrl: "LinkedIn",
  city: "City",
  state: "State or region",
  country: "Country",
  timezone: "Time zone",
  stage: "Stage",
  tags: "Tags",
  consentBasis: "Consent basis",
  companyId: "Company",
  ownerId: "Owner",
  name: "Name",
  domain: "Domain",
  websiteUrl: "Website",
  twitterUrl: "X / Twitter",
  industry: "Industry",
  keywords: "Keywords",
  technologies: "Technologies",
  employeeCount: "Employees",
  annualRevenue: "Annual revenue",
  foundedYear: "Founded",
  description: "Description",
};
