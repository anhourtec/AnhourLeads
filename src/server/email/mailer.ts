import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { env } from "@/server/env";
import { log } from "@/server/log";

const globalForMail = globalThis as unknown as { anhourMailer?: Transporter | null };

function transporter(): Transporter | null {
  if (globalForMail.anhourMailer !== undefined) return globalForMail.anhourMailer;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = env();
  globalForMail.anhourMailer = SMTP_HOST
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT ?? 587,
        secure: SMTP_PORT === 465,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
      })
    : null;
  return globalForMail.anhourMailer;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Display name shown as the sender, e.g. the workspace brand. Never the installation's name on a white-label host. */
  fromName?: string;
}

/** Send a transactional email (invites, password resets). Returns false when no SMTP server is configured or sending failed. */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const transport = transporter();
  if (!transport) {
    log.warn("mail not sent: SMTP is not configured", { component: "mailer", subject: message.subject });
    return false;
  }
  const from = env().SMTP_FROM;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  try {
    await transport.sendMail({
      from: message.fromName ? { name: message.fromName, address } : from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return true;
  } catch (error) {
    log.error("mail send failed", { component: "mailer", error });
    return false;
  }
}
