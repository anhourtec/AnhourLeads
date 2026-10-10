import type { MailboxView } from "@/server/services/mailboxes";

export type Mailbox = MailboxView;

export interface MailboxPermissions {
  create: boolean;
  update: boolean;
  remove: boolean;
}

export const PROVIDER_LABELS: Record<Mailbox["provider"], string> = {
  smtp: "SMTP",
  google: "Google Workspace",
  microsoft: "Microsoft 365",
};

export const SECURITY_LABELS: Record<Mailbox["smtpSecure"], string> = {
  ssl: "SSL/TLS",
  starttls: "STARTTLS",
  none: "None",
};
